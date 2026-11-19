import type { CallResponse } from "@/features/switchboard/domain/api";
import { endCall, loadCall } from "@/features/switchboard/server/calls";
import { requireWorkspace } from "@/features/switchboard/server/context";
import { failure, json } from "@/features/switchboard/server/respond";

/** Hangs up. The Call's Workflow wakes and writes the Wrap-up. */
export async function POST(
  _request: Request,
  { params }: RouteContext<"/api/switchboard/calls/[id]/end">,
) {
  try {
    const { owner } = await requireWorkspace();
    const { id } = await params;
    await endCall({ owner, callId: id, by: "caller" });
    return json<CallResponse>(await loadCall(owner, id));
  } catch (error) {
    return failure(error);
  }
}
