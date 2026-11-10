import {
  createAddition,
  viewableClient,
} from "@/features/client-manager/server/service";
import {
  ensureSessionId,
  visitor,
} from "@/features/client-manager/server/session";
import { failure, notFound } from "../../../respond";

/** An addition: more notes or files folded into an existing Client graph. */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/client-manager/clients/[clientId]/builds">,
) {
  try {
    const { clientId } = await params;
    const sessionId = await ensureSessionId();
    const client = await viewableClient(clientId, sessionId);
    if (!client) return notFound();
    return Response.json(
      await createAddition(
        client,
        await request.json(),
        await visitor(),
        sessionId,
      ),
    );
  } catch (error) {
    return failure(error);
  }
}
