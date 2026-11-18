"use server";

import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { requireOwner } from "@/features/access/server/gate";
import {
  type DocumentSource,
  type ModelChoice,
  modelChoiceSchema,
  type Rulebook,
  rulebookSchema,
} from "../domain/contract";
import { env } from "./env";
import { countUploadsSince, insertRulebook, insertUpload } from "./repository";
import { LIMITS, startRun as start, stopRun as stop } from "./runs";
import { BUCKET, supabase } from "./supabase";
import { signSieveToken } from "./toolkit/mcp-token";
import { UPLOAD_LIMITS } from "./toolkit/upload";
import { visitor } from "./visitor";

/*
 * Every action passes the Access gate through `requireOwner()` and scopes
 * what it writes to the Owner (ADR 0011). A server action can be posted to
 * any page, so the check lives here, not only in the proxy. Reads are GET
 * routes under /api/name-extraction (server/reads.ts): Next sends a client's
 * actions one at a time, so a read made as an action waits behind the rest.
 */

const sourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("corpus"), corpusId: z.string().min(1).max(40) }),
  z.object({ kind: z.literal("upload"), uploadId: z.string().uuid() }),
]);

/** Starts a Run over a Corpus Document or one of the Owner's Uploads. */
export async function startRun(input: {
  source: DocumentSource;
  models?: ModelChoice;
}): Promise<{ runId: string } | { error: string }> {
  const { owner } = await requireOwner();
  const source = sourceSchema.safeParse(input?.source);
  if (!source.success) return { error: "Pick a Corpus Document or an upload." };
  const models = input?.models
    ? modelChoiceSchema.safeParse(input.models)
    : null;
  if (models && !models.success) return { error: "Unknown model." };
  return start({
    owner,
    visitor: await visitor(),
    source: source.data,
    models: models?.data,
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

/** Saves the Rulebook as the Owner's next version. */
export async function saveRulebook(input: {
  rulebook: Rulebook;
  note?: string;
}): Promise<{ version: number } | { error: string }> {
  const { owner } = await requireOwner();
  const rulebook = rulebookSchema.safeParse(input?.rulebook);
  if (!rulebook.success) {
    return {
      error: rulebook.error.issues
        .slice(0, 3)
        .map(
          (issue) => `${issue.path.join(".") || "rulebook"}: ${issue.message}`,
        )
        .join("; "),
    };
  }
  if (rulebook.data.dropBelow > rulebook.data.reviewBelow)
    return { error: "Drop below must not be above review below." };
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

/** A stable, non-reversible folder per Owner: no raw input reaches a storage key. */
function ownerFolder(owner: string) {
  return createHash("sha256")
    .update(`name-extraction:${owner}`)
    .digest("hex")
    .slice(0, 32);
}

/**
 * Opens an Upload: a row and a signed URL the browser PUTs the pages to, as
 * JSON `{ pages: string[] }`. The pages are checked when a Run loads them
 * (at most 500 pages of 20k characters).
 */
export async function createUpload(input: {
  title: string;
  pages: number;
}): Promise<
  | { uploadId: string; signedUrl: string; token: string; path: string }
  | { error: string }
> {
  const { owner } = await requireOwner();
  const title = String(input?.title ?? "")
    .replace(/\p{Cc}+/gu, " ")
    .trim()
    .slice(0, 200);
  const pages = Math.trunc(Number(input?.pages));
  if (!title) return { error: "Give the upload a title." };
  if (!(pages >= 1 && pages <= UPLOAD_LIMITS.pages))
    return { error: `An upload has 1 to ${UPLOAD_LIMITS.pages} pages.` };
  const who = await visitor();
  if (
    !who.trusted &&
    (await countUploadsSince(owner, new Date(Date.now() - 86_400_000))) >=
      LIMITS.uploadsPerOwnerPerDay
  ) {
    return {
      error: `That's ${LIMITS.uploadsPerOwnerPerDay} uploads today. Try again tomorrow.`,
    };
  }
  const uploadId = randomUUID();
  const path = `uploads/${ownerFolder(owner)}/${uploadId}.json`;
  const { data, error } = await supabase()
    .storage.from(BUCKET)
    .createSignedUploadUrl(path, { upsert: false });
  if (error || !data)
    return { error: "The upload could not be opened. Try again." };
  await insertUpload({ id: uploadId, owner, title, pages, storagePath: path });
  return { uploadId, signedUrl: data.signedUrl, token: data.token, path };
}

/**
 * A bearer token for an outside MCP client (Claude Code, say) to act for this
 * Owner on /api/name-extraction/mcp. A Guest's lasts as long as their Guest
 * pass and dies when it is revoked; a Host's lasts 30 days.
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
  const token = signSieveToken(
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
