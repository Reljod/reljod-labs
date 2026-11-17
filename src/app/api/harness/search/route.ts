import { z } from "zod";
import type { SearchResponse } from "@/features/harness/domain/api";
import { requireStaff } from "@/features/harness/server/context";
import { searchKnowledge } from "@/features/harness/server/knowledge";
import { visitor } from "@/features/harness/server/rate";
import { failure, json } from "@/features/harness/server/respond";

const schema = z.object({
  q: z.string().trim().min(1, "Type something to search for.").max(500),
  limit: z.coerce.number().int().min(1).max(25).optional(),
});

/** Searches Passages by words and meaning. */
export async function GET(request: Request) {
  try {
    const { owner } = await requireStaff();
    const url = new URL(request.url);
    const { q, limit } = schema.parse({
      q: url.searchParams.get("q") ?? "",
      limit: url.searchParams.get("limit") ?? undefined,
    });
    return json<SearchResponse>({
      hits: await searchKnowledge(owner, q, limit ?? 8, await visitor()),
    });
  } catch (error) {
    return failure(error);
  }
}
