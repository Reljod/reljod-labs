import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import type { AuditInput } from "../domain/audit";
import {
  SANDBOX_LIMITS,
  type SandboxFile,
  type SandboxFileContent,
  type SandboxRunResult,
  type SandboxStatus,
  type SandboxWriteResult,
} from "../domain/sandbox";
import { type SandboxAction, signSandboxToken } from "../domain/sandbox-token";
import type { Staff } from "../domain/staff";
import type { Actor, PaidActor } from "./actor";
import { audit } from "./audit";
import { assertCan } from "./context";
import { isUuid, sql } from "./db";
import { env } from "./env";
import { InvalidError, LimitError, NotFoundError, StateError } from "./errors";
import { takeRate } from "./rate";
import { readableSession, writableSession } from "./sessions";

/*
 * The app's client for the Sandbox Runner on the VPS (ADR 0017, contract in
 * sandbox-runner/README.md). Each call signs one token, good for about a
 * minute, for one Session and one action. The URL, the secret and the token
 * never reach an error, a log line or an Audit event.
 */

const TOKEN_SECONDS = 60;
const HEALTH_TIMEOUT_MS = 3_000;
const DEFAULT_COMMAND_MS = 30_000;
const MIN_COMMAND_MS = 100;
/** Time allowed on top of the command for the Runner's clean-up. */
const CLEANUP_MS = 10_000;
const FILE_TIMEOUT_MS = 15_000;
const COMMAND_AUDIT_CHARS = 200;
const OUTPUT_HEAD_CHARS = 120;
const MAX_COMMAND_CHARS = 64 * 1024;

type Config = { url: string; secret: string };

const config = (): Config | null => {
  const url = env.sandboxUrl();
  const secret = env.sandboxSecret();
  return url && secret ? { url: url.replace(/\/+$/, ""), secret } : null;
};

const offline = (reason: string) =>
  new StateError(`Sandbox offline: ${reason}`);

function requireConfig(): Config {
  const cfg = config();
  if (!cfg) throw offline("it is not set up here");
  return cfg;
}

/** Strips the Runner's address, the secret and anything token-shaped from text that may be shown. */
function scrub(text: string, cfg: Config): string {
  let out = text;
  for (const secret of [cfg.url, cfg.secret]) {
    if (secret) out = out.split(secret).join("[hidden]");
  }
  return out.replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, "[hidden]");
}

type Called<T> = { status: number; body: T };

/** One request to the Runner. Network failures and timeouts become "Sandbox offline"; other statuses are mapped by `unwrap`. */
async function call(
  cfg: Config,
  input: {
    sessionId: string;
    act: SandboxAction;
    method: "GET" | "POST" | "DELETE";
    path: string;
    query?: Record<string, string>;
    body?: unknown;
    timeoutMs: number;
  },
): Promise<Called<unknown>> {
  const token = signSandboxToken(cfg.secret, {
    sid: input.sessionId,
    act: input.act,
    exp: Math.floor(Date.now() / 1000) + TOKEN_SECONDS,
  });
  const qs = input.query ? `?${new URLSearchParams(input.query)}` : "";
  let response: Response;
  try {
    response = await fetch(`${cfg.url}${input.path}${qs}`, {
      method: input.method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(input.body === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(input.timeoutMs),
    });
  } catch {
    throw offline("the Runner did not answer");
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // handled below: a non-JSON body from a failing status is "offline"
  }
  return { status: response.status, body };
}

type RunnerError = { code: string; message: string };

const errorOf = (body: unknown): RunnerError => {
  const error = (body as { error?: { code?: unknown; message?: unknown } })
    ?.error;
  return {
    code: typeof error?.code === "string" ? error.code : "",
    message: typeof error?.message === "string" ? error.message : "",
  };
};

/** The body of a 200, or the readable error a failure maps to. */
function unwrap<T>(cfg: Config, result: Called<unknown>): T {
  if (result.status === 200 && result.body && typeof result.body === "object") {
    return result.body as T;
  }
  const { code, message } = errorOf(result.body);
  const safe = scrub(message, cfg);
  if (result.status === 503 && code === "at_capacity") {
    throw new StateError("The Sandbox is full, try again in a minute");
  }
  if (result.status === 429) {
    throw new LimitError(safe || "The Sandbox is busy, try again shortly.");
  }
  if (result.status === 404 && code === "file_not_found") {
    throw new NotFoundError(safe || "No such file in the Sandbox.");
  }
  if (result.status === 401 || result.status === 403) {
    throw offline("the Runner did not accept this app");
  }
  if (result.status === 507) {
    throw new InvalidError(safe || "The Sandbox has no room left.");
  }
  if (result.status >= 400 && result.status < 500 && safe) {
    throw new InvalidError(safe);
  }
  throw offline("the Runner failed");
}

/** Bookkeeping for the `sandboxes` row. Never fails the command. */
async function touch(
  owner: Owner,
  sessionId: string,
  status: "ready" | "stopped",
) {
  try {
    await sql()`
      insert into harness.sandboxes (session_id, owner, container, status)
      values (${sessionId}, ${owner}, ${`sandbox-${sessionId.slice(0, 8)}`}, ${status})
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

const cut = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}…` : text;

/** Whether the Sandbox can be used, and the Session's container if one is live. Never throws for an offline Runner. */
export async function sandboxStatus(input?: {
  owner: Owner;
  sessionId?: string | null;
}): Promise<SandboxStatus> {
  const cfg = config();
  if (!cfg) {
    return {
      configured: false,
      online: false,
      container: null,
      message: "Sandbox offline: it is not set up here",
    };
  }
  let online = false;
  try {
    const response = await fetch(`${cfg.url}/health`, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    const body = (await response.json()) as { ok?: unknown };
    online = response.ok && body?.ok === true;
  } catch {
    online = false;
  }
  let container: SandboxStatus["container"] = null;
  if (input?.owner && isUuid(input.sessionId)) {
    try {
      const [row] = await sql()<
        { status: "starting" | "ready" | "stopped"; last_used_at: Date }[]
      >`
        select status, last_used_at from harness.sandboxes
        where session_id = ${input.sessionId} and owner = ${input.owner}`;
      if (row) {
        container = {
          status: row.status,
          lastUsedAt: row.last_used_at.toISOString(),
        };
      }
    } catch (error) {
      console.error("[harness] sandbox status lookup failed", error);
    }
  }
  return {
    configured: true,
    online,
    container: online ? container : null,
    message: online ? null : "Sandbox offline: the Runner did not answer",
  };
}

/** Writes a file under the Sandbox's workdir (at most `SANDBOX_LIMITS.fileBytes`), starting the container if needed. */
export async function sandboxWriteFile(
  input: PaidActor & {
    sessionId: string;
    path: string;
    content: string;
    via?: "app" | "agent";
  },
): Promise<SandboxWriteResult> {
  assertCan(input.staff, "sandbox.use");
  await writableSession(input, input.sessionId);
  const cfg = requireConfig();
  if (typeof input.path !== "string" || typeof input.content !== "string") {
    throw new InvalidError("Give a path and the file's text.");
  }
  if (Buffer.byteLength(input.content, "utf8") > SANDBOX_LIMITS.fileBytes) {
    throw new InvalidError(
      `A file in the Sandbox is at most ${SANDBOX_LIMITS.fileBytes / 1024} KB.`,
    );
  }
  await takeRate(input.visitor, input.owner, "sandbox_command");
  const result = await call(cfg, {
    sessionId: input.sessionId,
    act: "write",
    method: "POST",
    path: `/sessions/${input.sessionId}/files`,
    body: { path: input.path, content: input.content },
    timeoutMs: FILE_TIMEOUT_MS,
  });
  const body = unwrap<{
    path: string;
    bytes: number;
    sandboxCreated?: boolean;
  }>(cfg, result);
  const sandboxCreated = body.sandboxCreated === true;
  await touch(input.owner, input.sessionId, "ready");
  if (sandboxCreated) {
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
  return {
    path: String(body.path),
    bytes: Number(body.bytes),
    directory: false,
    sandboxCreated,
  };
}

/**
 * Runs one command (under `sh -lc` in the container) and returns what it
 * printed. Takes one of the visitor's `LIMITS.sandboxCommandsPerHour`.
 * `timeoutMs` defaults to 30 s and is held to 100 ms .. 60 s.
 */
export async function sandboxRun(
  input: PaidActor & {
    sessionId: string;
    command: string;
    timeoutMs?: number;
    via?: "app" | "agent";
  },
): Promise<SandboxRunResult> {
  assertCan(input.staff, "sandbox.use");
  await writableSession(input, input.sessionId);
  const cfg = requireConfig();
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
  const result = await call(cfg, {
    sessionId: input.sessionId,
    act: "run",
    method: "POST",
    path: `/sessions/${input.sessionId}/run`,
    body: { command, timeoutMs },
    timeoutMs: timeoutMs + CLEANUP_MS,
  });
  const body = unwrap<{
    exitCode?: number | null;
    stdout?: string;
    stderr?: string;
    truncated?: boolean;
    timedOut?: boolean;
    durationMs?: number;
    sandboxCreated?: boolean;
    sandboxReset?: boolean;
  }>(cfg, result);
  const stdout = String(body.stdout ?? "");
  const stderr = String(body.stderr ?? "");
  const outputCap = SANDBOX_LIMITS.outputChars;
  const cappedOut = stdout.length > outputCap;
  const cappedErr = stderr.length > outputCap;
  const run: SandboxRunResult = {
    exitCode: typeof body.exitCode === "number" ? body.exitCode : null,
    stdout: cappedOut ? stdout.slice(0, outputCap) : stdout,
    stderr: cappedErr ? stderr.slice(0, outputCap) : stderr,
    timedOut: body.timedOut === true,
    truncated: body.truncated === true || cappedOut || cappedErr,
    ms: Number(body.durationMs) || 0,
    sandboxCreated: body.sandboxCreated === true,
    sandboxReset: body.sandboxReset === true,
  };
  await touch(
    input.owner,
    input.sessionId,
    run.sandboxReset ? "stopped" : "ready",
  );
  const actor = { kind: "staff", staff: input.staff } as const;
  const target = { kind: "session", id: input.sessionId };
  if (run.sandboxCreated) {
    await record({
      owner: input.owner,
      sessionId: input.sessionId,
      actor,
      action: "sandbox.started",
      summary: "Started a Sandbox",
      target,
      detail: viaOf(input.via),
    });
  }
  await record({
    owner: input.owner,
    sessionId: input.sessionId,
    actor,
    action: "sandbox.command",
    summary: `Ran: ${cut(command.replace(/\s+/g, " ").trim(), 80)}`,
    target,
    detail: {
      ...viaOf(input.via),
      command: cut(command, COMMAND_AUDIT_CHARS),
      exitCode: run.exitCode,
      durationMs: run.ms,
      timedOut: run.timedOut,
      truncated: run.truncated,
      sandboxReset: run.sandboxReset,
      outputHead: cut(
        (run.stdout || run.stderr).replace(/\s+/g, " ").trim(),
        OUTPUT_HEAD_CHARS,
      ),
    },
  });
  return run;
}

/** Reads a file from the Sandbox's workdir, cut at `SANDBOX_LIMITS.fileBytes`. */
export async function sandboxReadFile(
  input: Actor & { sessionId: string; path: string },
): Promise<SandboxFileContent> {
  if (!(await readableSession(input, input.sessionId))) {
    throw new NotFoundError("That Session is not in this Workspace.");
  }
  const cfg = requireConfig();
  const result = await call(cfg, {
    sessionId: input.sessionId,
    act: "read",
    method: "GET",
    path: `/sessions/${input.sessionId}/files`,
    query: { path: String(input.path) },
    timeoutMs: FILE_TIMEOUT_MS,
  });
  const body = unwrap<{ path: string; content: string; truncated?: boolean }>(
    cfg,
    result,
  );
  const content = String(body.content ?? "");
  return {
    path: String(body.path),
    content,
    bytes: Buffer.byteLength(content, "utf8"),
    truncated: body.truncated === true,
  };
}

/** Lists the files under a directory of the Sandbox's workdir (the workdir itself by default). */
export async function sandboxListFiles(
  input: Actor & { sessionId: string; path?: string },
): Promise<SandboxFile[]> {
  if (!(await readableSession(input, input.sessionId))) {
    throw new NotFoundError("That Session is not in this Workspace.");
  }
  const cfg = requireConfig();
  const result = await call(cfg, {
    sessionId: input.sessionId,
    act: "list",
    method: "GET",
    path: `/sessions/${input.sessionId}/files`,
    timeoutMs: FILE_TIMEOUT_MS,
  });
  const body = unwrap<{ files?: { path: string; size: number }[] }>(
    cfg,
    result,
  );
  const dir = (input.path ?? "")
    .replace(/^(\.\/)+/, "")
    .replace(/^\.$/, "")
    .replace(/\/+$/, "");
  return (body.files ?? [])
    .filter((file) => !dir || file.path.startsWith(`${dir}/`))
    .map((file) => ({
      path: String(file.path),
      bytes: Number(file.size) || 0,
      directory: false,
    }));
}

/**
 * Removes the Session's container. Best effort against the Runner; always
 * marks the local row stopped. Writes `sandbox.destroyed`. Pass `staff` to
 * record who did it (the system otherwise) and `via` when the Agent did.
 */
export async function sandboxDestroy(input: {
  owner: Owner;
  sessionId: string;
  staff?: Pick<Staff, "id" | "name">;
  via?: "app" | "agent";
}): Promise<void> {
  if (!isUuid(input.sessionId)) return;
  let destroyed = false;
  const cfg = config();
  if (cfg) {
    try {
      const result = await call(cfg, {
        sessionId: input.sessionId,
        act: "destroy",
        method: "DELETE",
        path: `/sessions/${input.sessionId}`,
        timeoutMs: FILE_TIMEOUT_MS,
      });
      destroyed =
        result.status === 200 &&
        (result.body as { destroyed?: unknown } | null)?.destroyed === true;
    } catch {
      // Best effort: the Runner reaps idle Sandboxes itself.
    }
  }
  try {
    await sql()`
      update harness.sandboxes set status = 'stopped', last_used_at = now()
      where session_id = ${input.sessionId} and owner = ${input.owner}`;
  } catch (error) {
    console.error("[harness] sandbox bookkeeping failed", error);
  }
  await record({
    owner: input.owner,
    sessionId: input.sessionId,
    actor: input.staff
      ? { kind: "staff", staff: input.staff }
      : { kind: "system" },
    action: "sandbox.destroyed",
    summary: "Removed the Sandbox",
    target: { kind: "session", id: input.sessionId },
    detail: { ...viaOf(input.via), runnerHadOne: destroyed },
  });
}
