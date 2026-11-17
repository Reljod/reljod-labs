import { z } from "zod";
import type { RunResponse } from "@/features/harness/domain/api";
import { requirePermission } from "@/features/harness/server/context";
import { bodyOf, failure, json } from "@/features/harness/server/respond";
import { decideApproval } from "@/features/harness/server/runs";

type Context = { params: Promise<{ id: string }> };

const decideSchema = z.object({
  decision: z.enum(["approve", "return"]),
  note: z.string().trim().max(1000).optional(),
});

/**
 * Approves or returns a Draft. Any Staff member may decide a low-risk
 * Approval; a high-risk one needs an admin who did not start the Run, which
 * `decideApproval` checks.
 */
export async function POST(request: Request, { params }: Context) {
  try {
    const context = await requirePermission("approval.decide.low");
    const { id } = await params;
    const body = decideSchema.parse(await bodyOf(request));
    return json<RunResponse>({
      run: await decideApproval({
        ...context,
        approvalId: id,
        decision: body.decision,
        note: body.note ?? null,
      }),
    });
  } catch (error) {
    return failure(error);
  }
}
