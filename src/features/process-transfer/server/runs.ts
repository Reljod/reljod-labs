import "server-only";
import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { getRun as getWorkflowRun, start } from "workflow/api";
import type { Owner } from "@/features/access/domain/owner";
import type { Access } from "@/features/access/server/gate";
import {
  E2E_VISITOR,
  hashVisitor,
} from "@/features/document-compliance/server/rate-limit";
import { redoProblem, type WorkCounts, workProblem } from "../domain/caps";
import { LIMITS } from "../domain/limits";
import {
  freshStages,
  type RunEvent,
  type StageState,
  type StartInput,
  type UploadTicket,
} from "../domain/run";
import { sampleBySlug } from "../domain/samples";
import {
  displayName,
  ownerPrefix,
  ownRecordingType,
  recordingPath,
  uploadProblem,
} from "../domain/uploads";
import { auditPerson, auditPipeline } from "./audit";
import { env } from "./env";
import {
  ACTIVE_RUN_MESSAGE,
  activeRuns,
  createRun,
  isActiveRunConflict,
  markStopped,
  ownedRun,
  ownerSpentToday,
  type RunRow,
  resetForRedo,
  setRunFields,
  startsSince,
} from "./repository";
import { processTransferRun } from "./run-workflow";
import { ownerSettings } from "./settings";
import { objectSize, uploadsSince, uploadUrl } from "./storage";

/** A refusal a person can act on; its message is shown as is. */
export class LimitError extends Error {}

/** A Run (or Redo) that still claims to be going after this has lost its workflow. */
const STALE_RUN_MS = 30 * 60_000;

export type Visitor = { hash: string; trusted: boolean };

/** Who is asking, for the rate limits. The e2e suite skips them. */
export async function visitorOf(access: Access): Promise<Visitor> {
  if (access.kind === "e2e") return { hash: E2E_VISITOR, trusted: true };
  const requestHeaders = await headers();
  const ip =
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    requestHeaders.get("x-real-ip") ??
    "unknown";
  return { hash: hashVisitor(ip, env.rateLimitSalt()), trusted: false };
}

const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * The site a Sample is fetched from. The Host header is the browser's to set,
 * so it is used only when it names this deployment or a local dev server.
 */
export async function siteOrigin(): Promise<string> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "";
  const known = [
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
  ].filter(Boolean);
  if (process.env.NODE_ENV !== "production" && LOCAL_HOSTS.test(host)) {
    return `http://${host}`;
  }
  if (known.includes(host)) return `https://${host}`;
  const fallback =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (fallback) return `https://${fallback}`;
  throw new LimitError("This deployment cannot fetch its own samples.");
}

/** The Owner's Run that is still going. Runs whose workflow died long ago are closed on the way. */
export async function activeRun(owner: Owner): Promise<RunRow | null> {
  let live: RunRow | null = null;
  for (const run of await activeRuns(owner)) {
    if (Date.now() - run.started_at.getTime() > STALE_RUN_MS) {
      const reason = "The pipeline stopped responding.";
      const ended = await markStopped(run.id, owner, reason, "failed");
      if (ended) {
        await auditPipeline({
          owner,
          action: "run.failed",
          runId: run.id,
          summary: `"${run.title}" failed: ${reason}`,
          detail: { stale: true },
        });
      }
    } else {
      live ??= run;
    }
  }
  return live;
}

export async function workCounts(
  owner: Owner,
  visitor: Visitor,
): Promise<WorkCounts> {
  const now = Date.now();
  const [running, spent, visitorStarts, starts] = await Promise.all([
    activeRun(owner),
    ownerSpentToday(owner),
    startsSince(new Date(now - 3_600_000), visitor.hash),
    startsSince(new Date(now - 86_400_000)),
  ]);
  return {
    activeRunId: running?.id ?? null,
    ownerSpentToday: spent,
    visitorStartsLastHour: visitorStarts,
    startsToday: starts,
  };
}

/** Throws a LimitError when new paid work is refused. */
async function checkWork(owner: Owner, visitor: Visitor) {
  const problem = workProblem(await workCounts(owner, visitor), {
    trusted: visitor.trusted,
  });
  if (problem) throw new LimitError(problem);
}

// Uploads ------------------------------------------------------------------------

export async function prepareUpload(
  owner: Owner,
  visitor: Visitor,
  input: { name: unknown; size: unknown; type: unknown },
): Promise<UploadTicket> {
  const problem = uploadProblem(input);
  if (problem) throw new LimitError(problem);
  // An upload is only worth making when a Run could start with it.
  await checkWork(owner, visitor);
  const uploaded = await uploadsSince(
    ownerPrefix(owner),
    new Date(Date.now() - 86_400_000),
  );
  if (uploaded >= LIMITS.uploadsPerOwnerPerDay) {
    throw new LimitError(
      `That's ${LIMITS.uploadsPerOwnerPerDay} uploads today. Try a sample, or upload again tomorrow.`,
    );
  }
  const type = input.type as Parameters<typeof recordingPath>[1];
  const path = recordingPath(owner, type, randomUUID());
  return { path, signedUrl: await uploadUrl(path) };
}

// Runs ---------------------------------------------------------------------------

async function startWorkflow(
  runId: string,
  owner: Owner,
  mode: "full" | "redo",
  origin: string,
  generation: number,
) {
  try {
    const run = await start(processTransferRun, [
      { runId, owner, mode, origin, generation },
    ]);
    await setRunFields(runId, { workflow_run_id: run.runId });
  } catch (error) {
    await setRunFields(runId, {
      status: "failed",
      error: "The pipeline could not start. Try again.",
      completed_at: new Date(),
    });
    throw error;
  }
}

export async function startRun(
  owner: Owner,
  visitor: Visitor,
  input: StartInput,
): Promise<string> {
  let source:
    | { kind: "sample"; slug: string }
    | { kind: "upload"; path: string; name: string; type: string };
  let title: string;
  if (input?.kind === "sample") {
    const sample = sampleBySlug(String(input.slug));
    if (!sample) throw new LimitError("That sample is not available.");
    source = { kind: "sample", slug: sample.slug };
    title = sample.title;
  } else if (input?.kind === "upload") {
    const path = String(input.path ?? "");
    const type = ownRecordingType(owner, path);
    if (!type) throw new LimitError("That upload is not yours.");
    const name = displayName(String(input.name ?? ""));
    source = { kind: "upload", path, name, type };
    title = name;
  } else {
    throw new LimitError("Pick a sample or upload a Recording.");
  }
  await checkWork(owner, visitor);
  if (source.kind === "upload") {
    const size = await objectSize(source.path);
    if (size === null) {
      throw new LimitError("The upload has not arrived. Upload it again.");
    }
    if (size > LIMITS.uploadBytes) {
      throw new LimitError("That Recording is larger than the demo takes.");
    }
  }
  const origin = source.kind === "sample" ? await siteOrigin() : "";
  const settings = await ownerSettings(owner);
  const runId = await createRun({
    owner,
    visitorHash: visitor.hash,
    source,
    title,
    stages: freshStages(),
    rules: settings.rules,
    rulesVersion: settings.rulesVersion,
    models: settings.models,
  }).catch((error) => {
    // Two starts raced past the check; the unique index let one through.
    if (isActiveRunConflict(error)) throw new LimitError(ACTIVE_RUN_MESSAGE);
    throw error;
  });
  await auditPerson({
    owner,
    action: "run.started",
    runId,
    summary: `Started a Run on ${source.kind === "sample" ? `the sample "${title}"` : `"${title}"`} with Rules v${settings.rulesVersion}`,
    detail: {
      source: source.kind,
      sample: source.kind === "sample" ? source.slug : null,
      rulesVersion: settings.rulesVersion,
      models: settings.models,
    },
    visitorHash: visitor.hash,
  });
  if (source.kind === "upload") {
    await auditPerson({
      owner,
      action: "recording.uploaded",
      runId,
      summary: `Uploaded "${title}"`,
      detail: { type: source.type },
    });
  }
  await startWorkflow(runId, owner, "full", origin, 0);
  return runId;
}

/**
 * Stops a Run. The row is marked first and always: the Run that most needs
 * stopping is the one whose workflow already died. Cancelling the workflow
 * and ending its stream are best effort. A model call already in flight
 * still finishes and its cost is still added to the Run.
 */
export async function stopRun(owner: Owner, runId: string) {
  const run = await ownedRun(owner, runId);
  if (!run) throw new LimitError("There is no such Run.");
  const stopped = await markStopped(run.id, owner);
  if (!stopped) return false;
  if (run.workflow_run_id) {
    const workflow = getWorkflowRun(run.workflow_run_id);
    try {
      await workflow.cancel({ cancelReason: "Stopped by the person" });
    } catch {
      // Already ended; the row is what counts.
    }
    try {
      const writer = workflow.getWritable<RunEvent>().getWriter();
      const at = Date.now();
      // The screen gets the stopped row's stages and status at once.
      await writer.write({
        at,
        type: "patch",
        patch: {
          status: "stopped",
          stages: stopped.stages,
          error: stopped.error,
          completedAt: stopped.completed_at?.toISOString() ?? null,
        },
      });
      await writer.write({
        at,
        type: "log",
        level: "warn",
        text: "■ Stopped by the person",
      });
      await writer.write({ at, type: "end", status: "stopped" });
      await writer.close();
    } catch {
      // The events route ends a stopped Run's stream by itself.
    }
  }
  await auditPerson({
    owner,
    action: "run.stopped",
    runId: run.id,
    summary: `Stopped "${run.title}"`,
  });
  return true;
}

/** Design, Check and Approve again on a finished Run, under the current Rules and models. */
export async function redoDeck(
  owner: Owner,
  visitor: Visitor,
  runId: string,
): Promise<string> {
  const run = await ownedRun(owner, runId);
  if (!run) throw new LimitError("There is no such Run.");
  const problem = redoProblem({
    status: run.status,
    hasProcess: run.process !== null,
    verified: run.stages.some(
      (stage) => stage.id === "verify" && stage.status === "done",
    ),
    redos: run.redos,
  });
  if (problem) throw new LimitError(problem);
  await checkWork(owner, visitor);
  const settings = await ownerSettings(owner);
  const stages: StageState[] = run.stages.map((stage) =>
    // Document has no model and is laid out again with the Deck, so a Run
    // stopped before it gets it on the Redo.
    stage.id === "document" ||
    stage.id === "design" ||
    stage.id === "check" ||
    stage.id === "approve"
      ? { ...stage, status: "pending", summary: null, ms: null }
      : stage,
  );
  const generation = await resetForRedo({
    id: run.id,
    owner,
    stages,
    rules: settings.rules,
    rulesVersion: settings.rulesVersion,
    models: settings.models,
  }).catch((error) => {
    if (isActiveRunConflict(error)) throw new LimitError(ACTIVE_RUN_MESSAGE);
    throw error;
  });
  if (generation === null) {
    throw new LimitError("The Run changed; reload and try again.");
  }
  await auditPerson({
    owner,
    action: "deck.redone",
    runId: run.id,
    summary: `Redid the Deck of "${run.title}" under Rules v${settings.rulesVersion} (was v${run.rules_version})`,
    detail: {
      redo: generation,
      rulesVersion: settings.rulesVersion,
      previousRulesVersion: run.rules_version,
      previousApproval: run.approval?.status ?? null,
      models: settings.models,
    },
    visitorHash: visitor.hash,
  });
  await startWorkflow(run.id, owner, "redo", "", generation);
  return run.id;
}
