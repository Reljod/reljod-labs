import type { Owner } from "@/features/access/domain/owner";
import { safeExtension } from "@/features/client-manager/domain/file-name";
import { slugify } from "@/features/client-manager/domain/graph";

/**
 * What kind of Source a file is, and where its bytes are kept. Names, types
 * and extensions come from the browser, so nothing here lets one reach a
 * Storage key: the key is built from the Owner, a Source id the server made,
 * a slug of the name and an extension chosen from the Source's kind
 * (docs/engineering/conventions.md, "Storage paths never carry raw browser
 * input").
 */

/** The kinds an upload may be; `web` Sources arrive as text, never as files. */
export const FILE_KINDS = ["pdf", "sheet", "csv", "doc", "text"] as const;
export type FileKind = (typeof FILE_KINDS)[number];

const BY_EXTENSION: Record<string, FileKind> = {
  pdf: "pdf",
  xlsx: "sheet",
  csv: "csv",
  docx: "doc",
  txt: "text",
  md: "text",
  markdown: "text",
};

const BY_MEDIA_TYPE: Record<string, FileKind> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "sheet",
  "text/csv": "csv",
  "application/csv": "csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "doc",
  "text/plain": "text",
  "text/markdown": "text",
};

const MEDIA_TYPE: Record<FileKind, string> = {
  pdf: "application/pdf",
  sheet: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  doc: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  text: "text/plain",
};

/** The extensions the file picker offers. */
export const ACCEPT =
  ".pdf,.xlsx,.csv,.docx,.txt,.md,application/pdf,text/csv,text/plain,text/markdown";

/** A short list of what may be uploaded, for messages. */
export const ACCEPTED_LABEL = "PDF, XLSX, CSV, DOCX, TXT or MD";

/**
 * The kind of file from its extension, else from its media type, else null.
 * The extension wins: browsers report CSV as `application/vnd.ms-excel` on
 * some systems and nothing at all for Markdown.
 */
export function kindOf(name: string, mediaType: string): FileKind | null {
  const extension = safeExtension(name, "");
  const byName = BY_EXTENSION[extension];
  if (byName) return byName;
  // A name with an extension we do not know is not rescued by its type.
  if (extension) return null;
  return (
    BY_MEDIA_TYPE[mediaType.split(";")[0]?.trim().toLowerCase() ?? ""] ?? null
  );
}

export function mediaTypeOf(kind: FileKind): string {
  return MEDIA_TYPE[kind];
}

/** The extension a stored file gets: fixed per kind, never taken from the name as given. */
export function storedExtension(kind: FileKind, name: string): string {
  if (kind === "text") {
    return safeExtension(name, "txt") === "md" ||
      safeExtension(name, "txt") === "markdown"
      ? "md"
      : "txt";
  }
  return { pdf: "pdf", sheet: "xlsx", csv: "csv", doc: "docx" }[kind];
}

/** The file name without its extension, as a slug (`Circular 2023-07.pdf` → `circular-2023-07`). */
export function fileStem(name: string): string {
  const base = name.replace(/^.*[\\/]/, "");
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return slugify(stem) || "source";
}

/** A title to show for a Source from its file name: `kb-circular-2023-07.pdf` → `kb circular 2023 07`. */
export function titleFromName(name: string): string {
  const base = name.replace(/^.*[\\/]/, "");
  const dot = base.lastIndexOf(".");
  const stem = (dot > 0 ? base.slice(0, dot) : base)
    .replace(/\p{Cc}/gu, "")
    .replace(/[_]+/g, " ")
    .trim();
  return (stem || "Untitled source").slice(0, 200);
}

const OWNER_PART = /[^a-z0-9-]/g;

/**
 * Where a Source's file is kept in the private `harness` bucket:
 * `owners/<owner>/sources/<sourceId>/<slug>.<ext>`. The Owner is written
 * `host-<id>` (a colon is not a friendly key character); the Source id is a
 * UUID the server generated and is checked here again.
 */
export function sourceStorageKey(input: {
  owner: Owner;
  sourceId: string;
  name: string;
  kind: FileKind;
}): string {
  const owner = input.owner
    .toLowerCase()
    .replace(":", "-")
    .replace(OWNER_PART, "");
  const sourceId = input.sourceId.toLowerCase().replace(OWNER_PART, "");
  if (!owner || !sourceId)
    throw new Error("A storage key needs an Owner and a Source id");
  return `owners/${owner}/sources/${sourceId}/${fileStem(input.name)}.${storedExtension(input.kind, input.name)}`;
}
