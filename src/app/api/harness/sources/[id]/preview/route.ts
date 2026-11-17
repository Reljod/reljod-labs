import type { SourcePreviewResponse } from "@/features/harness/domain/api";
import { requireStaff } from "@/features/harness/server/context";
import { previewSource } from "@/features/harness/server/knowledge";
import { failure, json } from "@/features/harness/server/respond";

type Context = RouteContext<"/api/harness/sources/[id]/preview">;

/**
 * A Source to read raw: its extracted text and a 5-minute signed link to its
 * file. Owner-scoped, like every Source route; the read is audited.
 */
export async function GET(_request: Request, { params }: Context) {
  try {
    const { owner, staff } = await requireStaff();
    const { id } = await params;
    return json<SourcePreviewResponse>(
      await previewSource({ owner, staff, sourceId: id }),
    );
  } catch (error) {
    return failure(error);
  }
}
