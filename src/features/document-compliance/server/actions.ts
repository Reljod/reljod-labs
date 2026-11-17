"use server";

import { headers } from "next/headers";
import { start } from "workflow/api";
import { DENIED_MESSAGE } from "@/features/access/constants";
import { type Owner, ownerOf } from "@/features/access/domain/owner";
import {
  type Access,
  currentAccess,
  requireOwner,
} from "@/features/access/server/gate";
import { E2E_HEADER } from "../constants";
import {
  type AuditActor,
  type AuditPage,
  isAuditAction,
} from "../domain/audit";
import type { ReviewInput } from "../domain/review";
import { resolveRulebook } from "../domain/rules";
import { findPack } from "../packs";
import type { RunView, SessionRunView, StartResult } from "../view";
import { actorOf, audit, listAuditEvents } from "./audit";
import { env } from "./env";
import {
  type ReevaluateResult,
  type ReviewResult,
  reevaluateRun as reevaluate,
  reviewFinding as review,
} from "./evaluations";
import { prescreenWorkflow } from "./prescreen-workflow";
import { E2E_VISITOR, hashVisitor, rateLimitMessage } from "./rate-limit";
import {
  createRun,
  failRun,
  latestCompletedRunId,
  listOwnerRuns,
  loadRun,
  setWorkflowRunId,
} from "./repository";
import { ownerRuleStates } from "./rules";

async function visitor() {
  const requestHeaders = await headers();
  const bypass = env.e2eBypassToken();
  if (bypass && requestHeaders.get(E2E_HEADER) === bypass) {
    return { hash: E2E_VISITOR, limited: false };
  }
  const ip =
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    requestHeaders.get("x-real-ip") ??
    "unknown";
  return { hash: hashVisitor(ip, env.rateLimitSalt()), limited: true };
}

/**
 * A production build hides a thrown Server Action error behind a bare React
 * error code, so a failure to start is logged here and returned as a message.
 */
export async function startPrescreen(packSlug: string): Promise<StartResult> {
  try {
    const access = await currentAccess();
    if (!access) {
      return { status: "error", message: DENIED_MESSAGE };
    }
    return await startRun(packSlug, access);
  } catch (error) {
    console.error("[document-compliance] could not start a Pre-screen", error);
    return {
      status: "error",
      message:
        "The Pre-screen could not start because of a server error. Try again in a moment.",
    };
  }
}

async function startRun(
  packSlug: string,
  access: Access,
): Promise<StartResult> {
  const owner = ownerOf(access);
  const pack = findPack(packSlug);
  if (!pack) throw new Error(`Unknown pack ${packSlug}`);

  const { hash, limited } = await visitor();
  if (limited) {
    const message = await rateLimitMessage(hash);
    if (message) {
      return {
        status: "limited",
        runId: await latestCompletedRunId(pack.slug, owner),
        message,
      };
    }
  }

  // The Owner's Rules as they are now; the run keeps them (ADR 0019).
  const rulebook = resolveRulebook(await ownerRuleStates(owner));
  const runId = await createRun({
    packSlug: pack.slug,
    rulebook,
    declaration: pack.clientDeclaration,
    visitorHash: hash,
    owner,
    model: env.model(),
  });
  try {
    // Paid work starts only once its Audit event has landed.
    await audit({
      owner,
      runId,
      actor: actorOf(access),
      action: "run.started",
      summary: `${pack.title}: ${pack.documents.length} documents, ${rulebook.requirements.length} Requirements`,
      details: {
        pack: pack.slug,
        model: env.model(),
        requirements: rulebook.requirements.length,
        editedRules: rulebook.applied
          .filter((rule) => rule.version > 0)
          .map(({ ruleId, version }) => ({ ruleId, version })),
      },
    });
    const run = await start(prescreenWorkflow, [
      {
        runId,
        packSlug: pack.slug,
        kinds: pack.documents.map((document) => document.kind),
        rules: rulebook.applied,
        owner,
      },
    ]);
    await setWorkflowRunId(runId, run.runId);
  } catch (error) {
    await failRun(
      runId,
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
  return { status: "started", runId };
}

/** One of the Owner's runs; null for a run someone else started. */
export async function getRun(runId: string): Promise<RunView | null> {
  const { owner } = await requireOwner();
  return loadRun(runId, owner);
}

/**
 * The runs this Owner started, newest first, on any device: a Host's
 * browsers, or every device on a Guest pass. Empty before the first run.
 */
export async function getSessionRuns(): Promise<SessionRunView[]> {
  const { owner } = await requireOwner();
  return listOwnerRuns(owner);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Runs a write for the signed-in Owner, turning a server error into a message. */
async function asOwner<T extends { ok: boolean }>(
  what: string,
  work: (owner: Owner, actor: AuditActor) => Promise<T>,
): Promise<T | { ok: false; message: string }> {
  try {
    const access = await currentAccess();
    if (!access) return { ok: false, message: DENIED_MESSAGE };
    return await work(ownerOf(access), actorOf(access));
  } catch (error) {
    console.error(`[document-compliance] could not ${what}`, error);
    return {
      ok: false,
      message: `Could not ${what} because of a server error. Try again in a moment.`,
    };
  }
}

/** Evaluates a finished run again with the Owner's current Rules; no model is called. */
export async function reevaluateRun(
  runId: string,
): Promise<ReevaluateResult | { ok: false; message: string }> {
  if (!UUID.test(runId)) return { ok: false, message: "No such run." };
  return asOwner("re-evaluate the run", (owner, actor) =>
    reevaluate(owner, actor, runId),
  );
}

/** A Reviewer's decision on a flagged Finding of the run's latest Evaluation. */
export async function reviewFinding(
  runId: string,
  requirementId: string,
  input: ReviewInput,
): Promise<ReviewResult> {
  if (!UUID.test(runId)) return { ok: false, message: "No such run." };
  return asOwner("save the decision", (owner, actor) =>
    review(owner, actor, runId, requirementId, input),
  );
}

/** The Owner's Audit trail, newest first, optionally for one run or one action. */
export async function getAuditTrail(filter: {
  runId?: string | null;
  action?: string | null;
  before?: number | null;
}): Promise<AuditPage> {
  const { owner } = await requireOwner();
  const runId = filter.runId && UUID.test(filter.runId) ? filter.runId : null;
  if (filter.runId && !runId) return { events: [], before: null };
  return listAuditEvents(owner, {
    runId,
    action: isAuditAction(filter.action) ? filter.action : null,
    before:
      typeof filter.before === "number" && Number.isInteger(filter.before)
        ? filter.before
        : null,
  });
}
