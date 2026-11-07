"use server";

import { headers } from "next/headers";
import { E2E_HEADER } from "../constants";
import { findPack } from "../packs";
import type { RunView, StartResult } from "../view";
import { env } from "./env";
import { E2E_VISITOR, hashVisitor, rateLimitMessage } from "./rate-limit";
import { latestCompletedRunId, loadRun } from "./repository";
import { runPrescreen } from "./run-prescreen";

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

  const { runId, error } = await runPrescreen(pack, hash);
  return error
    ? { status: "failed", runId, message: error }
    : { status: "completed", runId };
}

export async function getRun(runId: string): Promise<RunView | null> {
  return loadRun(runId);
}
