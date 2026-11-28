import "server-only";
import { Sandbox } from "@vercel/sandbox";
import type { Owner } from "@/features/access/domain/owner";
import { NotFoundError } from "@/platform/errors";
import {
  commandSecondsFor,
  runnerScript,
  SANDBOX_LIMITS,
  SANDBOX_WORKDIR,
  type SandboxFile,
  type SandboxRunResult,
  sessionSandboxName,
} from "../domain/sandbox";
import { sql } from "./db";
import { env } from "./env";
import { sandboxUnavailable } from "./errors";
import type { SessionSandboxes } from "./ports";

/*
 * The Sandbox on Vercel Sandbox (ADR 0022), as Sieve does it: a microVM with
 * no network, found again by name from any function instance. A Session has
 * one (`sessionSandboxName`), made on its first write or command; a model
 * Step that codes gets its own for one call (`pipelines/code.ts`). Auth is the
 * deployment's OIDC token (`VERCEL_OIDC_TOKEN` from `vercel env pull` locally).
 * The checks, the cap and the Audit trail are the Sandbox service's.
 */

const MAX_LISTED_FILES = 500;
const MINUTE = 60_000;

const unavailable = sandboxUnavailable;

/** Throws "Sandbox unavailable" when this deployment cannot reach Vercel Sandbox. */
function requireConfigured() {
  if (!env.sandboxConfigured()) throw unavailable("it is not set up here");
}

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const REASON_CHARS = 160;

/**
 * Why the SDK failed, safe to show: the HTTP status and Vercel's error code
 * and message, or a stream error's code. Anything token-shaped is cut, so a
 * credential can never ride along. Unknown errors give only their name.
 */
export function sdkReason(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";
  const e = error as Error & {
    response?: { status?: number };
    json?: { error?: { code?: unknown; message?: unknown } };
    code?: unknown;
  };
  const parts: string[] = [];
  if (typeof e.response?.status === "number")
    parts.push(`HTTP ${e.response.status}`);
  const code = e.json?.error?.code ?? e.code;
  if (typeof code === "string" && code) parts.push(code);
  const text =
    typeof e.json?.error?.message === "string"
      ? e.json.error.message
      : parts.length > 0 || e.name === "StreamError"
        ? e.message
        : "";
  const head = parts.length > 0 ? parts.join(" ") : e.name || "Error";
  const said = text
    .replace(/Bearer\s+\S+/gi, "[hidden]")
    .replace(/[A-Za-z0-9_\-.]{32,}/g, "[hidden]")
    .replace(/\s+/g, " ")
    .trim();
  const reason = said ? `${head}: ${said}` : head;
  return reason.length > REASON_CHARS
    ? `${reason.slice(0, REASON_CHARS)}…`
    : reason;
}

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
    throw unavailable(
      `it could not be started (${sdkReason(error)}); try again in a minute`,
    );
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
      // No cwd: the Sandbox's default is already SANDBOX_WORKDIR, as Sieve relies on.
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
    throw unavailable(
      `the command could not be run (${sdkReason(error)}); try again`,
    );
  }
}

// A Session's Sandbox ------------------------------------------------------------------

/** Bookkeeping for the `sandboxes` row. Never fails the command. */
async function touch(owner: Owner, sessionId: string) {
  try {
    await sql()`
      insert into harness.sandboxes (session_id, owner, container, status)
      values (${sessionId}, ${owner}, ${sessionSandboxName(sessionId)}, 'ready')
      on conflict (session_id) do update
        set status = excluded.status, last_used_at = now()
        where harness.sandboxes.owner = excluded.owner`;
  } catch (error) {
    console.error("[harness] sandbox bookkeeping failed", error);
  }
}

async function openSessionSandbox(
  owner: Owner,
  sessionId: string,
): Promise<Opened> {
  const opened = await openSandbox(sessionSandboxName(sessionId), {
    persistent: true,
  });
  await touch(owner, sessionId);
  return opened;
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

/** A Session's Sandbox on Vercel Sandbox, made on its first write or command. */
export const vercelSandboxes: SessionSandboxes = {
  get configured() {
    return env.sandboxConfigured();
  },

  async write(sessionId, owner, path, content) {
    const { sandbox, created } = await openSessionSandbox(owner, sessionId);
    try {
      await sandbox.writeFiles([
        { path: `${SANDBOX_WORKDIR}/${path}`, content },
      ]);
    } catch (error) {
      console.error("[harness] sandbox write failed", messageOf(error));
      throw unavailable(
        `the file could not be written (${sdkReason(error)}); try again`,
      );
    }
    return { created };
  },

  async run(sessionId, owner, command, timeoutMs): Promise<SandboxRunResult> {
    const { sandbox, created } = await openSessionSandbox(owner, sessionId);
    return {
      ...(await execIn(sandbox, command, timeoutMs)),
      sandboxCreated: created,
    };
  },

  async read(sessionId, path) {
    const sandbox = await existingSessionSandbox(sessionId);
    let buffer: Buffer | null;
    try {
      buffer = await sandbox.readFileToBuffer({ path, cwd: SANDBOX_WORKDIR });
    } catch (error) {
      console.error("[harness] sandbox read failed", messageOf(error));
      throw unavailable(
        `the file could not be read (${sdkReason(error)}); try again`,
      );
    }
    if (!buffer) throw new NotFoundError(`No file ${path} in the Sandbox.`);
    return {
      path,
      content: buffer.subarray(0, SANDBOX_LIMITS.fileBytes).toString("utf8"),
      bytes: buffer.byteLength,
      truncated: buffer.byteLength > SANDBOX_LIMITS.fileBytes,
    };
  },

  async list(sessionId, dir): Promise<SandboxFile[]> {
    const sandbox = await existingSessionSandbox(sessionId);
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
  },
};

/** The e2e suite's Sandbox: files kept in memory, commands answered with a canned line. Never reaches Vercel. */
export function stubSandboxes(): SessionSandboxes {
  const files = new Map<string, Map<string, string>>();
  const of = (sessionId: string) => {
    let session = files.get(sessionId);
    if (!session) {
      session = new Map();
      files.set(sessionId, session);
    }
    return session;
  };
  return {
    configured: true,
    async write(sessionId, _owner, path, content) {
      const created = !files.has(sessionId);
      of(sessionId).set(path, content);
      return { created };
    },
    async run(sessionId, _owner, command) {
      const created = !files.has(sessionId);
      of(sessionId);
      return {
        exitCode: 0,
        stdout: `(stub Sandbox) ran: ${command.slice(0, 200)}\n`,
        stderr: "",
        timedOut: false,
        truncated: false,
        ms: 0,
        sandboxCreated: created,
      };
    },
    async read(sessionId, path) {
      const content = files.get(sessionId)?.get(path);
      if (content === undefined)
        throw new NotFoundError(`No file ${path} in the Sandbox.`);
      const bytes = Buffer.byteLength(content, "utf8");
      return { path, content, bytes, truncated: false };
    },
    async list(sessionId, dir) {
      return [...(files.get(sessionId)?.entries() ?? [])]
        .filter(([path]) => !dir || path.startsWith(`${dir}/`))
        .map(([path, content]) => ({
          path,
          bytes: Buffer.byteLength(content, "utf8"),
          directory: false,
        }));
    },
  };
}
