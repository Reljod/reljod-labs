import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import { readDocx, readXlsx } from "@/features/client-manager/domain/office";
import { InvalidError } from "@/platform/errors";
import { sql } from "../db";
import { download } from "../knowledge/storage";
import { sourceTexts } from "../knowledge/text";

/*
 * What a Pipeline reads from a Source: its row (scoped to the Owner), its
 * text, and, for a Schedule, its raw bytes from the private `harness`
 * bucket (a Passage split would lose a Schedule's columns).
 */

export type SourceMeta = {
  id: string;
  title: string;
  kind: string;
  storagePath: string | null;
  status: string;
  /** `YYYY-MM-DD`: when it was attached. */
  addedOn: string;
};

/** The Owner's Sources among `ids`, in the order asked; unknown ids are left out. */
export async function sourcesOf(
  owner: Owner,
  ids: string[],
): Promise<SourceMeta[]> {
  if (ids.length === 0) return [];
  const db = sql();
  const rows = await db<
    {
      id: string;
      title: string;
      kind: string;
      storage_path: string | null;
      status: string;
      added_on: string;
    }[]
  >`
    select id, title, kind, storage_path, status,
           (created_at at time zone 'UTC')::date::text as added_on
    from harness.sources
    where owner = ${owner} and deleted_at is null and id in ${db(ids)}`;
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row
      ? [
          {
            id: row.id,
            title: row.title,
            kind: row.kind,
            storagePath: row.storage_path,
            status: row.status,
            addedOn: row.added_on,
          },
        ]
      : [];
  });
}

/**
 * The Source's file, or null when it has none (a pasted text, a web page).
 * `source` comes from `sourcesOf`, so it is already the Owner's; its key was
 * written by the server (the upload), never by the browser.
 */
export async function sourceBytes(
  source: SourceMeta,
): Promise<Uint8Array | null> {
  if (!source.storagePath) return null;
  try {
    return await download(source.storagePath);
  } catch {
    throw new Error(`Could not read the file of "${source.title}".`);
  }
}

const extension = (path: string | null) =>
  path?.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";

/** A file's bytes as text, for the formats that hold text. Null for a PDF or an image. */
export function bytesAsText(
  bytes: Uint8Array,
  path: string | null,
  kind: string,
): string | null {
  const ext = extension(path);
  if (ext === "xlsx" || kind === "sheet") {
    return readXlsx(bytes)
      .map((sheet) => sheet.csv)
      .join("\n");
  }
  if (ext === "docx") return readDocx(bytes);
  if (
    ["txt", "md", "csv", "json", "html", "htm"].includes(ext) ||
    ["text", "csv"].includes(kind)
  ) {
    return new TextDecoder().decode(bytes);
  }
  return null;
}

/**
 * A Source's text, as the Knowledge base reads it (`readSourceText`: from
 * the file on demand, cached, and fine for a Source not yet filed). Empty
 * when it cannot be read, so a Run can say which paper it could not read.
 */
export async function sourceText(
  owner: Owner,
  source: SourceMeta,
): Promise<string> {
  try {
    return (await sourceTexts.read(owner, source.id))?.text ?? "";
  } catch (error) {
    if (error instanceof InvalidError) return "";
    throw error;
  }
}
