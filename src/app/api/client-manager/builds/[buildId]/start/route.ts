import {
  ownedClient,
  startBuild,
  viewableBuild,
} from "@/features/client-manager/server/service";
import {
  currentSessionId,
  visitor,
} from "@/features/client-manager/server/session";
import { failure, notFound } from "../../../respond";

/** Starts a Build's workflow, once its files are uploaded. */
export async function POST(
  _request: Request,
  { params }: RouteContext<"/api/client-manager/builds/[buildId]/start">,
) {
  try {
    const { buildId } = await params;
    const sessionId = await currentSessionId();
    const who = await visitor();
    const found = await viewableBuild(buildId, sessionId);
    // Like Stop: only the session that owns the client may start its Builds.
    if (!found || !(await ownedClient(found.client.id, sessionId, who))) {
      return notFound();
    }
    await startBuild(found.build, who);
    return Response.json({ started: true });
  } catch (error) {
    return failure(error);
  }
}
