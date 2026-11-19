"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { requireOwner } from "@/features/access/server/gate";
import {
  type HandInput,
  handInputSchema,
  type ManifestSummary,
  type ModelId,
  modelSchema,
  type TaskRef,
  taskRefSchema,
} from "../domain/contract";
import { LIMITS, STUB_HEADER } from "../domain/limits";
import { type Rulebook, rulebookSchema } from "../domain/rules";
import { env } from "./env";
import {
  createManifestUpload as openUpload,
  readManifest as read,
} from "./manifests";
import { signOperatorToken } from "./mcp-token";
import { insertRulebook } from "./repository";
import {
  decideApproval as decide,
  submitHandRun as fileHandRun,
  startRun as start,
  stopRun as stop,
} from "./runs";
import { visitor } from "./visitor";

/*
 * Every action passes the Access gate through `requireOwner()` and scopes
 * what it writes to the Owner (ADR 0011). A server action can be posted to
 * any page, so the check lives here, not only in the proxy. Reads are GET
 * routes under /api/operator (server/reads.ts).
 */

async function wantsStub() {
  const bypass = env.e2eBypassToken();
  return Boolean(bypass) && (await headers()).get(STUB_HEADER) === bypass;
}

/** Starts a Run the Operator drives. */
export async function startRun(input: {
  task: TaskRef;
  manifestId?: string | null;
  model?: ModelId;
}): Promise<{ runId: string } | { error: string }> {
  const { owner } = await requireOwner();
  const task = taskRefSchema.safeParse(input?.task);
  if (!task.success) return { error: "Pick a sample Task or write your own." };
  const model = input?.model ? modelSchema.safeParse(input.model) : null;
  if (model && !model.success) return { error: "Unknown model." };
  const manifestId = input?.manifestId
    ? z.string().uuid().safeParse(input.manifestId)
    : null;
  if (manifestId && !manifestId.success) return { error: "No such Manifest." };
  return start({
    owner,
    visitor: await visitor(),
    task: task.data,
    manifestId: manifestId?.data ?? null,
    model: model?.data,
    driver: "operator",
    stubbed: await wantsStub(),
  });
}

/** Stops one of the Owner's Runs. Never asks first: it is the escape hatch. */
export async function stopRun(
  runId: string,
): Promise<{ runId: string; stopped: boolean } | { error: string }> {
  const { owner } = await requireOwner();
  const result = await stop(owner, String(runId));
  return "error" in result
    ? result
    : { runId: result.runId, stopped: result.stopped };
}

/** A person's decision on a paused Action. */
export async function decideApproval(input: {
  runId: string;
  approvalId: string;
  decision: "approved" | "refused";
}): Promise<{ ok: true } | { error: string }> {
  const { owner } = await requireOwner();
  const parsed = z
    .object({
      runId: z.string().uuid(),
      approvalId: z.string().uuid(),
      decision: z.enum(["approved", "refused"]),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "That decision doesn't look right." };
  return decide({ owner, ...parsed.data, by: "person" });
}

/** Saves the Rulebook as the Owner's next version. */
export async function saveRulebook(input: {
  rulebook: Rulebook;
  note?: string;
}): Promise<{ version: number } | { error: string }> {
  const { owner } = await requireOwner();
  const rulebook = rulebookSchema.safeParse(input?.rulebook);
  if (!rulebook.success)
    return {
      error: rulebook.error.issues
        .slice(0, 3)
        .map(
          (issue) => `${issue.path.join(".") || "rulebook"}: ${issue.message}`,
        )
        .join("; "),
    };
  const note =
    typeof input?.note === "string" && input.note.trim()
      ? input.note.trim().slice(0, 500)
      : null;
  const who = await visitor();
  const saved = await insertRulebook(
    owner,
    rulebook.data,
    note,
    who.trusted ? null : LIMITS.rulebooksPerOwnerPerDay,
  );
  return "refusal" in saved ? { error: saved.refusal } : saved;
}

/** Opens a Manifest upload: a row and a signed URL the browser PUTs the file to. */
export async function createManifestUpload(input: {
  name: string;
  size: number;
}): Promise<
  | { manifestId: string; signedUrl: string; token: string; path: string }
  | { error: string }
> {
  const { owner } = await requireOwner();
  return openUpload({
    owner,
    visitor: await visitor(),
    name: String(input?.name ?? ""),
    size: Number(input?.size),
  });
}

/** Reads an uploaded Manifest (CSV or PDF) into rows. Call after the upload finished. */
export async function readManifest(
  manifestId: string,
): Promise<ManifestSummary | { error: string }> {
  const { owner } = await requireOwner();
  return read(owner, String(manifestId));
}

/** Files a "take the keyboard" attempt: the server replays the inputs and checks them. */
export async function submitHandRun(input: {
  taskId: string;
  inputs: HandInput[];
  elapsedMs: number;
}): Promise<{ runId: string } | { error: string }> {
  const { owner } = await requireOwner();
  const parsed = z
    .object({
      taskId: z.string().min(1).max(60),
      inputs: z.array(handInputSchema).min(1).max(LIMITS.handInputs),
      elapsedMs: z.number().min(0).max(86_400_000),
    })
    .safeParse(input);
  if (!parsed.success)
    return { error: "That attempt could not be read. Try it again." };
  return fileHandRun({ owner, visitor: await visitor(), ...parsed.data });
}

/**
 * A bearer token for an outside MCP client (Claude Code, say) to act for this
 * Owner on /api/operator/mcp. A Guest's lasts as long as their Guest pass and
 * dies when it is revoked; a Host's lasts 30 days.
 */
export async function mintMcpToken(): Promise<{
  token: string;
  expiresAt: string;
}> {
  const { access, owner } = await requireOwner();
  const who = await visitor();
  const now = Math.floor(Date.now() / 1000);
  const exp =
    access.kind === "guest"
      ? Math.floor(Date.parse(access.expiresAt) / 1000)
      : access.kind === "host"
        ? now + 30 * 86_400
        : now + 86_400;
  const token = signOperatorToken(
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
  return { token, expiresAt: new Date(exp * 1000).toISOString() };
}
