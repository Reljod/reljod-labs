"use server";

import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { requireOwner } from "@/features/access/server/gate";
import {
  type CorpusCard,
  type DocumentSource,
  type ExtractedName,
  type ModelChoice,
  modelChoiceSchema,
  type Rulebook,
  type RulebookVersion,
  type RunDetail,
  type RunSummary,
  rulebookSchema,
} from "../domain/contract";
import { corpusCards } from "../domain/corpus";
import { env } from "./env";
import {
  allEvents,
  countUploadsSince,
  currentRulebook,
  insertRulebook,
  insertUpload,
  isOver,
  ownedRun,
  rulebookVersions,
  runsOf,
  toSummary,
} from "./repository";
import {
  closeIfStale,
  LIMITS,
  startRun as start,
  stopRun as stop,
} from "./runs";
import { BUCKET, supabase } from "./supabase";
import { signSieveToken } from "./toolkit/mcp-token";
import { UPLOAD_LIMITS } from "./toolkit/upload";
import { visitor } from "./visitor";

/*
 * Every action passes the Access gate through `requireOwner()` and scopes
 * what it reads or writes to the Owner (ADR 0011). A server action can be
 * posted to any page, so the check lives here, not only in the proxy.
 */

const sourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("corpus"), corpusId: z.string().min(1).max(40) }),
  z.object({ kind: z.literal("upload"), uploadId: z.string().uuid() }),
]);

/** The Corpus Documents as cards for the picker. */
export async function listCorpus(): Promise<CorpusCard[]> {
  await requireOwner();
  return corpusCards();
}

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

/** The Owner's Runs, newest first. */
export async function listRuns(): Promise<RunSummary[]> {
  const { owner } = await requireOwner();
  const rows = await runsOf(owner, 50);
  return (await Promise.all(rows.map(closeIfStale))).map(toSummary);
}

/** One of the Owner's Runs with its Audit trail and its Register. */
export async function getRun(runId: string): Promise<RunDetail | null> {
  const { owner } = await requireOwner();
  const found = await ownedRun(owner, String(runId));
  if (!found) return null;
  const run = await closeIfStale(found);
  const events = await allEvents(run.id);
  let names: ExtractedName[] = Array.isArray(run.names) ? run.names : [];
  if (!isOver(run.status) || names.length === 0) {
    // While a Run goes, the Register is its latest `names` event.
    for (let index = events.length - 1; index >= 0; index--) {
      const event = events[index];
      if (event.type === "names") {
        names = event.names;
        break;
      }
    }
  }
  // The detail carries the list in place of the summary's count.
  const { names: _count, ...summary } = toSummary(run);
  return { ...summary, events, names };
}

/** The Owner's current Rulebook (version 0 is the built-in default). */
export async function getRulebook(): Promise<RulebookVersion> {
  const { owner } = await requireOwner();
  return currentRulebook(owner);
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

/** Every Rulebook version the Owner saved, newest first, then the default. */
export async function rulebookHistory(): Promise<RulebookVersion[]> {
  const { owner } = await requireOwner();
  return rulebookVersions(owner);
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
