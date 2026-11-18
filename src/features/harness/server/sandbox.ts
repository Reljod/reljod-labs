import "server-only";
import { Sandbox } from "@vercel/sandbox";
import type { Owner } from "@/features/access/domain/owner";
import type { AuditInput } from "../domain/audit";
import {
  commandSecondsFor,
  runnerScript,
  SANDBOX_LIMITS,
  SANDBOX_WORKDIR,
  type SandboxFile,
  type SandboxFileContent,
  type SandboxRunResult,
  type SandboxWriteResult,
  sessionSandboxName,
  workdirPath,
} from "../domain/sandbox";
import type { Staff } from "../domain/staff";
import type { Actor, PaidActor } from "./actor";
import { audit, auditStrict } from "./audit";
import { sql } from "./db";
import { env } from "./env";
import { InvalidError, NotFoundError, StateError } from "./errors";
import { takeRate } from "./rate";
import { readableSession, writableSession } from "./sessions";

/*
 * The Sandbox on Vercel Sandbox (ADR 0022), as Sieve does it: a microVM with
 * no network, found again by name from any function instance. A Session has
 * one (`sessionSandboxName`), made on its first write or command; a model
 * Step that codes gets its own for one call (`pipelines/code.ts`). Auth is the
 * deployment's OIDC token (`VERCEL_OIDC_TOKEN` from `vercel env pull` locally).
 */

const DEFAULT_COMMAND_MS = 30_000;
const MIN_COMMAND_MS = 1_000;
const COMMAND_AUDIT_CHARS = 200;
const OUTPUT_HEAD_CHARS = 120;
const MAX_COMMAND_CHARS = 64 * 1024;
const MAX_LISTED_FILES = 500;
const MINUTE = 60_000;

const unavailable = (reason: string) =>
  new StateError(`Sandbox unavailable: ${reason}`);

/** Throws "Sandbox unavailable" when this deployment cannot reach Vercel Sandbox. */
function requireConfigured() {
  if (!env.sandboxConfigured()) throw unavailable("it is not set up here");
}

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export type Opened = { sandbox: Sandbox; created: boolean };

/**
 * Finds the Sandbox by name or makes it, with no network either way
 * (`getOrCreate` may hand back one made with another policy). A Sandbox that
 * cannot be started is "Sandbox unavailable"; the SDK's own message is logged,
 * never shown.
 */
export async function openSandbox(
  name: string,
  options: {
    /** Keep the files when it stops (a Session's), or not (a Step's). */
    persistent: boolean;
    onCreate?: (sandbox: Sandbox) => Promise<void>;
  },
): Promise<Opened> {
  requireConfigured();
  let created = false;
  let sandbox: Sandbox;
  try {
    sandbox = await Sandbox.getOrCreate({
      name,
      networkPolicy: "deny-all",
      timeout: SANDBOX_LIMITS.sandboxMinutes * MINUTE,
      persistent: options.persistent,
      ...(options.persistent
        ? { snapshotExpiration: SANDBOX_LIMITS.keepFilesHours * 60 * MINUTE }
        : {}),
      onCreate: async (made) => {
        created = true;
        await options.onCreate?.(made);
      },
    });
    await sandbox.update({ networkPolicy: "deny-all" });
  } catch (error) {
    console.error("[harness] sandbox start failed", messageOf(error));
    throw unavailable("it could not be started; try again in a minute");
  }
  await extendIfShort(sandbox);
  return { sandbox, created };
}

/** Gives the Sandbox room for one more command, best effort. */
async function extendIfShort(sandbox: Sandbox) {
  const expires = sandbox.expiresAt?.getTime();
  if (expires === undefined) return;
  if (expires - Date.now() >= SANDBOX_LIMITS.extendBelowMinutes * MINUTE)
    return;
  try {
    await sandbox.extendTimeout(SANDBOX_LIMITS.extendByMinutes * MINUTE);
  } catch {
    // At the plan's limit: the command still has whatever time is left.
  }
}

/** Stops and deletes a Sandbox by name, if there is one. Best effort; true when one was removed. */
export async function removeSandbox(name: string): Promise<boolean> {
  if (!env.sandboxConfigured()) return false;
  try {
    const sandbox = await Sandbox.get({ name });
    try {
      await sandbox.stop();
    } catch {
      // Already stopped.
    }
    await sandbox.delete();
    return true;
  } catch {
    // None was made, or it is already gone.
    return false;
  }
}

export type Executed = Omit<SandboxRunResult, "sandboxCreated">;

const CUT_MARK = /\n… \[\d+ more bytes cut\]$/;

function capOutput(text: string): { text: string; cut: boolean } {
  const cap = SANDBOX_LIMITS.outputChars;
  if (text.length > cap) return { text: text.slice(0, cap), cut: true };
  return { text, cut: CUT_MARK.test(text) };
}

/**
 * Runs one shell command in the Sandbox's workdir under `runnerScript`
 * (`timeout`, output capped in the Sandbox). A command that outlives its
 * time comes back with `timedOut`, never as a throw; a Sandbox that fails
 * mid-command throws "Sandbox unavailable".
 */
export async function execIn(
  sandbox: Sandbox,
  command: string,
  timeoutMs: number,
): Promise<Executed> {
  const started = Date.now();
  const seconds = commandSecondsFor(timeoutMs);
  try {
    const result = await sandbox.runCommand({
      cmd: "sh",
      args: ["-c", runnerScript(seconds), "harness", command],
      cwd: SANDBOX_WORKDIR,
      // A little over the command's own limit, so `timeout` fires first.
      timeoutMs: seconds * 1000 + 5_000,
    });
    const [stdout, stderr] = await Promise.all([
      result.stdout(),
      result.stderr(),
    ]);
    const out = capOutput(stdout);
    const err = capOutput(stderr);
    return {
      exitCode: result.exitCode,
      stdout: out.text,
      stderr: err.text,
      timedOut: result.exitCode === 124,
      truncated: out.cut || err.cut,
      ms: Date.now() - started,
    };
  } catch (error) {
    const ms = Date.now() - started;
    if (ms >= seconds * 1000) {
      return {
        exitCode: 124,
        stdout: "",
        stderr: `Timed out after ${seconds} s.`,
        timedOut: true,
        truncated: false,
        ms,
      };
    }
    console.error("[harness] sandbox command failed", messageOf(error));
    throw unavailable("the command could not be run; try again");
  }
}

// A Session's Sandbox ------------------------------------------------------------------

/** Bookkeeping for the `sandboxes` row. Never fails the command. */
async function touch(
  owner: Owner,
  sessionId: string,
  status: "ready" | "stopped",
) {
  try {
    await sql()`
      insert into harness.sandboxes (session_id, owner, container, status)
      values (${sessionId}, ${owner}, ${sessionSandboxName(sessionId)}, ${status})
      on conflict (session_id) do update
        set status = excluded.status, last_used_at = now()
        where harness.sandboxes.owner = excluded.owner`;
  } catch (error) {
    console.error("[harness] sandbox bookkeeping failed", error);
  }
}

/** An Audit write that cannot fail the command it records. */
async function record(input: AuditInput & { owner: Owner }) {
  try {
    await audit(input);
  } catch (error) {
    console.error("[harness] sandbox audit failed", input.action, error);
  }
}

const viaOf = (via?: "app" | "agent") => (via ? { via } : {});

/** A failure's message when it is one of ours; a plain phrase otherwise. */
const safeMessage = (error: unknown): string =>
  error instanceof StateError || error instanceof InvalidError
    ? error.message
    : "The Sandbox failed.";

const cut = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}…` : text;

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

async function openSessionSandbox(input: {
  owner: Owner;
  sessionId: string;
  staff: Pick<Staff, "id" | "name">;
  via?: "app" | "agent";
}): Promise<Opened> {
  const opened = await openSandbox(sessionSandboxName(input.sessionId), {
    persistent: true,
  });
  await touch(input.owner, input.sessionId, "ready");
  if (opened.created) {
    await record({
      owner: input.owner,
      sessionId: input.sessionId,
      actor: { kind: "staff", staff: input.staff },
      action: "sandbox.started",
      summary: "Started a Sandbox",
      target: { kind: "session", id: input.sessionId },
      detail: viaOf(input.via),
    });
  }
  return opened;
}

/** Writes a file under the Session Sandbox's workdir (at most `SANDBOX_LIMITS.fileBytes`), starting it if needed. */
export async function sandboxWriteFile(
  input: PaidActor & {
    sessionId: string;
    path: string;
    content: string;
    via?: "app" | "agent";
  },
): Promise<SandboxWriteResult> {
  await writableSession(input, input.sessionId);
  requireConfigured();
  if (typeof input.path !== "string" || typeof input.content !== "string") {
    throw new InvalidError("Give a path and the file's text.");
  }
  const path = workdirPath(input.path);
  if (!path) {
    throw new InvalidError(
      "Give a path inside the Sandbox's work directory, like data/schedule.csv.",
    );
  }
  const bytes = Buffer.byteLength(input.content, "utf8");
  if (bytes > SANDBOX_LIMITS.fileBytes) {
    throw new InvalidError(
      `A file in the Sandbox is at most ${SANDBOX_LIMITS.fileBytes / 1024} KB.`,
    );
  }
  await takeRate(input.visitor, input.owner, "sandbox_command");
  const { sandbox, created } = await openSessionSandbox(input);
  try {
    await sandbox.writeFiles([
      { path: `${SANDBOX_WORKDIR}/${path}`, content: input.content },
    ]);
  } catch (error) {
    console.error("[harness] sandbox write failed", messageOf(error));
    throw unavailable("the file could not be written; try again");
  }
  // Always recorded: the path and size, never the content.
  await record({
    owner: input.owner,
    sessionId: input.sessionId,
    actor: { kind: "staff", staff: input.staff },
    action: "sandbox.file_written",
    summary: `Wrote ${cut(path, 120)}`,
    target: { kind: "session", id: input.sessionId },
    detail: { ...viaOf(input.via), path, bytes },
  });
  return { path, bytes, directory: false, sandboxCreated: created };
}

/**
 * Runs one shell command (under `sh -c`, in the workdir) and returns what it
 * printed. Takes one of the visitor's `LIMITS.sandboxCommandsPerHour`.
 * `timeoutMs` defaults to 30 s and is held to 1 s .. 60 s.
 */
export async function sandboxRun(
  input: PaidActor & {
    sessionId: string;
    command: string;
    timeoutMs?: number;
    via?: "app" | "agent";
  },
): Promise<SandboxRunResult> {
  await writableSession(input, input.sessionId);
  requireConfigured();
  const command = typeof input.command === "string" ? input.command : "";
  if (!command.trim()) throw new InvalidError("Give a command to run.");
  if (command.length > MAX_COMMAND_CHARS) {
    throw new InvalidError("That command is too long.");
  }
  const timeoutMs = Math.min(
    SANDBOX_LIMITS.commandSeconds * 1000,
    Math.max(
      MIN_COMMAND_MS,
      Math.trunc(Number(input.timeoutMs ?? DEFAULT_COMMAND_MS)) ||
        DEFAULT_COMMAND_MS,
    ),
  );
  await takeRate(input.visitor, input.owner, "sandbox_command");
  const actor = { kind: "staff", staff: input.staff } as const;
  const target = { kind: "session", id: input.sessionId };
  // The command stands or falls with its Audit event (ADR 0018): written
  // first, and nothing runs if it cannot be.
  try {
    await auditStrict({
      owner: input.owner,
      sessionId: input.sessionId,
      actor,
      action: "sandbox.command",
      // Written before the call: it says what was asked, not that it ran.
      summary: `Asked to run: ${cut(oneLine(command), 80)}`,
      target,
      detail: {
        ...viaOf(input.via),
        command: cut(command, COMMAND_AUDIT_CHARS),
        timeoutMs,
      },
    });
  } catch (error) {
    console.error("[harness] sandbox command audit failed", error);
    throw new StateError(
      "The command was not run: its Audit event could not be written. Try again.",
    );
  }
  let run: SandboxRunResult;
  try {
    const { sandbox, created } = await openSessionSandbox(input);
    run = {
      ...(await execIn(sandbox, command, timeoutMs)),
      sandboxCreated: created,
    };
  } catch (error) {
    // The trail already says it was asked; say it did not run (best effort).
    const message = safeMessage(error);
    await record({
      owner: input.owner,
      sessionId: input.sessionId,
      actor,
      action: "sandbox.command_finished",
      summary: `Not run: ${cut(message, 120)}`,
      target,
      detail: { ...viaOf(input.via), error: message },
    });
    throw error;
  }
  await record({
    owner: input.owner,
    sessionId: input.sessionId,
    actor,
    action: "sandbox.command_finished",
    summary: `Exit ${run.exitCode ?? "none"}: ${cut(oneLine(command), 80)}`,
    target,
    detail: {
      ...viaOf(input.via),
      exitCode: run.exitCode,
      durationMs: run.ms,
      timedOut: run.timedOut,
      truncated: run.truncated,
      outputHead: cut(oneLine(run.stdout || run.stderr), OUTPUT_HEAD_CHARS),
    },
  });
  return run;
}

/** The Session's Sandbox if it has one; never makes one just to read it. */
async function existingSessionSandbox(sessionId: string): Promise<Sandbox> {
  requireConfigured();
  try {
    return await Sandbox.get({ name: sessionSandboxName(sessionId) });
  } catch (error) {
    // Most often there is none yet; an outage reads the same, so log it.
    console.error("[harness] sandbox lookup failed", messageOf(error));
    throw new NotFoundError(
      "This Session has no Sandbox yet (or it could not be reached): write a file or run a command first.",
    );
  }
}

/** Reads a file from the Session Sandbox's workdir, cut at `SANDBOX_LIMITS.fileBytes`. */
export async function sandboxReadFile(
  input: Actor & { sessionId: string; path: string },
): Promise<SandboxFileContent> {
  if (!(await readableSession(input, input.sessionId))) {
    throw new NotFoundError("That Session is not in this Workspace.");
  }
  const path = workdirPath(String(input.path));
  if (!path) throw new InvalidError("Give a path inside the work directory.");
  const sandbox = await existingSessionSandbox(input.sessionId);
  let buffer: Buffer | null;
  try {
    buffer = await sandbox.readFileToBuffer({ path, cwd: SANDBOX_WORKDIR });
  } catch (error) {
    console.error("[harness] sandbox read failed", messageOf(error));
    throw unavailable("the file could not be read; try again");
  }
  if (!buffer) throw new NotFoundError(`No file ${path} in the Sandbox.`);
  const truncated = buffer.byteLength > SANDBOX_LIMITS.fileBytes;
  const content = buffer.subarray(0, SANDBOX_LIMITS.fileBytes).toString("utf8");
  return {
    path,
    content,
    bytes: buffer.byteLength,
    truncated,
  };
}

/** Lists the files under a directory of the Session Sandbox's workdir (the workdir itself by default). */
export async function sandboxListFiles(
  input: Actor & { sessionId: string; path?: string },
): Promise<SandboxFile[]> {
  if (!(await readableSession(input, input.sessionId))) {
    throw new NotFoundError("That Session is not in this Workspace.");
  }
  const dir = input.path?.trim() ? workdirPath(input.path) : "";
  if (dir === null)
    throw new InvalidError("Give a directory inside the work directory.");
  const sandbox = await existingSessionSandbox(input.sessionId);
  const listed = await execIn(
    sandbox,
    `find . -type f -printf '%P\\t%s\\n' 2>/dev/null | sort | head -n ${MAX_LISTED_FILES}`,
    15_000,
  );
  return listed.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [path = "", size = "0"] = line.split("\t");
      return { path, bytes: Number(size) || 0, directory: false };
    })
    .filter((file) => file.path && (!dir || file.path.startsWith(`${dir}/`)));
}
