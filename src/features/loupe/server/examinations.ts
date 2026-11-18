import "server-only";
import { getRun as getWorkflowRun, start } from "workflow/api";
import type { Owner } from "@/features/access/domain/owner";
import {
  DEFAULT_MODEL,
  type DocumentFormat,
  type DocumentKind,
  type DocumentSource,
  type Driver,
  MODEL_IDS,
  type ModelId,
  type Verdict,
} from "../domain/contract";
import { manifestEntry, sampleFiles } from "../domain/corpus";
import { LIMITS, STALE_EXAMINATION_MS } from "../domain/limits";
import { env } from "./env";
import {
  audit,
  createExamination,
  currentRulebook,
  endExaminationIfGoing,
  type ExaminationRow,
  getExamination,
  isOver,
  ownedExamination,
  ownedUpload,
  takeRate,
  updateExamination,
} from "./repository";
import { disposeSandbox } from "./sandbox";
import { storedSize } from "./storage";
import { endExamination, scoreOf } from "./ending";
import { standingOf } from "./tools";
import { emit } from "./trail";
import { loupeExamination } from "./workflow";

export type Who = {
  owner: Owner;
  visitor: { hash: string; trusted: boolean };
  origin: string;
  via: "app" | "mcp";
};

/** The Examiner's model: the one asked for, else LOUPE_MODEL, else the default. */
export function modelFor(asked?: string): ModelId {
  const pick = asked || env.model();
  return (MODEL_IDS as string[]).includes(pick) ? (pick as ModelId) : DEFAULT_MODEL;
}

// Start ------------------------------------------------------------------------------

type Described = {
  title: string;
  kind: DocumentKind;
  format: DocumentFormat;
  isForgery: boolean;
};

async function describe(
  owner: Owner,
  source: DocumentSource,
): Promise<Described | { error: string }> {
  if (source.kind === "sample") {
    const entry = manifestEntry(source.sampleId);
    if (!entry?.featured || !sampleFiles(source.sampleId))
      return { error: "No such Sample." };
    return {
      title: entry.title,
      kind: entry.kind,
      format: entry.format,
      isForgery: false,
    };
  }
  const upload = await ownedUpload(owner, source.uploadId);
  if (!upload) return { error: "No such Upload." };
  // The browser was handed a signed URL; the file must have arrived, and be the size it said.
  const size = await storedSize(upload.storage_path);
  if (size === null)
    return { error: "The Upload's file was never received. Upload it again." };
  if (size > LIMITS.uploadBytes)
    return { error: "The Upload is larger than the demo allows." };
  return {
    title: upload.title,
    kind: upload.kind,
    format: upload.format,
    isForgery: Boolean(upload.forgery),
  };
}

/**
 * Starts an Examination under the limits (per Owner per day, per visitor per
 * hour, a few going at once). The Rulebook is the Owner's current version,
 * kept on the Examination. `stub` is the e2e suite's scripted Examiner.
 */
export async function startExamination(
  who: Who,
  input: {
    source: DocumentSource;
    driver?: Driver;
    model?: string;
    stub?: boolean;
  },
): Promise<{ examinationId: string } | { error: string }> {
  const described = await describe(who.owner, input.source);
  if ("error" in described) return described;
  const driver = input.driver ?? "examiner";
  const stub = Boolean(input.stub && who.visitor.trusted);
  if (!stub && !env.sandboxConfigured() && input.source.kind === "upload")
    return {
      error:
        "Sandbox unavailable: it is not set up here, so only Samples can be examined, from their recorded Sweep.",
    };
  const rulebook = await currentRulebook(who.owner);
  const created = await createExamination({
    owner: who.owner,
    visitorHash: who.visitor.hash,
    title: described.title,
    kind: described.kind,
    format: described.format,
    source: input.source,
    isForgery: described.isForgery,
    model: modelFor(input.model),
    driver,
    origin: who.origin,
    stub,
    rulebookVersion: rulebook.version,
    rulebook: rulebook.rulebook,
    via: who.via,
    limits: who.visitor.trusted
      ? null
      : {
          perOwnerPerDay: LIMITS.examinationsPerOwnerPerDay,
          perVisitorPerHour: LIMITS.examinationsPerVisitorPerHour,
          activePerOwner: LIMITS.activePerOwner,
          staleMs: STALE_EXAMINATION_MS,
        },
  });
  if ("refusal" in created) return { error: created.refusal };
  const { examinationId } = created;
  try {
    const run = await start(loupeExamination, [{ examinationId }]);
    await updateExamination(examinationId, { workflow_run_id: run.runId });
  } catch (error) {
    console.error("[loupe] workflow start failed", error);
    const message = "The Examination could not be started. Try again.";
    if (
      await endExaminationIfGoing(examinationId, {
        status: "failed",
        error: message,
      })
    )
      await emit(examinationId, {
        type: "end",
        status: "failed",
        error: message,
      }).catch(() => {});
    return { error: message };
  }
  return { examinationId };
}

/** Closes an Examination whose workflow (or whose client) is long gone, so it stops counting as active. */
export async function closeIfStale(row: ExaminationRow): Promise<ExaminationRow> {
  if (isOver(row.status)) return row;
  if (Date.now() - Date.parse(row.started_at) < STALE_EXAMINATION_MS) return row;
  // A client's own Examination that it never finished ends with what was measured.
  await endExamination(
    row.id,
    row.state.driver === "client" && row.pages.length > 0
      ? {
          status: "completed",
          stoppedBy: "idle",
          note: "The client stopped calling tools before the Done gate passed.",
        }
      : { status: "failed", error: "The Examination lost its workflow and was closed." },
  );
  return (await getExamination(row.id)) ?? row;
}

// Stop -------------------------------------------------------------------------------

/**
 * Stops an Examination. The local state change comes first and always
 * happens; the workflow cancel and the Sandbox stop are best effort
 * (conventions.md: "Make the escape hatch work when the thing it escapes is
 * broken").
 */
export async function stopExamination(who: Who, examinationId: string) {
  const row = await ownedExamination(who.owner, examinationId);
  if (!row) return { error: "No such Examination." };
  if (isOver(row.status))
    return { examinationId: row.id, stopped: false, status: row.status };
  if (!(await endExaminationIfGoing(row.id, { status: "stopped" }))) {
    const latest = await getExamination(row.id);
    return {
      examinationId: row.id,
      stopped: false,
      status: latest?.status ?? row.status,
    };
  }
  await emit(
    row.id,
    { type: "log", level: "warn", text: "Stopped by its Owner." },
    { type: "end", status: "stopped" },
  ).catch(() => {});
  await audit(who.owner, "examination.stopped", who.via, {
    examinationId: row.id,
  }).catch(() => {});
  if (row.workflow_run_id) {
    try {
      await getWorkflowRun(row.workflow_run_id).cancel({
        cancelReason: "Stopped by its Owner",
      });
    } catch {
      // Already ended, or the workflow is gone: the row is closed either way.
    }
  }
  await disposeSandbox(row.id);
  return { examinationId: row.id, stopped: true, status: "stopped" as const };
}

// Re-evaluate ------------------------------------------------------------------------

export type Reevaluated = {
  examinationId: string;
  fromVersion: number;
  toVersion: number;
  from: Verdict;
  to: Verdict;
  findings: number;
};

/**
 * Decides a finished Examination again under the Owner's current Rulebook,
 * from its stored Measurements. No model call and no Sandbox: `evaluate` and
 * `decide` are pure code. The Trail keeps both Verdicts.
 */
export async function reevaluate(
  who: Who,
  examinationId: string,
): Promise<Reevaluated | { error: string }> {
  const row = await ownedExamination(who.owner, examinationId);
  if (!row) return { error: "No such Examination." };
  if (row.status !== "completed" || !row.verdict)
    return { error: "Only a completed Examination can be re-evaluated." };
  if (!who.visitor.trusted) {
    const rate = await takeRate({
      owner: who.owner,
      visitorHash: who.visitor.hash,
      kind: "reevaluate",
      by: "owner",
      limit: LIMITS.reevaluatesPerOwnerPerHour,
      windowHours: 1,
      what: "re-evaluations",
    });
    if ("refusal" in rate) return { error: rate.refusal };
  }
  const current = await currentRulebook(who.owner);
  const next = { ...row, rulebook: current.rulebook };
  const standing = standingOf(next, row.state);
  const score = await scoreOf(next, standing);
  await updateExamination(row.id, {
    findings: standing.findings,
    verdict: standing.verdict,
    gate: standing.gate,
    score,
    rulebook: current.rulebook,
    rulebook_version: current.version,
  });
  const result: Reevaluated = {
    examinationId: row.id,
    fromVersion: row.rulebook_version,
    toVersion: current.version,
    from: row.verdict.verdict,
    to: standing.verdict.verdict,
    findings: standing.findings.filter((f) => f.weight !== "context").length,
  };
  await emit(
    row.id,
    {
      type: "reevaluated",
      fromVersion: result.fromVersion,
      toVersion: result.toVersion,
      from: result.from,
      to: result.to,
    },
    {
      type: "findings",
      findings: standing.findings,
      verdict: standing.verdict,
      rulebookVersion: current.version,
    },
  );
  await audit(who.owner, "examination.reevaluated", who.via, {
    examinationId: row.id,
    fromVersion: result.fromVersion,
    toVersion: result.toVersion,
    from: result.from,
    to: result.to,
  }).catch(() => {});
  return result;
}
