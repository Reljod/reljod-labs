import { requireStaff } from "@/features/bank/server/context";
import { failure, json } from "@/features/bank/server/respond";
import { listSessions } from "@/features/bank/server/sessions";

/** The Owner's conversations with the Teller, newest first. */
export async function GET() {
  try {
    const context = await requireStaff();
    return json({ sessions: await listSessions(context.owner) });
  } catch (error) {
    return failure(error);
  }
}
