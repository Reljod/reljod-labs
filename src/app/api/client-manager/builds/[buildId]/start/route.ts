import {
  ownedClient,
  startBuild,
  viewableBuild,
} from "@/features/client-manager/server/service";
import {
  currentOwner,
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
    const owner = await currentOwner();
    const who = await visitor();
    const found = await viewableBuild(buildId, owner);
    // Like Stop: only the session that owns the client may start its Builds.
    if (!found || !(await ownedClient(found.client.id, owner, who))) {
      return notFound();
    }
    await startBuild(found.build, who);
    return Response.json({ started: true });
  } catch (error) {
    return failure(error);
  }
}
