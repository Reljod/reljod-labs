"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { requireOwner } from "@/features/access/server/gate";
import {
  type Box,
  boxSchema,
  type CheckId,
  checkIdSchema,
  type DocumentSource,
  DRIVERS,
  type Driver,
  modelIdSchema,
} from "../domain/contract";
import { LIMITS } from "../domain/limits";
import { env } from "./env";
import {
  type Reevaluated,
  reevaluate,
  startExamination as start,
  stopExamination as stop,
  type Who,
} from "./examinations";
import { signLoupeToken } from "./mcp-token";
import { audit, ensureOwner, takeRate } from "./repository";
import { saveRulebookFor } from "./rulebooks";
import { runCheck } from "./tools";
import { type OpenedUpload, openUpload, type UploadInput } from "./uploads";
import { visitor } from "./visitor";

/*
 * Every action passes the Access gate through `requireOwner()` and scopes
 * what it writes to the Owner (ADR 0011). A server action can be posted to
 * any page, so the check lives here, not only in the proxy. Each calls the
 * same server function the MCP server calls. Reads are GET routes under
 * /api/loupe (domain/api.ts).
 */

/** e2e only: with the bypass token, the Examiner is scripted unless this header asks for the live model. */
const LIVE_HEADER = "x-loupe-live";

async function who(): Promise<Who & { stub: boolean }> {
  const [{ owner }, seen] = await Promise.all([requireOwner(), visitor()]);
  const live = (await headers()).get(LIVE_HEADER) === "1";
  return {
    owner,
    visitor: { hash: seen.hash, trusted: seen.trusted },
    origin: seen.origin,
    via: "app",
    stub: seen.trusted && !live,
  };
}

const sourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("sample"), sampleId: z.string().min(1).max(60) }),
  z.object({ kind: z.literal("upload"), uploadId: z.string().uuid() }),
]);

/** Starts an Examination of a Sample or of one of the Owner's Uploads. */
export async function startExamination(input: {
  source: DocumentSource;
  driver?: Driver;
  model?: string;
}): Promise<{ examinationId: string } | { error: string }> {
  const caller = await who();
  const source = sourceSchema.safeParse(input?.source);
  if (!source.success) return { error: "Pick a Sample or an Upload." };
  const driver =
    input?.driver && input.driver in DRIVERS ? input.driver : "examiner";
  const model = modelIdSchema.safeParse(input?.model);
  return start(caller, {
    source: source.data,
    driver,
    model: model.success ? model.data : undefined,
    stub: caller.stub,
  });
}

/** Stops one of the Owner's Examinations. Never asks first: it is the escape hatch. */
export async function stopExamination(
  examinationId: string,
): Promise<{ stopped: boolean } | { error: string }> {
  const result = await stop(await who(), String(examinationId));
  return "error" in result
    ? { error: result.error ?? "It could not be stopped." }
    : { stopped: result.stopped };
}

/** Decides a completed Examination again under the Owner's current Rulebook. No model call. */
export async function reevaluateExamination(
  examinationId: string,
): Promise<Reevaluated | { error: string }> {
  return reevaluate(await who(), String(examinationId));
}

const checkSchema = z.object({
  examinationId: z.string().uuid(),
  check: checkIdSchema,
  page: z.number().int().min(1).max(200).optional(),
  box: boxSchema.nullable().optional(),
});

/**
 * Runs one named Check again on one of the Owner's Examinations, on a page or
 * a region: the same function, cap and Trail as the MCP tool `run_check`.
 */
export async function runCheckAgain(input: {
  examinationId: string;
  check: CheckId;
  page?: number;
  box?: Box | null;
}): Promise<{ ok: true; text: string } | { error: string }> {
  const caller = await who();
  const parsed = checkSchema.safeParse(input);
  if (!parsed.success) return { error: "That Check call doesn't look right." };
  const outcome = await runCheck(
    {
      owner: caller.owner,
      visitor: caller.visitor,
      role: { kind: "client" },
      origin: caller.origin,
    },
    parsed.data,
  );
  return outcome.ok
    ? { ok: true, text: outcome.text }
    : { error: outcome.text.slice(0, 300) };
}

/** Saves the Rulebook as the Owner's next version. */
export async function saveRulebook(input: {
  rulebook: unknown;
  note?: string;
}): Promise<{ version: number; changes: string[] } | { error: string }> {
  return saveRulebookFor(await who(), {
    rulebook: input?.rulebook,
    note: input?.note,
  });
}

/** Opens an Upload (or a Forgery from the bench): a row and a signed URL the browser PUTs the file to. */
export async function createUpload(
  input: UploadInput,
): Promise<OpenedUpload | { error: string }> {
  return openUpload(await who(), input);
}

/**
 * A bearer token for an outside MCP client (Claude Code, say) to act for this
 * Owner on /api/loupe/mcp. A Guest's lasts as long as their Guest pass and
 * dies when it is revoked; a Host's lasts 30 days. Shown once, never stored.
 */
export async function mintMcpToken(): Promise<
  { token: string; expiresAt: string } | { error: string }
> {
  const [{ access, owner }, seen] = await Promise.all([
    requireOwner(),
    visitor(),
  ]);
  if (!seen.trusted) {
    const rate = await takeRate({
      owner,
      visitorHash: seen.hash,
      kind: "token",
      by: "owner",
      limit: LIMITS.mcpTokensPerOwnerPerDay,
      windowHours: 24,
      what: "tokens",
    });
    if ("refusal" in rate) return { error: rate.refusal };
  }
  const now = Math.floor(Date.now() / 1000);
  const exp =
    access.kind === "guest"
      ? Math.floor(Date.parse(access.expiresAt) / 1000)
      : access.kind === "host"
        ? now + 30 * 86_400
        : now + 86_400;
  const token = signLoupeToken(
    access.kind === "guest"
      ? {
          kind: "guest",
          owner,
          visitor: seen.hash,
          user: access.userId,
          pass: access.passId,
          exp,
        }
      : access.kind === "host"
        ? { kind: "host", owner, visitor: seen.hash, email: access.email, exp }
        : { kind: "e2e", owner, visitor: seen.hash, exp },
    env.rateLimitSalt(),
  );
  await ensureOwner(owner);
  await audit(owner, "token.minted", "app", {
    kind: access.kind,
    expiresAt: new Date(exp * 1000).toISOString(),
  });
  return { token, expiresAt: new Date(exp * 1000).toISOString() };
}
