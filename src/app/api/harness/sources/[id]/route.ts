import type {
  SourceRemoveResponse,
  SourceResponse,
} from "@/features/harness/domain/api";
import {
  requirePermission,
  requireStaff,
} from "@/features/harness/server/context";
import { readSource, removeSource } from "@/features/harness/server/knowledge";
import { failure, json, notFound } from "@/features/harness/server/respond";

type Context = RouteContext<"/api/harness/sources/[id]">;

/** One Source with its Passages in order, superseded ones marked. */
export async function GET(_request: Request, { params }: Context) {
  try {
    const { owner } = await requireStaff();
    const { id } = await params;
    const found = await readSource(owner, id);
    if (!found) return notFound("That Source is not in this Workspace.");
    return json<SourceResponse>(found);
  } catch (error) {
    return failure(error);
  }
}

/** Removes a Source that is not a seed (admin). */
export async function DELETE(_request: Request, { params }: Context) {
  try {
    const context = await requirePermission("source.remove");
    const { id } = await params;
    await removeSource({ ...context, sourceId: id });
    return json<SourceRemoveResponse>({ removed: true });
  } catch (error) {
    return failure(error);
  }
}
