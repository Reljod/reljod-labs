import {
  catalog,
  createIntake,
} from "@/features/client-manager/server/service";
import {
  currentSessionId,
  ensureSessionId,
  visitor,
} from "@/features/client-manager/server/session";
import { failure } from "../respond";

/** The Catalog: every Sample plus this browser's own clients. */
export async function GET() {
  try {
    return Response.json({ clients: await catalog(await currentSessionId()) });
  } catch (error) {
    return failure(error);
  }
}

/**
 * The Intake: creates the client and its first Build, and hands back signed
 * URLs the browser uploads each file to before starting the Build.
 */
export async function POST(request: Request) {
  try {
    const sessionId = await ensureSessionId();
    return Response.json(
      await createIntake(await request.json(), await visitor(), sessionId),
    );
  } catch (error) {
    return failure(error);
  }
}
