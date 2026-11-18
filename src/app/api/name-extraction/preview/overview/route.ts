import { requireOwner } from "@/features/access/server/gate";
import { overview } from "@/features/name-extraction/server/preview";
import { overviewQuery } from "@/features/name-extraction/server/read-query";
import { failure, refusalOr } from "@/features/name-extraction/server/respond";

/**
 * A Document's title, page count, names per page and every name:
 * `?corpus=<id>` or `?upload=<uuid>`, or `?run=<id>` for that Run's own
 * Document and Names.
 */
export async function GET(request: Request) {
  try {
    const { owner } = await requireOwner();
    const query = overviewQuery(new URL(request.url).searchParams);
    if ("error" in query) return refusalOr(query);
    return refusalOr(await overview(owner, query.source, query.runId));
  } catch (error) {
    return failure(error);
  }
}
