import { z } from "zod";
import type {
  RunListResponse,
  RunResponse,
} from "@/features/harness/domain/api";
import { PIPELINE_IDS } from "@/features/harness/domain/pipeline";
import { harnessApi, permits } from "@/features/harness/server/api";
import { authorize, body, query } from "@/platform/http/middleware";

const listSchema = z.object({ session: z.string().max(64).optional() });

const startSchema = z.object({
  pipelineId: z.enum(PIPELINE_IDS),
  input: z.record(z.string(), z.unknown()).default({}),
  sessionId: z.string().trim().max(64).nullish(),
  via: z.enum(["app", "demo"]).default("app"),
});

/** The Workspace's Runs, newest first; `?session=` for one Session's. */
export const GET = harnessApi.use(query(listSchema)).handle(
  async ({ services, caller, query }): Promise<RunListResponse> => ({
    runs: await services.runs.list(caller, {
      sessionId: query.session ?? null,
    }),
  }),
);

/** Starts a Run from the app or a Demo mode Beat. */
export const POST = harnessApi
  .use(authorize(permits("run.start")))
  .use(body(startSchema))
  .handle(
    async ({ services, caller, body }): Promise<RunResponse> => ({
      run: await services.runs.start(caller, {
        sessionId: body.sessionId ?? null,
        pipelineId: body.pipelineId,
        input: body.input,
        via: body.via,
      }),
    }),
  );
