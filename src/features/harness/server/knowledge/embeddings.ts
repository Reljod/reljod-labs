import "server-only";
import type { AuditUsage } from "../../domain/audit";
import { EMBEDDING_DIMENSIONS } from "../env";
import { addUsage, embed } from "../llm";
import type { Embedder } from "../ports";

/** Passages embedded in one gateway call. */
const BATCH = 64;

/**
 * Embeds texts in batches. A batch the gateway refuses (no key, a limit, an
 * outage) yields nulls, not an error: a Passage without an embedding is still
 * found by its words, and the Knowledge service's backfill embeds it later.
 */
async function embedAll(texts: string[]): Promise<{
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

/** The embedding model on the AI Gateway (paid). */
export const gatewayEmbedder: Embedder = {
  embedAll,
  async embedQuery(text) {
    try {
      const { embeddings } = await embed([text]);
      return embeddings[0] ?? null;
    } catch (error) {
      // No gateway key or the gateway is down: search by words alone.
      console.error("[harness] could not embed a search query", error);
      return null;
    }
  },
};

/**
 * The e2e suite's embedder: no vectors, no spend. Passages are filed with no
 * embedding (search finds them by their words; a live request embeds them
 * later), and a query searches by words alone.
 */
export const noEmbedder: Embedder = {
  embedAll: async (texts) => ({
    vectors: texts.map(() => null),
    usage: null,
  }),
  embedQuery: async () => null,
};
