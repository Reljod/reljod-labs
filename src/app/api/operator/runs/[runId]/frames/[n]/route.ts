import { requireOwner } from "@/features/access/server/gate";
import { metricsOf, ownedRun } from "@/features/operator/server/repository";
import { failure, notFound } from "@/features/operator/server/respond";
import { getFrame } from "@/features/operator/server/storage";

/**
 * The picture of one Frame of one of the Owner's Runs (PNG). A Frame never
 * changes once taken, so the browser may keep it; it is private to the Owner.
 */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/operator/runs/[runId]/frames/[n]">,
) {
  try {
    const { owner } = await requireOwner();
    const { runId, n } = await params;
    const frame = Number(n);
    const run = await ownedRun(owner, runId);
    if (!run || !Number.isInteger(frame) || frame < 0) return notFound();
    // While a Run goes, its row's count may trail the Trail by a Frame or two.
    if (frame > metricsOf(run).frames + 400) return notFound();
    const png = await getFrame(run.id, frame);
    if (!png) return notFound();
    return new Response(new Uint8Array(png), {
      headers: {
        "content-type": "image/png",
        "cache-control": "private, max-age=86400, immutable",
      },
    });
  } catch (error) {
    return failure(error);
  }
}
