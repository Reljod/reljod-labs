"use server";

import { resumeHook } from "workflow/api";
import { LIMITS } from "../domain/limits";
import type { RuleEditError } from "../domain/rules";
import { signMcpToken } from "../domain/token";
import { callbackHookToken } from "./call-workflow";
import { requireWorkspace } from "./context";
import { isUuid, sql } from "./db";
import { env } from "./env";
import { messageOf, RuleRefusedError } from "./errors";
import { restoreRule, saveRule } from "./rules";
import { objectSize, uploadUrl } from "./storage";
import { callRow, emit, resetRecords } from "./store";

/**
 * Switchboard's writes outside a live Call. Each passes the gate itself
 * (`requireWorkspace`), because a server action can be posted to any page.
 * They answer `{ error }` rather than throwing, so the button that asked can
 * show it in place.
 */

type Failed = { ok: false; error: string; errors?: RuleEditError[] };

function failed(error: unknown): Failed {
  if (error instanceof RuleRefusedError)
    return { ok: false, error: error.message, errors: error.errors };
  const known = error instanceof Error && error.name !== "Error";
  if (!known) console.error("[switchboard]", messageOf(error));
  return {
    ok: false,
    error: known ? messageOf(error) : "Something went wrong on our side.",
  };
}

export async function saveRuleAction(input: {
  ruleId: string;
  enabled: boolean;
  params: Record<string, unknown>;
  note?: string;
}): Promise<{ ok: true; version: number } | Failed> {
  try {
    const { owner } = await requireWorkspace();
    const saved = await saveRule({ owner, ...input });
    return { ok: true, version: saved.version };
  } catch (error) {
    return failed(error);
  }
}

export async function restoreRuleAction(
  ruleId: string,
): Promise<{ ok: true; version: number } | Failed> {
  try {
    const { owner } = await requireWorkspace();
    const saved = await restoreRule(owner, ruleId);
    return { ok: true, version: saved.version };
  } catch (error) {
    return failed(error);
  }
}

export async function resetBackOfficeAction(): Promise<{ ok: true } | Failed> {
  try {
    const { owner } = await requireWorkspace();
    await resetRecords(owner);
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

/**
 * Mints the token an outside MCP client presents on /api/switchboard/mcp. A
 * Guest's lasts as long as their Guest pass; a Host's 30 days. It is signed,
 * not stored: it is shown once.
 */
export async function mintMcpTokenAction(): Promise<
  { ok: true; token: string; expiresAt: string } | Failed
> {
  try {
    const { access, owner, who } = await requireWorkspace();
    const now = Math.floor(Date.now() / 1000);
    const exp =
      access.kind === "guest"
        ? Math.floor(Date.parse(access.expiresAt) / 1000)
        : access.kind === "host"
          ? now + 30 * 86_400
          : now + 86_400;
    const token = signMcpToken(
      access.kind === "guest"
        ? {
            kind: "guest",
            owner,
            visitor: who.hash,
            user: access.userId,
            pass: access.passId,
            exp,
          }
        : access.kind === "host"
          ? { kind: "host", owner, visitor: who.hash, email: access.email, exp }
          : { kind: "e2e", owner, visitor: who.hash, exp },
      env.rateLimitSalt(),
    );
    const expiresAt = new Date(exp * 1000).toISOString();
    await emit(sql(), owner, null, "owner", "mcp.token", { expiresAt });
    return { ok: true, token, expiresAt };
  } catch (error) {
    return failed(error);
  }
}

/** Wakes a Call's Workflow from its Callback sleep now, instead of at the promised time. */
export async function callbackNowAction(
  callId: string,
): Promise<{ ok: true } | Failed> {
  try {
    const { owner } = await requireWorkspace();
    if (!isUuid(callId) || !(await callRow(owner, callId)))
      return { ok: false, error: "No such Call." };
    try {
      await resumeHook(callbackHookToken(callId), { done: true });
    } catch {
      return { ok: false, error: "That Callback is no longer waiting." };
    }
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

const audioPath = (owner: string, callId: string) =>
  `${owner.replace(/[^a-zA-Z0-9-]/g, "_")}/${callId}.webm`;

/**
 * Where the browser may put a Call's recording. Only a Call started with the
 * consent box ticked gets one.
 */
export async function audioUploadAction(
  callId: string,
): Promise<{ ok: true; url: string } | Failed> {
  try {
    const { owner } = await requireWorkspace();
    const row = isUuid(callId) ? await callRow(owner, callId) : null;
    if (!row) return { ok: false, error: "No such Call." };
    if (!row.consent_audio)
      return { ok: false, error: "This Call was started without consent to keep audio." };
    return { ok: true, url: await uploadUrl(audioPath(owner, callId)) };
  } catch (error) {
    return failed(error);
  }
}

/** Records that the recording is in the bucket, after checking it is. */
export async function audioSavedAction(
  callId: string,
): Promise<{ ok: true; bytes: number } | Failed> {
  try {
    const { owner } = await requireWorkspace();
    const row = isUuid(callId) ? await callRow(owner, callId) : null;
    if (!row?.consent_audio) return { ok: false, error: "No such recording." };
    const path = audioPath(owner, callId);
    const bytes = await objectSize(path);
    if (bytes === null) return { ok: false, error: "The recording did not arrive." };
    if (bytes > LIMITS.audioBytes) return { ok: false, error: "The recording is too large." };
    await sql().begin(async (tx) => {
      await tx`
        update switchboard.calls set audio_path = ${path}
        where id = ${callId} and owner = ${owner}`;
      await emit(tx, owner, callId, "system", "audio.saved", { bytes });
    });
    return { ok: true, bytes };
  } catch (error) {
    return failed(error);
  }
}
