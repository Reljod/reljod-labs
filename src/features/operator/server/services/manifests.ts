import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { Owner } from "@/features/access/domain/owner";
import {
  ConflictError,
  InvalidError,
  LimitError,
  NotFoundError,
} from "@/platform/errors";
import type { ManifestSummary } from "../../domain/contract";
import { LIMITS } from "../../domain/limits";
import { parseManifest } from "../../domain/manifest";
import type { ManifestFiles, ManifestStore } from "../ports";
import { manifestSummary } from "../repository";
import type { Caller } from "./runs";

/*
 * Attached Manifests: the browser PUTs the file to a signed URL in the
 * private bucket, then asks the server to read it. The file's text and its
 * parsed rows are kept on the row; the Operator is given the text, and the
 * check after the Run compares the rows with the Books.
 */

export type ManifestUpload = {
  manifestId: string;
  signedUrl: string;
  token: string;
  path: string;
};

export interface ManifestService {
  /** The Manifests the Owner attached and the server could read, newest first. */
  list(owner: Owner): Promise<ManifestSummary[]>;
  /** A row and a signed URL the browser PUTs the file to, under the daily cap. */
  openUpload(
    caller: Caller,
    file: { name: string; size: number },
  ): Promise<ManifestUpload>;
  /** Reads an uploaded Manifest into rows. Reading one already read answers from its row. */
  read(owner: Owner, manifestId: string): Promise<ManifestSummary>;
}

/** A stable, non-reversible folder per Owner: no raw input reaches a storage key. */
export function ownerFolder(owner: string) {
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

const tooLarge = () =>
  new InvalidError(
    `A Manifest is at most ${Math.round(LIMITS.manifestBytes / 1000)} KB.`,
  );

export function createManifestService(ports: {
  manifests: ManifestStore;
  files: ManifestFiles;
  now: () => number;
}): ManifestService {
  const { manifests, files } = ports;
  return {
    list: (owner) => manifests.list(owner),

    async openUpload(caller, file) {
      const name = String(file.name ?? "")
        .replace(/\p{Cc}+/gu, " ")
        .trim()
        .slice(0, 120);
      const kind = kindOf(name);
      if (!name || !kind)
        throw new InvalidError("Attach a .csv or .pdf Manifest.");
      const size = Math.trunc(Number(file.size));
      if (!(size > 0 && size <= LIMITS.manifestBytes)) throw tooLarge();
      if (
        !caller.visitor.trusted &&
        (await manifests.countSince(
          caller.owner,
          new Date(ports.now() - 86_400_000),
        )) >= LIMITS.manifestsPerOwnerPerDay
      )
        throw new LimitError(
          `That's ${LIMITS.manifestsPerOwnerPerDay} Manifests today. Try again tomorrow.`,
        );
      const manifestId = randomUUID();
      const path = `manifests/${ownerFolder(caller.owner)}/${manifestId}.${kind}`;
      const slot = await files.uploadUrl(path);
      if (!slot)
        throw new ConflictError("The upload could not be opened. Try again.");
      await manifests.insert({
        id: manifestId,
        owner: caller.owner,
        name,
        kind,
        storagePath: path,
      });
      return { manifestId, ...slot, path };
    },

    async read(owner, manifestId) {
      const row = await manifests.owned(owner, manifestId);
      if (!row) throw new NotFoundError("No such Manifest.");
      if (row.status === "read") return manifestSummary(row);
      // A file that could not be read is not downloaded and parsed again.
      if (row.status === "failed")
        throw new InvalidError("That file could not be read. Attach it again.");
      const bytes = await files.download(row.storage_path);
      if (!bytes)
        throw new ConflictError("The file has not arrived. Upload it again.");
      if (bytes.byteLength > LIMITS.manifestBytes) {
        await manifests.fail(row.id);
        throw tooLarge();
      }
      let text: string;
      try {
        text =
          row.kind === "pdf"
            ? await files.pdfText(bytes)
            : new TextDecoder("utf-8").decode(bytes);
      } catch (cause) {
        await manifests.fail(row.id);
        throw new InvalidError(
          cause instanceof Error && cause.name === "UnreadableError"
            ? cause.message
            : "That file could not be read as a Manifest.",
        );
      }
      // Postgres text cannot hold NUL; nothing else is changed.
      text = text.replaceAll("\u0000", "").slice(0, 60_000);
      const parsed = parseManifest(text);
      if (parsed.lines.length === 0) {
        await manifests.fail(row.id);
        throw new InvalidError(
          "No Manifest rows were found. A row starts with a container number, then ISO type, seal, weight, port, consignee, hazard class and goods.",
        );
      }
      await manifests.saveRead(row.id, text, parsed);
      return manifestSummary({ ...row, status: "read", body: text, parsed });
    },
  };
}
