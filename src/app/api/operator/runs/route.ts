import {
  newRunSchema,
  type RunListResponse,
  type StartedRun,
} from "@/features/operator/domain/api";
import { operatorApi } from "@/features/operator/server/api";
import { body } from "@/platform/http/middleware";

/** The Owner's Runs, newest first. */
export const GET = operatorApi.handle(
  ({ services, owner }): Promise<RunListResponse> => services.runs.list(owner),
);

/**
 * Starts a Run the Operator keys (the workflow drives it; follow it on
 * `runs/[runId]/events`), or files a "take the keyboard" attempt, which the
 * server replays and checks at once. Both answer with the new Run's id.
 */
export const POST = operatorApi
  // A hand attempt carries every input the visitor keyed.
  .use(body(newRunSchema, { limit: 1024 * 1024 }))
  .handle(({ services, owner, visitor, body }): Promise<StartedRun> => {
    const caller = { owner, visitor };
    return body.driver === "hand"
      ? services.runs.fileHand(caller, body)
      : services.runs.start(caller, {
          task: body.task,
          manifestId: body.manifestId ?? null,
          model: body.model,
          driver: "operator",
        });
  });
