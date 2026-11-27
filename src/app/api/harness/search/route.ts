import { z } from "zod";
import type { SearchResponse } from "@/features/harness/domain/api";
import { harnessApi } from "@/features/harness/server/api";
import { query } from "@/platform/http/middleware";

const schema = z.object({
  q: z
    .string()
    .optional()
    .transform((value) => value ?? "")
    .pipe(z.string().trim().min(1, "Type something to search for.").max(500)),
  limit: z.coerce.number().int().min(1).max(25).optional(),
});

/** Searches Passages by words and meaning. */
export const GET = harnessApi.use(query(schema)).handle(
  async ({ services, caller, query }): Promise<SearchResponse> => ({
    hits: await services.knowledge.search(caller, query.q, query.limit ?? 8),
  }),
);
