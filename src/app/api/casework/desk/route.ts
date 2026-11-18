import type { DeskStatusResponse } from "@/features/casework/domain/api";
import { deskStatus } from "@/features/casework/server/desk-view";
import {
  failure,
  json,
  RequestError,
} from "@/features/casework/server/respond";
import { currentDesk } from "@/features/casework/server/session";

/**
 * The open Desk's Runs, the Owner's list of Desks and the Spend, for
 * refreshing the desk. A GET, so it does not wait behind the desk's server
 * actions (which Next sends one at a time) and they do not wait behind it.
 */
export async function GET() {
  try {
    // `currentDesk` passes the Access gate and checks the Desk is the Owner's.
    const { owner, session } = await currentDesk();
    if (!session) throw new RequestError(404, "No desk is open.");
    return json<DeskStatusResponse>(await deskStatus(owner, session));
  } catch (error) {
    return failure(error);
  }
}
