import "server-only";
import type { DocumentSource, DocumentText } from "../domain/contract";
import { CORPUS, generateDocument } from "../domain/corpus";
import { getUpload } from "./repository";
import { BUCKET, supabase } from "./supabase";
import { parseUploadPages } from "./toolkit/upload";

/** Uploads read in this function instance, so a Run's steps download each once. */
const cache = new Map<string, DocumentText>();
const CACHE_SIZE = 3;

function remember(key: string, document: DocumentText) {
  cache.delete(key);
  cache.set(key, document);
  while (cache.size > CACHE_SIZE) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return document;
}

export function isCorpusId(id: string) {
  return CORPUS.some((entry) => entry.id === id);
}

/**
 * The Document's text. A Corpus Document is regenerated from its seed (cheap
 * and deterministic); an Upload is downloaded from the private bucket and
 * checked. Steps call this instead of passing 500 pages between them.
 */
export async function loadDocument(
  source: DocumentSource,
): Promise<DocumentText> {
  const key =
    source.kind === "corpus"
      ? `corpus:${source.corpusId}`
      : `upload:${source.uploadId}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (source.kind === "corpus") {
    if (!isCorpusId(source.corpusId))
      throw new Error("No such Corpus Document.");
    return remember(key, generateDocument(source.corpusId).document);
  }
  const upload = await getUpload(source.uploadId);
  if (!upload) throw new Error("No such upload.");
  const { data, error } = await supabase()
    .storage.from(BUCKET)
    .download(upload.storage_path);
  if (error || !data)
    throw new Error("The upload's file is missing; upload it again.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(await data.text());
  } catch {
    throw new Error("The upload is not valid JSON.");
  }
  const pages = parseUploadPages(parsed);
  return remember(key, { id: upload.id, title: upload.title, pages });
}
