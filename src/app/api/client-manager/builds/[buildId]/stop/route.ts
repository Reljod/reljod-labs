import { failure, notFound } from "@/features/client-manager/server/respond";
import {
  ownedClient,
  stopBuild,
  viewableBuild,
} from "@/features/client-manager/server/service";
import {
  currentOwner,
  visitor,
} from "@/features/client-manager/server/session";

/** Stops a running Build: Stop button, Escape, or telling the Navigator. */
export async function POST(
  _request: Request,
  { params }: RouteContext<"/api/client-manager/builds/[buildId]/stop">,
) {
  try {
    const { buildId } = await params;
    const owner = await currentOwner();
    const found = await viewableBuild(buildId, owner);
    if (
      !found ||
      !(await ownedClient(found.client.id, owner, await visitor()))
    ) {
      return notFound();
    }
    await stopBuild(found.build);
    return Response.json({ stopped: true });
  } catch (error) {
    return failure(error);
  }
}
