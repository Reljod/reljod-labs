import {
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
    const found = await viewableBuild(buildId, await currentSessionId());
    if (!found) return notFound();
    await startBuild(found.build, await visitor());
    return Response.json({ started: true });
  } catch (error) {
    return failure(error);
  }
}
