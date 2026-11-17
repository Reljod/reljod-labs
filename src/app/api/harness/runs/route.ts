import { z } from "zod";
import type {
  RunListResponse,
  RunResponse,
} from "@/features/harness/domain/api";
import { PIPELINE_IDS } from "@/features/harness/domain/pipeline";
import {
  requirePermission,
  requireStaff,
} from "@/features/harness/server/context";
import { bodyOf, failure, json } from "@/features/harness/server/respond";
import { listRuns, startRun } from "@/features/harness/server/runs";

const startSchema = z.object({
  pipelineId: z.enum(PIPELINE_IDS),
  input: z.record(z.string(), z.unknown()).default({}),
  sessionId: z.string().trim().max(64).nullish(),
  via: z.enum(["app", "demo"]).default("app"),
});

/** The Workspace's Runs, newest first; `?session=` for one Session's. */
export async function GET(request: Request) {
  try {
    const { owner } = await requireStaff();
    const sessionId = new URL(request.url).searchParams.get("session");
    return json<RunListResponse>({
      runs: await listRuns(owner, { sessionId }),
    });
  } catch (error) {
    return failure(error);
  }
}

/** Starts a Run from the app or a Demo mode Beat. */
export async function POST(request: Request) {
  try {
    const context = await requirePermission("run.start");
    const body = startSchema.parse(await bodyOf(request));
    return json<RunResponse>({
      run: await startRun({
        ...context,
        sessionId: body.sessionId ?? null,
        pipelineId: body.pipelineId,
        input: body.input,
        via: body.via,
      }),
    });
  } catch (error) {
    return failure(error);
  }
}
