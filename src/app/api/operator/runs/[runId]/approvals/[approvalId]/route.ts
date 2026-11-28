import { z } from "zod";
import { decisionSchema } from "@/features/operator/domain/api";
import { operatorApi } from "@/features/operator/server/api";
import { body, params } from "@/platform/http/middleware";

/** A person's decision on a paused Action: approved or refused, once. */
export const PATCH = operatorApi
  .use(
    params(
      z.object({
        runId: z.string().max(64),
        approvalId: z.uuid({ error: "No such Approval." }),
      }),
    ),
  )
  .use(body(decisionSchema))
  .handle(({ services, owner, path, body }) =>
    services.runs.decide({
      owner,
      runId: path.runId,
      approvalId: path.approvalId,
      decision: body.decision,
      by: "person",
    }),
  );
