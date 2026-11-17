import "server-only";
import type { AuditUsage } from "../../domain/audit";
import { type Db, sql } from "../db";
import { EMBEDDING_DIMENSIONS } from "../env";
import { addUsage, embed, toVector } from "../llm";

/** Passages embedded in one gateway call. */
const BATCH = 64;

/**
 * Embeds texts in batches. A batch the gateway refuses (no key, a limit, an
 * outage) yields nulls, not an error: a Passage without an embedding is still
 * found by its words, and `backfillKnowledge` embeds it later.
 */
export async function embedAll(texts: string[]): Promise<{
  vectors: (number[] | null)[];
  usage: AuditUsage | null;
}> {
  const vectors: (number[] | null)[] = [];
  const usages: AuditUsage[] = [];
  for (let start = 0; start < texts.length; start += BATCH) {
    const batch = texts.slice(start, start + BATCH);
    try {
      const { embeddings, usage } = await embed(batch);
      for (let index = 0; index < batch.length; index++) {
        const vector = embeddings[index];
        vectors.push(vector?.length === EMBEDDING_DIMENSIONS ? vector : null);
      }
      if (usage) usages.push(usage);
    } catch (error) {
      console.error("[harness] could not embed Passages", error);
      for (let index = 0; index < batch.length; index++) vectors.push(null);
    }
  }
  return { vectors, usage: addUsage(usages) };
}

/** Sets the embeddings of Passages by id, only where one is still missing. */
export async function setEmbeddings(
  db: Db,
  rows: { id: number; embedding: number[] }[],
): Promise<void> {
  if (rows.length === 0) return;
  const values = rows.map((row) => [String(row.id), toVector(row.embedding)]);
  await db`
    update harness.passages p set embedding = v.embedding::extensions.vector
    from (values ${db(values)}) as v(id, embedding)
    where p.id = v.id::bigint and p.embedding is null`;
}

/** Passages of one Source by ordinal, for a Source whose rows were just inserted. */
export async function setEmbeddingsByOrdinal(
  db: Db,
  sourceId: string,
  rows: { ordinal: number; embedding: number[] }[],
): Promise<void> {
  if (rows.length === 0) return;
  const values = rows.map((row) => [
    String(row.ordinal),
    toVector(row.embedding),
  ]);
  await db`
    update harness.passages p set embedding = v.embedding::extensions.vector
    from (values ${db(values)}) as v(ordinal, embedding)
    where p.source_id = ${sourceId} and p.ordinal = v.ordinal::int`;
}

const TRIED = new Map<string, number>();
const RETRY_AFTER_MS = 10 * 60 * 1000;

/** Whether this instance has not tried to embed this Owner's Passages lately. Marks the attempt. */
export function shouldTryBackfill(key: string, now = Date.now()): boolean {
  const last = TRIED.get(key);
  if (last !== undefined && now - last < RETRY_AFTER_MS) return false;
  TRIED.set(key, now);
  if (TRIED.size > 500) TRIED.clear();
  return true;
}

export async function hasUnembedded(owner: string): Promise<boolean> {
  const [row] = await sql()<{ found: boolean }[]>`
    select exists (
      select 1 from harness.passages where owner = ${owner} and embedding is null
    ) as found`;
  return row?.found ?? false;
}
