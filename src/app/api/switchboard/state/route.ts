import { requireWorkspace } from "@/features/switchboard/server/context";
import { failure, json } from "@/features/switchboard/server/respond";
import { firstView } from "@/features/switchboard/server/views";

/** The Back office, the Rules, the saved Calls and this hour's caps (`FirstView`). */
export async function GET() {
  try {
    const { owner, who } = await requireWorkspace();
    return json(await firstView(owner, who));
  } catch (error) {
    return failure(error);
  }
}
