import type { RunResponse } from "@/features/harness/domain/api";
import { requireStaff } from "@/features/harness/server/context";
import { failure, json, notFound } from "@/features/harness/server/respond";
import { getRun } from "@/features/harness/server/runs";

type Context = { params: Promise<{ id: string }> };

/** A Run with its Steps, Findings, Approvals and Drafts. */
export async function GET(_request: Request, { params }: Context) {
  try {
    const { owner } = await requireStaff();
    const { id } = await params;
    const run = await getRun(owner, id);
    if (!run) return notFound("That Run is not in this Workspace.");
    return json<RunResponse>({ run });
  } catch (error) {
    return failure(error);
  }
}
