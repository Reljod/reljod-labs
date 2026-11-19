import type { ReportResponse } from "@/features/switchboard/domain/api";
import { reportEvents } from "@/features/switchboard/server/calls";
import { requireWorkspace } from "@/features/switchboard/server/context";
import { bodyOf, failure, json } from "@/features/switchboard/server/respond";

/** What the browser heard and measured in a voice Call (`reportedEventSchema`). */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/switchboard/calls/[id]/events">,
) {
  try {
    const { owner } = await requireWorkspace();
    const { id } = await params;
    return json<ReportResponse>(
      await reportEvents({ owner, callId: id, body: await bodyOf(request) }),
    );
  } catch (error) {
    return failure(error);
  }
}
