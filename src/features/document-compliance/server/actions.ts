"use server";

import { headers } from "next/headers";
import { start } from "workflow/api";
import { E2E_HEADER } from "../constants";
import { individualOnboarding } from "../domain/rulebook";
import { findPack } from "../packs";
import type { RunView, StartResult } from "../view";
import { env } from "./env";
import { prescreenWorkflow } from "./prescreen-workflow";
import { E2E_VISITOR, hashVisitor, rateLimitMessage } from "./rate-limit";
import {
  createRun,
  failRun,
  latestCompletedRunId,
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

export async function startPrescreen(packSlug: string): Promise<StartResult> {
  const pack = findPack(packSlug);
  if (!pack) throw new Error(`Unknown pack ${packSlug}`);

  const { hash, limited } = await visitor();
  if (limited) {
    const message = await rateLimitMessage(hash);
    if (message) {
      return {
        status: "limited",
        runId: await latestCompletedRunId(pack.slug),
        message,
      };
    }
  }

  const runId = await createRun({
    packSlug: pack.slug,
    rulebook: individualOnboarding,
    declaration: pack.clientDeclaration,
    visitorHash: hash,
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

export async function getRun(runId: string): Promise<RunView | null> {
  return loadRun(runId);
}
