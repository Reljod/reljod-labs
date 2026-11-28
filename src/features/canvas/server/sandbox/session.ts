import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { Sandbox } from "@vercel/sandbox";
import type { Owner } from "@/features/access/domain/owner";
import { db } from "@/server/postgres";
import { LIMITS } from "../../domain/limits";
import { BUCKET, env } from "../env";
import { SandboxUnavailable } from "../errors";
import type { Job, JobAnswer, SandboxRunner } from "../ports";
import { storage } from "../supabase";
import { ensureImage, forgetImage, IMAGE_KEY } from "./image";
import { localPython, runLocal } from "./local";
import {
  disposeOptions,
  lostCreateRace,
  ownerSandboxOptions,
  ownerSandboxUpdate,
} from "./options";
import { INBOX_DIR, RUNNER_PATH } from "./runner-source";

/*
 * An Owner's Sandbox (ADR 0032): a microVM with no network, started from the
 * image, found again by name from any function instance while it runs. It
 * holds the shared Catalog and this Owner's Uploads (`/data/uploads.duckdb`),
 * which is why it is one per Owner and never shared. It is not persistent
 * (`options.ts`): when it stops its disk is gone, the next Query starts a
 * fresh one from the image, and Uploads are put back from Storage. Everything
 * the server asks of it is one job for the runner: one command, one JSON
 * answer.
 */

const MINUTE = 60_000;
const EXTEND_BELOW_MINUTES = 4;
const EXTEND_BY_MINUTES = 15;
/** A job longer than this goes in as a file, not on the command line. */
const ARGV_CHARS = 90_000;

const hash = (text: string, length: number) =>
  createHash("sha256").update(text).digest("hex").slice(0, length);

/** The Owner's Sandbox name. It carries the image key, so a new image means a new Sandbox. */
export const sandboxName = (owner: Owner) =>
  `canvas-${hash(owner, 24)}-${hash(IMAGE_KEY, 8)}`;

/** Why the SDK failed, safe to show: the HTTP status and Vercel's error code only. */
function reasonOf(error: unknown) {
  const e = error as {
    response?: { status?: number };
    json?: { error?: { code?: unknown } };
    code?: unknown;
    name?: string;
  };
  const parts: string[] = [];
  if (typeof e?.response?.status === "number")
    parts.push(`HTTP ${e.response.status}`);
  const code = e?.json?.error?.code ?? e?.code;
  if (typeof code === "string" && /^[\w.-]{1,60}$/.test(code)) parts.push(code);
  return parts.join(" ") || e?.name || "error";
}

const held = new Map<string, Sandbox>();

/** Starts in flight, by Sandbox name: callers at the same moment share one. */
const starting = new Map<
  string,
  Promise<{ sandbox: Sandbox; created: boolean }>
>();

/**
 * The Owner's Sandbox, started at most once at a time. The Analyst often
 * calls several tools at once; each would otherwise race to create the same
 * name, and every loser was refused ("already exists").
 */
function open(owner: Owner): Promise<{ sandbox: Sandbox; created: boolean }> {
  const name = sandboxName(owner);
  const running = starting.get(name);
  if (running) return running;
  const start = openOnce(owner).finally(() => starting.delete(name));
  starting.set(name, start);
  return start;
}

async function openOnce(
  owner: Owner,
): Promise<{ sandbox: Sandbox; created: boolean }> {
  if (!env.sandboxConfigured())
    throw new SandboxUnavailable("Sandbox unavailable: it is not set up here.");
  const name = sandboxName(owner);
  const kept = held.get(name);
  if (kept) {
    const left = (kept.expiresAt?.getTime() ?? 0) - Date.now();
    if (left > MINUTE) {
      if (left < EXTEND_BELOW_MINUTES * MINUTE)
        await kept
          .extendTimeout(EXTEND_BY_MINUTES * MINUTE)
          .catch(() => held.delete(name));
      if (held.has(name)) return { sandbox: kept, created: false };
    }
    held.delete(name);
  }
  const snapshotId = await ensureImage();
  let created = false;
  const make = () =>
    Sandbox.getOrCreate({
      ...ownerSandboxOptions(name, snapshotId),
      onCreate: async () => {
        created = true;
      },
    } as Parameters<typeof Sandbox.getOrCreate>[0]);
  let sandbox: Sandbox;
  try {
    try {
      sandbox = await make();
    } catch (error) {
      // Another function instance created it a moment ago: use that one.
      if (!lostCreateRace(error)) throw error;
      created = false;
      sandbox = await Sandbox.get({ name });
    }
    // One found by name keeps the settings it was made with: say them again,
    // so none stays persistent (a snapshot of its disk on every stop).
    if (!created)
      await sandbox.update(
        ownerSandboxUpdate() as Parameters<Sandbox["update"]>[0],
      );
  } catch (error) {
    const reason = reasonOf(error);
    console.error("[canvas] sandbox start failed", reason);
    // The image's snapshot may be gone: forget it so the next call builds a new one.
    if (
      /HTTP 404|not_found|snapshot_(?:not_found|expired|deleted)/i.test(reason)
    )
      await forgetImage(snapshotId).catch(() => {});
    throw new SandboxUnavailable(
      `Sandbox unavailable: it could not be started (${reason}). Try again in a minute.`,
    );
  }
  const left = (sandbox.expiresAt?.getTime() ?? 0) - Date.now();
  if (!created && left < EXTEND_BELOW_MINUTES * MINUTE)
    await sandbox.extendTimeout(EXTEND_BY_MINUTES * MINUTE).catch(() => {});
  held.set(name, sandbox);
  if (held.size > 200) held.delete(held.keys().next().value as string);
  return { sandbox, created };
}

/** Stops and deletes the Owner's Sandbox, if there is one. Best effort. */
export async function removeSandbox(owner: Owner) {
  const name = sandboxName(owner);
  held.delete(name);
  if (!env.sandboxConfigured()) return;
  try {
    const sandbox = await Sandbox.get({ name });
    await sandbox.stop().catch(() => {});
    await sandbox.delete(disposeOptions());
  } catch {
    // None was made, or it is already gone.
  }
}

async function command(sandbox: Sandbox, job: Job, seconds: number) {
  const text = JSON.stringify(job);
  let arg = Buffer.from(text, "utf8").toString("base64");
  if (arg.length > ARGV_CHARS) {
    const path = `${INBOX_DIR}/job-${randomUUID()}.json`;
    await sandbox.writeFiles([{ path, content: Buffer.from(text, "utf8") }]);
    arg = `@${path}`;
  }
  const result = await sandbox.runCommand({
    cmd: "python3",
    args: [RUNNER_PATH, arg],
    sudo: true,
    // The runner stops the work itself; this only catches a runner that hangs.
    timeoutMs: (seconds + 15) * 1000,
  });
  const stdout = await result.stdout();
  try {
    return JSON.parse(stdout) as JobAnswer;
  } catch {
    const stderr = await result.stderr().catch(() => "");
    console.error(
      "[canvas] runner gave no answer",
      result.exitCode,
      stderr.slice(-400),
    );
    return {
      error: "The Sandbox did not answer. Try again.",
      kind: "runner",
    } satisfies JobAnswer;
  }
}

/** Puts Uploads the Sandbox has lost (it was rebuilt, or its files expired) back from Storage. */
async function restoreUploads(owner: Owner, sandbox: Sandbox, names: string[]) {
  const sql = db();
  const rows = await sql<
    { table_name: string; storage_path: string; format: string }[]
  >`
    select table_name, storage_path, format
    from canvas.uploads
    where owner = ${owner} and status = 'ready' and table_name in ${sql(names)}`;
  for (const row of rows) {
    const file = await storage().from(BUCKET).download(row.storage_path);
    if (file.error || !file.data) continue;
    const path = `${INBOX_DIR}/${randomUUID()}.${row.format}`;
    await sandbox.writeFiles([
      { path, content: Buffer.from(await file.data.arrayBuffer()) },
    ]);
    await command(
      sandbox,
      {
        op: "import",
        table: row.table_name,
        path,
        format: row.format,
        seconds: LIMITS.runSeconds,
        maxColumns: LIMITS.uploadColumns,
      },
      LIMITS.runSeconds,
    );
  }
}

type Ran = { answer: JobAnswer; ms: number; sandboxCreated: boolean };

/**
 * Runs one job in the Owner's Sandbox and returns the runner's answer. A
 * Sandbox that fails mid-command is replaced once; a second failure is
 * "Sandbox unavailable". `seconds` is the job's own time limit.
 */
export async function runJob(
  owner: Owner,
  job: Job,
  seconds: number,
): Promise<Ran> {
  const started = Date.now();
  const python = localPython();
  if (python) {
    // Development and e2e only: the same runner on this machine (`local.ts`).
    try {
      const answer = (await runLocal(python, job, seconds)) as JobAnswer;
      return { answer, ms: Date.now() - started, sandboxCreated: false };
    } catch (error) {
      console.error(
        "[canvas] local runner failed",
        error instanceof Error ? error.message.slice(0, 300) : error,
      );
      throw new SandboxUnavailable(
        "Sandbox unavailable: the local runner failed. Try again.",
      );
    }
  }
  let sandboxCreated = false;
  for (let attempt = 0; ; attempt++) {
    const opened = await open(owner);
    sandboxCreated ||= opened.created;
    try {
      let answer = await command(opened.sandbox, job, seconds);
      if (Array.isArray(answer.missing) && answer.missing.length > 0) {
        await restoreUploads(owner, opened.sandbox, answer.missing);
        answer = await command(
          opened.sandbox,
          { ...job, uploads: [] },
          seconds,
        );
      }
      return { answer, ms: Date.now() - started, sandboxCreated };
    } catch (error) {
      const reason = reasonOf(error);
      console.error("[canvas] sandbox command failed", reason);
      held.delete(sandboxName(owner));
      if (attempt >= 1)
        throw new SandboxUnavailable(
          `Sandbox unavailable: the work could not be run (${reason}). Try again.`,
        );
      // One that has stopped or is broken is removed, snapshots and all, and made again.
      if (attempt === 0 && !/timeout|aborted/i.test(reason))
        await removeIfBroken(owner);
    }
  }
}

async function removeIfBroken(owner: Owner) {
  try {
    const sandbox = await Sandbox.get({ name: sandboxName(owner) });
    const probe = await sandbox.runCommand({
      cmd: "true",
      timeoutMs: 15_000,
    });
    if (probe.exitCode === 0) return;
  } catch {
    // Falls through to removal.
  }
  await removeSandbox(owner);
}

/** The Owner's Vercel Sandbox (or, in development, the local runner) as the services' Sandbox port. */
export const vercelSandbox: SandboxRunner = { run: runJob };
