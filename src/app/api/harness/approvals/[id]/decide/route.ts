import { z } from "zod";
import type { RunResponse } from "@/features/harness/domain/api";
import { harnessApi, idSchema, permits } from "@/features/harness/server/api";
import { authorize, body, params } from "@/platform/http/middleware";

const decideSchema = z.object({
  decision: z.enum(["approve", "return"]),
  note: z.string().trim().max(1000).optional(),
});

/**
 * Approves or returns a Draft. Any Staff member may decide a low-risk
 * Approval; a high-risk one needs an admin who did not start the Run, which
 * the Runs service checks against the Approval's row.
 */
export const POST = harnessApi
  .use(authorize(permits("approval.decide.low")))
  .use(params(idSchema))
  .use(body(decideSchema))
  .handle(
    async ({ services, caller, path, body }): Promise<RunResponse> => ({
      run: await services.runs.decide(
        caller,
        path.id,
        body.decision,
        body.note ?? null,
      ),
    }),
  );
