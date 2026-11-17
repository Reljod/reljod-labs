import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import { SEED_SOURCES, seedPassages } from "../../domain/knowledge/seed";
import { embeddingText } from "../../domain/knowledge/split";
import { type Db, sql } from "../db";
import { embedAll, setEmbeddings } from "../knowledge/embeddings";

/**
 * Seeds a new Workspace's Knowledge base: the seed Sources (`is_seed`) and
 * their Passages (`domain/knowledge/seed.ts`).
 *
 * Called by `ensureWorkspace` inside the transaction that holds the
 * Workspace's row lock, so it is quick and calls no model: Passages go in
 * with no embedding (full-text search already finds them) and
 * `backfillKnowledge` embeds them after the response. Every insert is
 * keyed on `seed_key`, so running it twice, or topping up a Workspace on an
 * older seed, adds only what is missing.
 */
export async function seedKnowledge(
  tx: Db,
  owner: Owner,
  _fromVersion: number,
): Promise<void> {
  for (const source of SEED_SOURCES) {
    if (!source.text) continue;
    const [row] = await tx<{ id: string }[]>`
      insert into harness.sources (
        owner, title, kind, bytes, is_seed, status, document_date, seed_key,
        extracted_text
      ) values (
        ${owner}, ${source.title}, ${source.kind}, ${source.text.length}, true,
        'ready', ${source.documentDate}, ${source.key}, ${source.text}
      )
      on conflict (owner, seed_key) where seed_key is not null do nothing
      returning id`;
    // Already there: its Passages are too.
    if (!row) continue;
    const passages = seedPassages(source);
    if (passages.length === 0) continue;
    await tx`
      insert into harness.passages ${tx(
        passages.map((passage, ordinal) => ({
          source_id: row.id,
          owner,
          ordinal,
          heading: passage.heading,
          body: passage.body,
        })),
      )}`;
  }
}

/** Passages embedded by one call; a Workspace's seed is about forty. */
const BACKFILL_CAP = 320;
const PAGE = 64;

/**
 * Embeds the Owner's Passages that have no embedding yet: the seed Passages
 * after a Workspace is created, and any Passage whose embedding failed when
 * it was filed. Idempotent (it only fills nulls), capped per call, and quiet
 * when the gateway key is missing or the gateway is down: search still works
 * by words, and a later call tries again.
 */
export async function backfillKnowledge(owner: Owner): Promise<void> {
  let done = 0;
  while (done < BACKFILL_CAP) {
    const rows = await sql()<
      { id: number; heading: string | null; body: string }[]
    >`
      select p.id, p.heading, p.body
      from harness.passages p
      join harness.sources s on s.id = p.source_id
      where p.owner = ${owner} and p.embedding is null and s.status = 'ready'
      order by p.id
      limit ${PAGE}`;
    if (rows.length === 0) return;
    const { vectors } = await embedAll(rows.map((row) => embeddingText(row)));
    const filled = rows.flatMap((row, index) => {
      const embedding = vectors[index];
      return embedding ? [{ id: row.id, embedding }] : [];
    });
    // Nothing came back (no key, a limit): give up for now rather than loop.
    if (filled.length === 0) return;
    await setEmbeddings(sql(), filled);
    done += rows.length;
    // A short page was the last one.
    if (rows.length < PAGE) return;
  }
}
