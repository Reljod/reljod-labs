import type { TrailResponse } from "@/features/canvas/domain/api";
import { requireCaller } from "@/features/canvas/server/caller";
import { failure, json } from "@/features/canvas/server/respond";
import { listTrail } from "@/features/canvas/server/trail";

/** A page of the Owner's Trail, newest first; `?conversationId=`, `?viewId=`, `?before=`. */
export async function GET(request: Request) {
  try {
    const caller = await requireCaller();
    const query = new URL(request.url).searchParams;
    const before = Number(query.get("before"));
    return json<TrailResponse>({
      events: await listTrail(caller, {
        conversationId: query.get("conversationId") ?? undefined,
        viewId: query.get("viewId") ?? undefined,
        before: Number.isInteger(before) && before > 0 ? before : undefined,
      }),
    });
  } catch (error) {
    return failure(error);
  }
}
