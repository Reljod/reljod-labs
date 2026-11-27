import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import { SEED_SOURCES, seedPassages } from "../../domain/knowledge/seed";
import type { Db } from "../db";

/**
 * Seeds a new Workspace's Knowledge base: the seed Sources (`is_seed`) and
 * their Passages (`domain/knowledge/seed.ts`).
 *
 * Called by `ensureWorkspace` inside the transaction that holds the
 * Workspace's row lock, so it is quick and calls no model: Passages go in
 * with no embedding (full-text search already finds them) and
 * the Knowledge service's `backfill` embeds them after the response. Every insert is
 * keyed on `seed_key`, so running it twice, or topping up a Workspace on an
 * older seed, adds only what is missing.
 */
export async function seedKnowledge(tx: Db, owner: Owner): Promise<void> {
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
