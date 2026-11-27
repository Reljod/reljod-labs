import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import { InvalidError } from "@/platform/errors";
import type { SourceView } from "../../domain/knowledge";
import { LIMITS } from "../../domain/limits";
import { audit } from "../audit";
import { isUuid, sql } from "../db";
import type { SourceTextRow, SourceTexts } from "../ports";
import { extractText, UnreadableError } from "./extract";
import { download } from "./storage";
import { loadSource } from "./views";

/*
 * A Source's text: cached in `extracted_text`, or read from its file in the
 * private bucket, extracted and cached. The Knowledge service reads it here,
 * and so does a Run's Step reading a case paper (`pipelines/source-file.ts`),
 * which runs in a workflow, outside any request.
 */

/** The text of a Source: cached, or read from its file and cached. Throws an UnreadableError a person can act on. */
async function textOf(owner: Owner, row: SourceTextRow): Promise<string> {
  if (row.extracted_text) return row.extracted_text;
  if (!row.storage_path) {
    throw new UnreadableError("This Source has no file and no text.");
  }
  let bytes: Uint8Array;
  try {
    bytes = await download(row.storage_path);
  } catch {
    throw new UnreadableError(
      "The file never arrived. Upload it again, or use a sample.",
    );
  }
  if (bytes.byteLength > LIMITS.uploadBytes) {
    throw new UnreadableError("This file is larger than the upload limit.");
  }
  const text = await extractText(row.kind, bytes);
  await sql()`
    update harness.sources set extracted_text = ${text}
    where id = ${row.id} and owner = ${owner}`;
  return text;
}

/**
 * A Source and its text, for a caller that needs the words and not the
 * Passages (a Pipeline reading a case paper, the Agent reading a file it
 * was handed). Works for a Source that was never filed (`pending`). Null
 * when it is not in the Workspace; an InvalidError says why a file cannot be
 * read. The first read of a file is recorded as `source.read`.
 */
async function readSourceText(
  owner: Owner,
  sourceId: string,
): Promise<{ source: SourceView; text: string } | null> {
  if (!isUuid(sourceId)) return null;
  const [row] = await sql()<SourceTextRow[]>`
    select id, title, kind, storage_path, extracted_text
    from harness.sources where id = ${sourceId} and owner = ${owner}
      and deleted_at is null`;
  if (!row) return null;
  const cached = row.extracted_text !== null;
  let text: string;
  try {
    // The view is read beside the text, not after it.
    const [read, source] = await Promise.all([
      textOf(owner, row),
      loadSource(sql(), owner, sourceId),
    ]);
    if (!source) return null;
    text = read;
    if (!cached) {
      await audit({
        owner,
        actor: { kind: "system" },
        action: "source.read",
        summary: `Read ${source.title}`,
        target: { kind: "source", id: source.id },
        detail: { kind: source.kind, chars: text.length },
      });
    }
    return { source, text };
  } catch (error) {
    if (error instanceof UnreadableError) throw new InvalidError(error.message);
    throw error;
  }
}

export const sourceTexts: SourceTexts = { of: textOf, read: readSourceText };
