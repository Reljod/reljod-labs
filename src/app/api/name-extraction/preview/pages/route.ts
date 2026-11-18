import { requireOwner } from "@/features/access/server/gate";
import { pages } from "@/features/name-extraction/server/preview";
import { pagesQuery } from "@/features/name-extraction/server/read-query";
import { failure, refusalOr } from "@/features/name-extraction/server/respond";

/**
 * Pages `from` to `to` (1-based, inclusive, at most 12) with their marks:
 * the overview's query plus `&from=&to=`.
 */
export async function GET(request: Request) {
  try {
    const { owner } = await requireOwner();
    const query = pagesQuery(new URL(request.url).searchParams);
    if ("error" in query) return refusalOr(query);
    return refusalOr(
      await pages(
        owner,
        query.source,
        { from: query.from, to: query.to },
        query.runId,
      ),
    );
  } catch (error) {
    return failure(error);
  }
}
