import type { TrailResponse } from "@/features/switchboard/domain/api";
import { requireWorkspace } from "@/features/switchboard/server/context";
import { failure, json } from "@/features/switchboard/server/respond";
import { trail } from "@/features/switchboard/server/store";

/** The Workspace's append-only trail, newest first. */
export async function GET(request: Request) {
  try {
    const { owner } = await requireWorkspace();
    const before =
      Number(new URL(request.url).searchParams.get("before")) || undefined;
    return json<TrailResponse>({ events: await trail(owner, { before }) });
  } catch (error) {
    return failure(error);
  }
}
