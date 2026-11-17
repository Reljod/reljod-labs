import type { SourceIngestResponse } from "@/features/harness/domain/api";
import { requirePermission } from "@/features/harness/server/context";
import { ingestSource } from "@/features/harness/server/knowledge";
import { failure, json } from "@/features/harness/server/respond";

/** Reading a Source embeds its Passages and asks the model about Conflicts: it can take a while. */
export const maxDuration = 60;

type Context = RouteContext<"/api/harness/sources/[id]/ingest">;

/** Reads an uploaded Source into Passages and looks for Conflicts. Safe to call again. */
export async function POST(_request: Request, { params }: Context) {
  try {
    const context = await requirePermission("source.add");
    const { id } = await params;
    return json<SourceIngestResponse>(
      await ingestSource({ ...context, sourceId: id }),
    );
  } catch (error) {
    return failure(error);
  }
}
