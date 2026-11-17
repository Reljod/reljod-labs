import { z } from "zod";
import type {
  SessionListResponse,
  SessionResponse,
} from "@/features/harness/domain/api";
import { SESSION_TITLE_CHARS } from "@/features/harness/domain/session";
import {
  requirePermission,
  requireStaff,
} from "@/features/harness/server/context";
import { bodyOf, failure, json } from "@/features/harness/server/respond";
import {
  createSession,
  listSessions,
} from "@/features/harness/server/sessions";

const createSchema = z.object({
  title: z.string().trim().min(1).max(SESSION_TITLE_CHARS).optional(),
});

/** The signed-in Staff member's Sessions, latest activity first. */
export async function GET() {
  try {
    const context = await requireStaff();
    return json<SessionListResponse>({
      sessions: await listSessions(context),
    });
  } catch (error) {
    return failure(error);
  }
}

/** Opens a Session for the signed-in Staff member. */
export async function POST(request: Request) {
  try {
    const context = await requirePermission("session.create");
    const { title } = createSchema.parse(await bodyOf(request));
    return json<SessionResponse>({
      session: await createSession({ ...context, title }),
    });
  } catch (error) {
    return failure(error);
  }
}
