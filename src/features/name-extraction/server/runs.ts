import "server-only";
import { getRun as getWorkflowRun, start } from "workflow/api";
import type { Owner } from "@/features/access/domain/owner";
import {
  DEFAULT_MODELS,
  type DocumentSource,
  type ModelChoice,
  type RunEventInput,
} from "../domain/contract";
import { corpusCards } from "../domain/corpus";
import {
  currentRulebook,
  endRunIfGoing,
  insertEvents,
  createRun as insertRun,
  isOver,
  ownedRun,
  ownedUpload,
  type RunRow,
  updateRun,
} from "./repository";
import { nameExtractionRun } from "./run-workflow";
import { disposeSandbox } from "./sandbox";
import { UPLOAD_LIMITS } from "./toolkit/upload";
import type { Visitor } from "./visitor";

/** The demo's limits on starting paid work, in one place (conventions.md). */
export const LIMITS = {
  runsPerOwnerPerDay: 20,
  runsPerVisitorPerHour: 8,
  /** Runs one Owner may have going at once. */
  activePerOwner: 2,
  uploadsPerOwnerPerDay: 30,
  maxPages: UPLOAD_LIMITS.pages,
};

/** A Run older than this that still says it is going has lost its workflow. */
export const STALE_RUN_MS = 45 * 60_000;

/** Closes a Run whose workflow is long gone, so it stops counting as active. */
export async function closeIfStale(run: RunRow): Promise<RunRow> {
  if (isOver(run.status)) return run;
  if (Date.now() - Date.parse(run.started_at) < STALE_RUN_MS) return run;
  const error = "The run lost its workflow and was closed.";
  await endRunIfGoing(run.id, { status: "failed", error });
  await insertEvents(run.id, [{ type: "end", status: "failed", error }]).catch(
    () => {},
  );
  return {
    ...run,
    status: "failed",
    error,
    ended_at: new Date().toISOString(),
  };
}

/** What the source is, checked against the Owner: title and page count. */
async function describeSource(
  owner: Owner,
  source: DocumentSource,
): Promise<{ title: string; pages: number } | { error: string }> {
  if (source.kind === "corpus") {
    const card = corpusCards().find((item) => item.id === source.corpusId);
    return card
      ? { title: card.title, pages: card.pages }
      : { error: "No such Corpus Document." };
  }
  const upload = await ownedUpload(owner, source.uploadId);
  if (!upload) return { error: "No such upload." };
  return { title: upload.title, pages: upload.pages };
}

/**
 * Starts a Run under the limits: per Owner per day, per visitor per hour,
 * and at most a few going at once per Owner. The Rulebook is the Owner's
 * current version, snapshotted on the Run.
 */
export async function startRun(input: {
  owner: Owner;
  visitor: Visitor;
  source: DocumentSource;
  models?: ModelChoice;
}): Promise<{ runId: string } | { error: string }> {
  const described = await describeSource(input.owner, input.source);
  if ("error" in described) return described;
  if (described.pages < 1 || described.pages > LIMITS.maxPages)
    return { error: `A Document has 1 to ${LIMITS.maxPages} pages.` };
  const models = input.models ?? DEFAULT_MODELS;
  const rulebook = await currentRulebook(input.owner);
  const created = await insertRun({
    owner: input.owner,
    visitorHash: input.visitor.hash,
    title: described.title,
    pages: described.pages,
    source: input.source,
    models,
    rulebookVersion: rulebook.version,
    rulebook: rulebook.rulebook,
    limits: input.visitor.trusted
      ? null
      : {
          perOwnerPerDay: LIMITS.runsPerOwnerPerDay,
          perVisitorPerHour: LIMITS.runsPerVisitorPerHour,
          activePerOwner: LIMITS.activePerOwner,
        },
  });
  if ("refusal" in created) return { error: created.refusal };
  const { runId } = created;
  try {
    const run = await start(nameExtractionRun, [
      {
        ctx: {
          runId,
          source: input.source,
          title: described.title,
          pages: described.pages,
          models,
          rulebook: rulebook.rulebook,
          rulebookVersion: rulebook.version,
        },
      },
    ]);
    await updateRun(runId, { workflow_run_id: run.runId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await endRunIfGoing(runId, { status: "failed", error: message });
    await insertEvents(runId, [
      { type: "end", status: "failed", error: message },
    ]).catch(() => {});
    return { error: "The run could not be started. Try again." };
  }
  return { runId };
}

/**
 * Stops a Run. The local state change comes first and always happens; the
 * workflow cancel and the Sandbox stop are best effort (conventions.md:
 * "Make the escape hatch work when the thing it escapes is broken"). A model
 * call already in flight still finishes and is billed; the workflow sees the
 * status before its next turn and ends there if the cancel did not land.
 */
export async function stopRun(owner: Owner, runId: string) {
  const run = await ownedRun(owner, runId);
  if (!run) return { error: "No such run." };
  if (isOver(run.status))
    return { runId: run.id, stopped: false, status: run.status };
  await endRunIfGoing(run.id, { status: "stopped" });
  const events: RunEventInput[] = [
    { type: "log", level: "warn", text: "■ stopped by its Owner" },
    { type: "end", status: "stopped" },
  ];
  await insertEvents(run.id, events).catch(() => {
    // The events route ends the stream of a stopped Run by itself.
  });
  if (run.workflow_run_id) {
    try {
      await getWorkflowRun(run.workflow_run_id).cancel({
        cancelReason: "Stopped by its Owner",
      });
    } catch {
      // Already ended, or the workflow is gone: the row is closed either way.
    }
  }
  await disposeSandbox(run.id);
  return { runId: run.id, stopped: true, status: "stopped" as const };
}
