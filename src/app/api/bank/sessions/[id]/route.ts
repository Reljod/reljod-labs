import { listConfirmations } from "@/features/bank/core/reads";
import { requireStaff } from "@/features/bank/server/context";
import { sql } from "@/features/bank/server/db";
import { failure, json } from "@/features/bank/server/respond";
import { listMessages, ownedSession } from "@/features/bank/server/sessions";

/** One conversation: its messages and the requests in it that wait for the person. */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/bank/sessions/[id]">,
) {
  try {
    const context = await requireStaff();
    const { id } = await params;
    const session = await ownedSession(context.owner, id);
    const [messages, confirmations] = await Promise.all([
      listMessages(context.owner, session.id),
      listConfirmations(sql(), context.owner, { sessionId: session.id }),
    ]);
    return json({ session, messages, confirmations: confirmations.confirmations });
  } catch (error) {
    return failure(error);
  }
}
