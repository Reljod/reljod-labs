import {
  ownedClient,
  stopBuild,
  viewableBuild,
} from "@/features/client-manager/server/service";
import {
  currentSessionId,
  visitor,
} from "@/features/client-manager/server/session";
import { failure, notFound } from "../../../respond";

/** Stops a running Build: Stop button, Escape, or telling the Navigator. */
export async function POST(
  _request: Request,
  { params }: RouteContext<"/api/client-manager/builds/[buildId]/stop">,
) {
  try {
    const { buildId } = await params;
    const sessionId = await currentSessionId();
    const found = await viewableBuild(buildId, sessionId);
    if (
      !found ||
      !(await ownedClient(found.client.id, sessionId, await visitor()))
    ) {
      return notFound();
    }
    await stopBuild(found.build);
    return Response.json({ stopped: true });
  } catch (error) {
    return failure(error);
  }
}
