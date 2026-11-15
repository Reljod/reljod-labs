"use server";

import { headers } from "next/headers";
import { start } from "workflow/api";
import { DENIED_MESSAGE } from "@/features/access/constants";
import { ownerOf } from "@/features/access/domain/owner";
import {
  type Access,
  currentAccess,
  requireOwner,
} from "@/features/access/server/gate";
import { E2E_HEADER } from "../constants";
import { individualOnboarding } from "../domain/rulebook";
import { findPack } from "../packs";
import type { RunView, SessionRunView, StartResult } from "../view";
import { env } from "./env";
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

  const runId = await createRun({
    packSlug: pack.slug,
    rulebook: individualOnboarding,
    declaration: pack.clientDeclaration,
    visitorHash: hash,
    owner,
    model: env.model(),
  });
  try {
    const run = await start(prescreenWorkflow, [
      {
        runId,
        packSlug: pack.slug,
        kinds: pack.documents.map((document) => document.kind),
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
