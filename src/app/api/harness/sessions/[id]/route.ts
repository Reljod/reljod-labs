import { z } from "zod";
import type { SessionResponse } from "@/features/harness/domain/api";
import { SESSION_TITLE_CHARS } from "@/features/harness/domain/session";
import { requireStaff } from "@/features/harness/server/context";
import {
  bodyOf,
  failure,
  json,
  notFound,
} from "@/features/harness/server/respond";
import {
  readableSession,
  renameSession,
} from "@/features/harness/server/sessions";

type Context = RouteContext<"/api/harness/sessions/[id]">;

const patchSchema = z.object({
  title: z.string().trim().min(1).max(SESSION_TITLE_CHARS),
});

/** One Session: the Staff member's own, or any in the Workspace for an admin. */
export async function GET(_request: Request, { params }: Context) {
  try {
    const context = await requireStaff();
    const { id } = await params;
    const session = await readableSession(context, id);
    if (!session) return notFound();
    return json<SessionResponse>({ session });
  } catch (error) {
    return failure(error);
  }
}

/** Renames a Session of the Staff member's own. */
export async function PATCH(request: Request, { params }: Context) {
  try {
    const context = await requireStaff();
    const { id } = await params;
    const { title } = patchSchema.parse(await bodyOf(request));
    return json<SessionResponse>({
      session: await renameSession({ ...context, sessionId: id, title }),
    });
  } catch (error) {
    return failure(error);
  }
}
