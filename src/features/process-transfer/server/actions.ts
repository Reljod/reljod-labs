"use server";

import { AccessDeniedError, requireOwner } from "@/features/access/server/gate";
import { exportRefusal } from "../domain/approval";
import type { ModelChoice } from "../domain/models";
import type { Rule, RuleOverride, RuleOverrides } from "../domain/rules";
import type {
  ExportKind,
  Result,
  StartInput,
  UploadTicket,
} from "../domain/run";
import { auditPerson } from "./audit";
import { ownedRun } from "./repository";
import {
  LimitError,
  prepareUpload,
  redoDeck as redo,
  startRun as start,
  stopRun as stop,
  visitorOf,
} from "./runs";
import {
  resetRules as reset,
  SettingsError,
  saveModels as storeModels,
  saveRule as storeRule,
} from "./settings";

/*
 * The page's writes. Every function passes the Access gate and works only
 * on the calling Owner's data: ids from the browser are looked up together
 * with the Owner, never on their own. Reads are GET routes (`./reads.ts`):
 * Next sends server actions one at a time, so a read here would queue.
 */

/** Turns a refusal into a Result; anything unexpected is logged and told plainly. */
async function attempt<T extends object>(
  work: () => Promise<T>,
): Promise<Result<T>> {
  try {
    return { ok: true, ...(await work()) };
  } catch (error) {
    if (
      error instanceof LimitError ||
      error instanceof SettingsError ||
      error instanceof AccessDeniedError
    ) {
      return { ok: false, error: error.message };
    }
    console.error("[process-transfer]", error);
    return { ok: false, error: "Something went wrong. Try again." };
  }
}

export async function createUpload(input: {
  name: string;
  size: number;
  type: string;
}): Promise<Result<UploadTicket>> {
  return attempt(async () => {
    const { access, owner } = await requireOwner();
    return prepareUpload(owner, await visitorOf(access), {
      name: input?.name,
      size: input?.size,
      type: input?.type,
    });
  });
}

export async function startRun(
  input: StartInput,
): Promise<Result<{ runId: string }>> {
  return attempt(async () => {
    const { access, owner } = await requireOwner();
    const runId = await start(owner, await visitorOf(access), input);
    return { runId };
  });
}

export async function stopRun(runId: string): Promise<Result> {
  return attempt(async () => {
    const { owner } = await requireOwner();
    await stop(owner, runId);
    return {};
  });
}

export async function redoDeck(
  runId: string,
): Promise<Result<{ runId: string }>> {
  return attempt(async () => {
    const { access, owner } = await requireOwner();
    return { runId: await redo(owner, await visitorOf(access), runId) };
  });
}

type RulesResult = Result<{
  rules: Rule[];
  ruleOverrides: RuleOverrides;
  rulesVersion: number;
}>;

export async function saveRule(
  ruleId: string,
  override: RuleOverride | null,
): Promise<RulesResult> {
  return attempt(async () => {
    const { owner } = await requireOwner();
    const saved = await storeRule(owner, ruleId, override);
    return {
      rules: saved.rules,
      ruleOverrides: saved.ruleOverrides,
      rulesVersion: saved.rulesVersion,
    };
  });
}

export async function resetRules(): Promise<RulesResult> {
  return attempt(async () => {
    const { owner } = await requireOwner();
    const saved = await reset(owner);
    return {
      rules: saved.rules,
      ruleOverrides: saved.ruleOverrides,
      rulesVersion: saved.rulesVersion,
    };
  });
}

export async function saveModels(
  models: ModelChoice,
): Promise<Result<{ models: ModelChoice }>> {
  return attempt(async () => {
    const { owner } = await requireOwner();
    const saved = await storeModels(owner, models);
    return { models: saved.models };
  });
}

export async function recordExport(
  runId: string,
  kind: ExportKind,
): Promise<Result> {
  return attempt(async () => {
    const { owner } = await requireOwner();
    const run = await ownedRun(owner, runId);
    if (!run) throw new LimitError("There is no such Run.");
    const refusal = exportRefusal(kind, {
      hasProcess: run.process !== null,
      approval: run.approval?.status ?? null,
    });
    if (refusal) throw new LimitError(refusal);
    const round = run.rounds.at(-1)?.round ?? null;
    await auditPerson({
      owner,
      action: "export.downloaded",
      runId: run.id,
      summary:
        kind === "pptx"
          ? `Downloaded the Deck of "${run.title}" (round ${round}) as PPTX`
          : `Downloaded the workflow document of "${run.title}" as DOCX`,
      detail: { kind, round, rulesVersion: run.rules_version },
    });
    return {};
  });
}
