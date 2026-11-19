import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { Owner } from "@/features/access/domain/owner";
import { extractText } from "@/features/harness/server/knowledge/extract";
import type { ManifestSummary } from "../domain/contract";
import { LIMITS } from "../domain/limits";
import { parseManifest } from "../domain/manifest";
import {
  countManifestsSince,
  failManifest,
  insertManifest,
  manifestSummary,
  ownedManifest,
  saveManifestRead,
} from "./repository";
import { bucket } from "./storage";
import type { Visitor } from "./visitor";

/*
 * Attached Manifests: the browser PUTs the file to a signed URL in the
 * private bucket, then asks the server to read it. The file's text and its
 * parsed rows are kept on the row; the Operator is given the text, and the
 * check after the Run compares the rows with the Books.
 */

/** A stable, non-reversible folder per Owner: no raw input reaches a storage key. */
function ownerFolder(owner: string) {
  return createHash("sha256")
    .update(`operator:${owner}`)
    .digest("hex")
    .slice(0, 32);
}

/**
 * The two kinds a Manifest may be, from the name's ending: the same two the
 * attach button offers. Nothing else of the name reaches a path.
 */
function kindOf(name: string): "csv" | "pdf" | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".pdf")) return "pdf";
  return null;
}

export async function createManifestUpload(input: {
  owner: Owner;
  visitor: Visitor;
  name: string;
  size: number;
}): Promise<
  | { manifestId: string; signedUrl: string; token: string; path: string }
  | { error: string }
> {
  const name = String(input.name ?? "")
    .replace(/\p{Cc}+/gu, " ")
    .trim()
    .slice(0, 120);
  const kind = kindOf(name);
  if (!name || !kind) return { error: "Attach a .csv or .pdf Manifest." };
  const size = Math.trunc(Number(input.size));
  if (!(size > 0 && size <= LIMITS.manifestBytes))
    return {
      error: `A Manifest is at most ${Math.round(LIMITS.manifestBytes / 1000)} KB.`,
    };
  if (
    !input.visitor.trusted &&
    (await countManifestsSince(
      input.owner,
      new Date(Date.now() - 86_400_000),
    )) >= LIMITS.manifestsPerOwnerPerDay
  )
    return {
      error: `That's ${LIMITS.manifestsPerOwnerPerDay} Manifests today. Try again tomorrow.`,
    };
  const manifestId = randomUUID();
  const path = `manifests/${ownerFolder(input.owner)}/${manifestId}.${kind}`;
  const { data, error } = await bucket().createSignedUploadUrl(path, {
    upsert: false,
  });
  if (error || !data)
    return { error: "The upload could not be opened. Try again." };
  await insertManifest({
    id: manifestId,
    owner: input.owner,
    name,
    kind,
    storagePath: path,
  });
  return { manifestId, signedUrl: data.signedUrl, token: data.token, path };
}

/** Reads an uploaded Manifest into text and rows. Reading one already read answers from its row. */
export async function readManifest(
  owner: Owner,
  manifestId: string,
): Promise<ManifestSummary | { error: string }> {
  const row = await ownedManifest(owner, manifestId);
  if (!row) return { error: "No such Manifest." };
  if (row.status === "read") return manifestSummary(row);
  // A file that could not be read is not downloaded and parsed again.
  if (row.status === "failed")
    return { error: "That file could not be read. Attach it again." };
  const { data, error } = await bucket().download(row.storage_path);
  if (error || !data)
    return { error: "The file has not arrived. Upload it again." };
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (bytes.byteLength > LIMITS.manifestBytes) {
    await failManifest(row.id);
    return {
      error: `A Manifest is at most ${Math.round(LIMITS.manifestBytes / 1000)} KB.`,
    };
  }
  let text: string;
  try {
    text =
      row.kind === "pdf"
        ? await extractText("pdf", bytes)
        : new TextDecoder("utf-8").decode(bytes);
  } catch (cause) {
    await failManifest(row.id);
    return {
      error:
        cause instanceof Error && cause.name === "UnreadableError"
          ? cause.message
          : "That file could not be read as a Manifest.",
    };
  }
  // Postgres text cannot hold NUL; nothing else is changed.
  text = text.replaceAll("\u0000", "").slice(0, 60_000);
  const parsed = parseManifest(text);
  if (parsed.lines.length === 0) {
    await failManifest(row.id);
    return {
      error:
        "No Manifest rows were found. A row starts with a container number, then ISO type, seal, weight, port, consignee, hazard class and goods.",
    };
  }
  await saveManifestRead(row.id, text, parsed);
  return manifestSummary({ ...row, status: "read", body: text, parsed });
}
