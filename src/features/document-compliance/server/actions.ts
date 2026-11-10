"use server";

import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { start } from "workflow/api";
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
  listSessionRuns,
  loadRun,
  setWorkflowRunId,
} from "./repository";

/** The cookie that groups one browser's Pre-screen runs into a Session (ADR 0007). */
const SESSION_COOKIE = "prescreen_session";
const SESSION_DAYS = 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function currentSessionId() {
  const value = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  return UUID.test(value) ? value : null;
}

/** The visitor's Session id, starting a Session (and its cookie) if there is none. */
async function ensureSessionId() {
  const existing = await currentSessionId();
  const id = existing ?? randomUUID();
  // Refreshed on every run, so a Session lasts as long as its newest run is kept.
  (await cookies()).set(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/demos/document-compliance",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
  return id;
}

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
    return await startRun(packSlug);
  } catch (error) {
    console.error("[document-compliance] could not start a Pre-screen", error);
    return {
      status: "error",
      message:
        "The Pre-screen could not start because of a server error. Try again in a moment.",
    };
  }
}

async function startRun(packSlug: string): Promise<StartResult> {
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
    sessionId: await ensureSessionId(),
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

/** The runs this browser started, newest first; empty before its first run. */
export async function getSessionRuns(): Promise<SessionRunView[]> {
  const sessionId = await currentSessionId();
  return sessionId ? listSessionRuns(sessionId) : [];
}
