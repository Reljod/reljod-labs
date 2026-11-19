import type { CallResponse } from "@/features/switchboard/domain/api";
import { loadCall } from "@/features/switchboard/server/calls";
import { requireWorkspace } from "@/features/switchboard/server/context";
import { failure, json } from "@/features/switchboard/server/respond";

/** One Call with its Events; `?after=<event id>` for only what is new. */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/switchboard/calls/[id]">,
) {
  try {
    const { owner } = await requireWorkspace();
    const { id } = await params;
    const after = Number(new URL(request.url).searchParams.get("after")) || 0;
    return json<CallResponse>(await loadCall(owner, id, after));
  } catch (error) {
    return failure(error);
  }
}
