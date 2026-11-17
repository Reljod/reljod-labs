#!/usr/bin/env node
// The Runner: starts and drives Sandboxes (one Docker container per Session)
// for the Harness. See README.md. Node built-ins only, no build step.
//
// Every request body is hostile and the code in a container is malicious:
// - Docker is driven through the `docker` CLI with argument arrays, never a shell.
// - Request input reaches a command line only as one whole argument, after validation.
// - The scripts run inside a container are constants; paths go in as "$1".

import { execFile, spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verify } from "./token.mjs";
import {
  CONTAINER_NAME,
  containerName,
  isSessionId,
  LIMITS,
  normalizeCommand,
  normalizePath,
  normalizeTimeout,
} from "./validate.mjs";

// ---------------------------------------------------------------- config

const env = process.env;

function numberFromEnv(name, fallback, min, max) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    console.error(`${name} must be a number from ${min} to ${max}`);
    process.exit(78);
  }
  return value;
}

const SECRET = env.RUNNER_SECRET ?? "";
if (SECRET.length < 32) {
  console.error("RUNNER_SECRET must be set and at least 32 characters long");
  process.exit(78);
}
// Nothing started from here on inherits the secret.
delete process.env.RUNNER_SECRET;

const HOST = "127.0.0.1";
const PORT = numberFromEnv("RUNNER_PORT", 8787, 0, 65535);
const MAX_SANDBOXES = Math.floor(
  numberFromEnv("RUNNER_MAX_SANDBOXES", 6, 1, 64),
);
const IDLE_MS = numberFromEnv("RUNNER_IDLE_MINUTES", 15, 0.01, 120) * 60_000;
const REAP_MS = numberFromEnv("RUNNER_REAP_SECONDS", 30, 1, 600) * 1000;
const MAX_AGE_MS = 2 * 60 * 60_000;
const IMAGE = env.RUNNER_IMAGE || "harness-sandbox:1";
const DOCKER_BIN = env.RUNNER_DOCKER_BIN || "docker";
const INSTANCE = env.RUNNER_INSTANCE || "main";
if (
  !/^[a-z0-9][a-z0-9-]{0,39}$/.test(INSTANCE) ||
  !/^[a-z0-9][a-z0-9._/:-]{0,127}$/.test(IMAGE)
) {
  console.error("RUNNER_INSTANCE or RUNNER_IMAGE has an unexpected shape");
  process.exit(78);
}

const MAX_PER_OWNER = Math.floor(
  numberFromEnv("RUNNER_MAX_PER_OWNER", 2, 1, 64),
);

// The container runtime. A sandboxed one (gVisor's `runsc`, or a Kata
// Containers VM runtime) puts its own kernel between the code and the host's.
// Anything else (runc, crun, youki, ...) shares the host kernel, so a kernel
// bug is a way out: the Runner refuses it unless the owner says, in
// RUNNER_ALLOW_RUNC=1, that they accept that on this machine. An allowlist,
// not a denylist: a runtime the Runner does not know is treated as unsandboxed.
const RUNTIME = env.RUNNER_RUNTIME || null;
if (RUNTIME !== null && !/^[a-z0-9_-]+$/.test(RUNTIME)) {
  console.error("RUNNER_RUNTIME must match ^[a-z0-9_-]+$ (e.g. runsc)");
  process.exit(78);
}
const SANDBOXED_RUNTIME =
  RUNTIME !== null && (RUNTIME === "runsc" || RUNTIME.startsWith("kata"));
if (!SANDBOXED_RUNTIME && env.RUNNER_ALLOW_RUNC !== "1") {
  console.error(
    [
      "Refusing to start: no sandboxed container runtime is configured.",
      `RUNNER_RUNTIME is ${RUNTIME === null ? "unset (Docker's default, runc)" : RUNTIME}, which is not a sandboxed runtime (runsc, or kata*) and shares this host's kernel:`,
      "a kernel bug reachable from a container would let visitor code out onto this machine.",
      "Either install gVisor and set RUNNER_RUNTIME=runsc (recommended, see README.md),",
      "or set RUNNER_ALLOW_RUNC=1 to accept that risk explicitly.",
    ].join("\n"),
  );
  process.exit(78);
}

// A parent cgroup (a systemd slice) that caps all Sandboxes together.
const CGROUP_PARENT = env.RUNNER_CGROUP_PARENT || null;
if (
  CGROUP_PARENT !== null &&
  !/^[A-Za-z0-9_.:@/-]{1,128}$/.test(CGROUP_PARENT)
) {
  console.error("RUNNER_CGROUP_PARENT has an unexpected shape");
  process.exit(78);
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SANDBOX_USER = "sandbox";
const SANDBOX_UID = 10001; // the uid of `sandbox` in the Dockerfile
const WORKDIR = "/work";
const LABEL = "harness.sandbox=1";
const INSTANCE_LABEL = `harness.runner=${INSTANCE}`;
const OWNER_LABEL = "harness.owner";

// The docker CLI gets a small fixed environment, never the Runner's own.
const DOCKER_ENV = {
  PATH: env.PATH || "/usr/local/bin:/usr/bin:/bin",
  HOME: env.HOME || "/",
};
for (const name of ["DOCKER_HOST", "DOCKER_CONFIG"])
  if (env[name]) DOCKER_ENV[name] = env[name];

const WINDOW_MS = 10 * 60_000;
const SESSION_RATES = {
  run: 30,
  write: 120,
  read: 240,
  list: 240,
  destroy: 30,
}; // per 10 minutes
const GLOBAL_RATE = { limit: 600, windowMs: 60_000 }; // signed requests, all sessions
const MAX_QUEUED = 4; // requests waiting or running per Session
const DISCARD_LIMIT = 16 * 1024 * 1024; // output thrown away before a run is stopped early
const TIMEOUT_EXIT_CODE = 124;
// Added to stderr when a command exits 126 ("cannot execute"), the usual
// sign of running a file in /work or /tmp directly.
const NOEXEC_HINT =
  "\n[sandbox] Exit 126: the file could not be executed. /work and /tmp are mounted noexec, so a file written there cannot be run directly; run it through its interpreter instead, e.g. `python3 main.py`, `node main.js` or `sh run.sh`.\n";

// ---------------------------------------------------------------- errors, logging

class HttpError extends Error {
  constructor(status, code, message, headers = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

function log(fields) {
  process.stdout.write(
    `${JSON.stringify({ t: new Date().toISOString(), ...fields })}\n`,
  );
}

/** A short single line for the log. Never sent to a client. */
function brief(text) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

// ---------------------------------------------------------------- docker

/** A docker command that neither streams nor takes input. Never rejects. */
function docker(args, { timeoutMs = 20_000, maxBuffer = 1024 * 1024 } = {}) {
  return new Promise((resolve) => {
    execFile(
      DOCKER_BIN,
      args,
      {
        env: DOCKER_ENV,
        timeout: timeoutMs,
        killSignal: "SIGKILL",
        maxBuffer,
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        const code = error
          ? typeof error.code === "number"
            ? error.code
            : -1
          : 0;
        resolve({ code, stdout: stdout ?? "", stderr: stderr ?? "" });
      },
    );
  });
}

function collector(cap) {
  const chunks = [];
  let kept = 0;
  let dropped = 0;
  return {
    push(chunk) {
      const room = cap - kept;
      if (room >= chunk.length) {
        chunks.push(chunk);
        kept += chunk.length;
        return;
      }
      if (room > 0) {
        chunks.push(chunk.subarray(0, room));
        kept = cap;
      }
      dropped += chunk.length - Math.max(room, 0);
    },
    buffer: () => Buffer.concat(chunks),
    dropped: () => dropped,
  };
}

/**
 * `docker exec` as the sandbox user in the workdir, with capped output and a
 * deadline. spawn (no shell) rather than execFile because it streams.
 * At the deadline, or when far too much output was thrown away, `stop` is
 * called to end the process inside the container (it resolves to true when
 * the container was swept); the docker client is killed a few seconds later
 * if it has still not returned. Never rejects.
 */
function execIn(
  name,
  argv,
  { input = null, cap = LIMITS.outputBytes, timeoutMs = 15_000, stop } = {},
) {
  return new Promise((resolve) => {
    const args = ["exec"];
    if (input !== null) args.push("--interactive");
    args.push("--user", SANDBOX_USER, "--workdir", WORKDIR, name, ...argv);
    const started = Date.now();
    const out = collector(cap);
    const err = collector(cap);
    let timedOut = false;
    let stopping = null; // the promise of `stop`, once asked for
    let settled = false;
    let hardKill = null;

    const child = spawn(DOCKER_BIN, args, {
      env: DOCKER_ENV,
      shell: false,
      stdio: [input !== null ? "pipe" : "ignore", "pipe", "pipe"],
    });

    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      clearTimeout(hardKill);
      const durationMs = Date.now() - started;
      // Wait for `stop` to return, so it cannot land on the Session's next command.
      Promise.resolve(stopping).then((swept) => {
        resolve({
          code,
          stdout: out.buffer(),
          stderr: err.buffer(),
          truncated: out.dropped() + err.dropped() > 0,
          timedOut,
          swept: swept === true,
          durationMs,
        });
      });
    };

    const stopNow = () => {
      if (stopping || settled) return;
      hardKill = setTimeout(() => child.kill("SIGKILL"), 4000);
      stopping = stop ? stop().catch(() => false) : Promise.resolve(false);
      if (!stop) child.kill("SIGKILL");
    };

    const deadline = setTimeout(() => {
      timedOut = true;
      stopNow();
    }, timeoutMs);

    const watch = (sink) => (chunk) => {
      sink.push(chunk);
      if (out.dropped() + err.dropped() > DISCARD_LIMIT) stopNow();
    };
    child.stdout.on("data", watch(out));
    child.stderr.on("data", watch(err));
    child.on("error", () => finish(-1));
    child.on("close", (code) => finish(code ?? -1));
    if (input !== null) {
      child.stdin.on("error", () => {});
      child.stdin.end(input);
    }
  });
}

let dockerSeen = { at: 0, ok: false };
async function dockerAvailable() {
  if (Date.now() - dockerSeen.at > 10_000) {
    dockerSeen = { at: Date.now(), ok: dockerSeen.ok };
    const result = await docker(
      ["version", "--format", "{{.Server.Version}}"],
      { timeoutMs: 5000 },
    );
    dockerSeen = { at: Date.now(), ok: result.code === 0 };
  }
  return dockerSeen.ok;
}

let imageReady = null;
/** Build the Sandbox image once if it is absent. */
function ensureImage() {
  imageReady ??= (async () => {
    const found = await docker([
      "image",
      "inspect",
      "--format",
      "{{.Id}}",
      IMAGE,
    ]);
    if (found.code === 0) return;
    log({ event: "image_build", image: IMAGE });
    const built = await docker(["build", "--quiet", "--tag", IMAGE, HERE], {
      timeoutMs: 10 * 60_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (built.code !== 0) {
      log({ event: "image_build_failed", err: brief(built.stderr) });
      throw new HttpError(
        503,
        "sandbox_unavailable",
        "The Sandbox image is not available.",
      );
    }
  })().catch((error) => {
    imageReady = null;
    throw error;
  });
  return imageReady;
}

// ---------------------------------------------------------------- sandboxes

/** sid -> { sid, name, own, createdAt, lastUsed, keepPid } ; keepPid is null while it starts; own is the Owner tag */
const sandboxes = new Map();

function runArgs(sb) {
  return [
    "run",
    "--detach",
    ...(RUNTIME ? ["--runtime", RUNTIME] : []),
    ...(CGROUP_PARENT ? ["--cgroup-parent", CGROUP_PARENT] : []),
    "--name",
    sb.name,
    "--hostname",
    "sandbox",
    "--label",
    LABEL,
    "--label",
    `harness.created=${Math.floor(sb.createdAt / 1000)}`,
    "--label",
    INSTANCE_LABEL,
    "--label",
    `${OWNER_LABEL}=${sb.own}`,
    "--network",
    "none",
    "--ipc",
    "none", // no /dev/shm: the only writable places are the two tmpfs below
    "--read-only",
    "--tmpfs",
    // noexec: nothing written here runs directly; interpreters still read scripts.
    `${WORKDIR}:rw,noexec,nosuid,nodev,size=64m,nr_inodes=4096,mode=0700,uid=${SANDBOX_UID},gid=${SANDBOX_UID}`,
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,nodev,size=16m,nr_inodes=1024",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--pids-limit",
    "128",
    "--memory",
    "512m",
    "--memory-swap",
    "512m",
    "--cpus",
    "1",
    "--user",
    SANDBOX_USER,
    "--workdir",
    WORKDIR,
    "--ulimit",
    "nofile=256:256",
    "--ulimit",
    `fsize=${64 * 1024 * 1024}`,
    "--ulimit",
    "core=0",
    "--ulimit",
    "msgqueue=0", // /dev/mqueue is mounted even with --ipc none; this makes it unusable
    "--log-driver",
    "none",
    "--stop-timeout",
    "2",
    "--init",
    "--rm",
    IMAGE,
    "sleep",
    "infinity",
  ];
}

// Prints the pid of every process but pid 1 and this shell. Run before any
// untrusted code, it prints exactly one pid: the `sleep infinity` that keeps
// the container alive.
const FIND_KEEPALIVE =
  // biome-ignore lint/suspicious/noTemplateCurlyInString: shell parameter expansion, not a JS template
  'for d in /proc/[0-9]*; do p="${d#/proc/}"; [ "$p" = 1 ] || [ "$p" = "$$" ] || echo "$p"; done';

// Ends every process in the container except pid 1 and the keepalive ($1).
// `kill -s STOP -- -1` freezes them all in one system call (a frozen process
// cannot fork), then each is killed. Builtins only, so it needs no free pid
// beyond its own.
const KILL_ALL = [
  'keep="$1"',
  "kill -s STOP -- -1 2>/dev/null",
  "for d in /proc/[0-9]*; do",
  // biome-ignore lint/suspicious/noTemplateCurlyInString: shell parameter expansion, not a JS template
  '  p="${d#/proc/}"',
  '  case "$p" in 1|"$$"|"$keep") continue ;; esac',
  '  kill -s KILL "$p" 2>/dev/null',
  "done",
  'kill -s CONT "$keep" 2>/dev/null',
  "exit 0",
].join("\n");

const WRITE_FILE = [
  'p="$1"',
  'if [ -e "$p" ] || [ -L "$p" ]; then',
  '  { [ -f "$p" ] && [ ! -L "$p" ]; } || exit 74',
  "else",
  '  n="$(find . -type f | wc -l)"',
  `  [ "$n" -lt ${LIMITS.maxFiles} ] || exit 73`,
  "fi",
  'mkdir -p -- "$(dirname -- "$p")" 2>/dev/null || exit 75',
  'cat > "$p" || { rm -f -- "$p"; exit 76; }',
].join("\n");

const READ_FILE = `p="$1"; { [ -f "$p" ] && [ ! -L "$p" ]; } || exit 44; head -c ${LIMITS.fileBytes + 1} -- "$p"`;

const LIST_FILES = "find . -type f -exec stat -c '%s %n' {} +";

async function removeContainer(name) {
  if (!CONTAINER_NAME.test(name)) return;
  await docker(["rm", "--force", name], { timeoutMs: 30_000 });
}

async function isRunning(name) {
  const result = await docker([
    "inspect",
    "--format",
    "{{.State.Running}}",
    name,
  ]);
  return result.code === 0 && result.stdout.trim() === "true";
}

/** Drop Sandboxes whose container is gone (killed from inside, or by hand). */
async function forgetDead() {
  const listed = await docker([
    "ps",
    "--filter",
    `label=${LABEL}`,
    "--filter",
    `label=${INSTANCE_LABEL}`,
    "--format",
    "{{.Names}}",
  ]);
  if (listed.code !== 0) return;
  const running = new Set(listed.stdout.split("\n").filter(Boolean));
  for (const sb of sandboxes.values()) {
    if (sb.keepPid !== null && !running.has(sb.name)) sandboxes.delete(sb.sid);
  }
}

async function startSandbox(sb) {
  await ensureImage();
  let started = await docker(runArgs(sb), { timeoutMs: 60_000 });
  if (started.code !== 0 && /already in use|Conflict/i.test(started.stderr)) {
    await removeContainer(sb.name);
    started = await docker(runArgs(sb), { timeoutMs: 60_000 });
  }
  if (started.code !== 0) {
    log({
      event: "sandbox_start_failed",
      sid: sb.sid,
      err: brief(started.stderr),
    });
    throw new HttpError(
      503,
      "sandbox_unavailable",
      "The Sandbox could not be started.",
    );
  }
  const found = await execIn(sb.name, ["sh", "-c", FIND_KEEPALIVE], {
    timeoutMs: 10_000,
  });
  const pid = found.stdout.toString("utf8").trim();
  if (found.code !== 0 || !/^[0-9]{1,7}$/.test(pid)) {
    log({
      event: "sandbox_start_failed",
      sid: sb.sid,
      err: brief(found.stderr) || "no keepalive",
    });
    throw new HttpError(
      503,
      "sandbox_unavailable",
      "The Sandbox could not be started.",
    );
  }
  sb.keepPid = pid;
}

/**
 * The live Sandbox of a Session. With `create`, starts one if there is none.
 * Only ever called from the Session's queue.
 * @returns {Promise<{ sb: object | null, created: boolean }>}
 */
async function ensureSandbox(sid, create, own = null) {
  let sb = sandboxes.get(sid);
  if (sb) {
    if (await isRunning(sb.name)) {
      sb.lastUsed = Date.now();
      return { sb, created: false };
    }
    sandboxes.delete(sid);
    await removeContainer(sb.name);
  }
  if (!create) return { sb: null, created: false };
  if (shuttingDown)
    throw new HttpError(503, "shutting_down", "The Runner is shutting down.");
  if (own === null)
    throw new HttpError(403, "forbidden", "The token does not name an Owner.");
  const ownedBy = () =>
    [...sandboxes.values()].filter((other) => other.own === own).length;
  if (sandboxes.size >= MAX_SANDBOXES || ownedBy() >= MAX_PER_OWNER)
    await forgetDead();
  // No await between these checks and the set: the slot is taken at once.
  if (ownedBy() >= MAX_PER_OWNER) {
    throw new HttpError(
      429,
      "owner_at_capacity",
      `You already have ${MAX_PER_OWNER} Sandboxes running; they close after ${Math.round(IDLE_MS / 60_000)} minutes idle.`,
      { "retry-after": "60" },
    );
  }
  if (sandboxes.size >= MAX_SANDBOXES) {
    throw new HttpError(
      503,
      "at_capacity",
      `All ${MAX_SANDBOXES} Sandboxes are in use. Try again in a few minutes.`,
      { "retry-after": "60" },
    );
  }
  const now = Date.now();
  sb = {
    sid,
    name: containerName(sid),
    own,
    createdAt: now,
    lastUsed: now,
    keepPid: null,
  };
  sandboxes.set(sid, sb);
  try {
    await startSandbox(sb);
  } catch (error) {
    sandboxes.delete(sid);
    await removeContainer(sb.name);
    throw error;
  }
  return { sb, created: true };
}

async function killStragglers(sb) {
  const result = await execIn(
    sb.name,
    ["sh", "-c", KILL_ALL, "sh", sb.keepPid],
    { timeoutMs: 8000 },
  );
  return result.code === 0;
}

async function destroySandbox(sid) {
  const had = sandboxes.delete(sid);
  await removeContainer(containerName(sid));
  return had;
}

// One request at a time per Session, so nothing races a container's creation,
// a run's clean-up or a removal.
const queues = new Map();
function enqueue(sid, task) {
  let queue = queues.get(sid);
  if (!queue) {
    queue = { tail: Promise.resolve(), depth: 0 };
    queues.set(sid, queue);
  }
  if (queue.depth >= MAX_QUEUED) {
    throw new HttpError(
      429,
      "session_busy",
      "This Session already has requests waiting.",
      { "retry-after": "5" },
    );
  }
  queue.depth += 1;
  const result = queue.tail.then(task);
  queue.tail = result
    .then(
      () => {},
      () => {},
    )
    .then(() => {
      queue.depth -= 1;
      if (queue.depth === 0) queues.delete(sid);
    });
  return result;
}

// ---------------------------------------------------------------- actions

function execFailure(sid, what, result) {
  log({
    event: "exec_failed",
    sid,
    what,
    code: result.code,
    err: brief(result.stderr),
  });
  return new HttpError(
    500,
    "sandbox_error",
    "The Sandbox did not answer as expected.",
  );
}

async function writeFile(sid, body, own) {
  const checked = normalizePath(body.path);
  if (!checked.ok) throw new HttpError(400, "invalid_path", checked.reason);
  if (typeof body.content !== "string")
    throw new HttpError(400, "invalid_content", "content must be a string");
  const content = Buffer.from(body.content, "utf8");
  if (content.length > LIMITS.fileBytes) {
    throw new HttpError(
      413,
      "file_too_large",
      `A file may be at most ${LIMITS.fileBytes} bytes.`,
    );
  }
  return enqueue(sid, async () => {
    const { sb, created } = await ensureSandbox(sid, true, own);
    const result = await execIn(
      sb.name,
      ["sh", "-c", WRITE_FILE, "sh", `./${checked.path}`],
      {
        input: content,
        stop: () => killStragglers(sb),
      },
    );
    switch (result.timedOut ? -2 : result.code) {
      case 0:
        return {
          path: checked.path,
          bytes: content.length,
          sandboxCreated: created,
        };
      case 73:
        throw new HttpError(
          409,
          "too_many_files",
          `A Sandbox holds at most ${LIMITS.maxFiles} files.`,
        );
      case 74:
        throw new HttpError(
          409,
          "path_conflict",
          "That path is a directory or a special file.",
        );
      case 75:
        throw new HttpError(
          409,
          "path_conflict",
          "A parent of that path is not a directory.",
        );
      case 76:
        throw new HttpError(
          507,
          "workdir_full",
          "The file could not be written: the workdir is full.",
        );
      default:
        throw execFailure(sid, "write", result);
    }
  });
}

async function readFile(sid, rawPath) {
  const checked = normalizePath(rawPath);
  if (!checked.ok) throw new HttpError(400, "invalid_path", checked.reason);
  const missing = new HttpError(
    404,
    "file_not_found",
    "No such file in the Sandbox.",
  );
  return enqueue(sid, async () => {
    const { sb } = await ensureSandbox(sid, false);
    if (!sb) throw missing;
    const result = await execIn(
      sb.name,
      ["sh", "-c", READ_FILE, "sh", `./${checked.path}`],
      {
        cap: LIMITS.fileBytes + 1,
        stop: () => killStragglers(sb),
      },
    );
    if (!result.timedOut && result.code === 44) throw missing;
    if (result.timedOut || result.code !== 0)
      throw execFailure(sid, "read", result);
    const truncated = result.stdout.length > LIMITS.fileBytes;
    return {
      path: checked.path,
      content: result.stdout.subarray(0, LIMITS.fileBytes).toString("utf8"),
      truncated,
    };
  });
}

async function listFiles(sid) {
  return enqueue(sid, async () => {
    const { sb } = await ensureSandbox(sid, false);
    if (!sb) return { files: [], truncated: false };
    const result = await execIn(sb.name, ["sh", "-c", LIST_FILES], {
      cap: 256 * 1024,
      stop: () => killStragglers(sb),
    });
    if (result.timedOut || result.code !== 0)
      throw execFailure(sid, "list", result);
    const files = [];
    // Names come from code in the container: keep only the ones a request could name.
    for (const line of result.stdout.toString("utf8").split("\n")) {
      const match = /^([0-9]{1,12}) \.\/(.+)$/.exec(line);
      if (!match) continue;
      const checked = normalizePath(match[2]);
      if (checked.ok && checked.path === match[2])
        files.push({ path: checked.path, size: Number(match[1]) });
    }
    files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const truncated = result.truncated || files.length > LIMITS.maxFiles;
    return { files: files.slice(0, LIMITS.maxFiles), truncated };
  });
}

async function runCommand(sid, body, own) {
  const command = normalizeCommand(body.command);
  if (!command.ok) throw new HttpError(400, "invalid_command", command.reason);
  const timeout = normalizeTimeout(body.timeoutMs);
  if (!timeout.ok) throw new HttpError(400, "invalid_timeout", timeout.reason);
  return enqueue(sid, async () => {
    const { sb, created } = await ensureSandbox(sid, true, own);
    const result = await execIn(sb.name, command.argv, {
      timeoutMs: timeout.timeoutMs,
      stop: () => killStragglers(sb),
    });
    if (result.code === -1 && !result.timedOut && !(await dockerAvailable())) {
      throw new HttpError(
        503,
        "sandbox_unavailable",
        "Docker is not available.",
      );
    }
    // Nothing outlives a run but files. If the container cannot be swept
    // (no free pid after a fork bomb, or the code killed it), it is removed.
    let sandboxReset = false;
    if (!result.swept && !(await killStragglers(sb))) {
      sandboxReset = true;
      await destroySandbox(sid);
    } else {
      sb.lastUsed = Date.now();
    }
    let stderr = result.stderr.toString("utf8");
    if (!result.timedOut && result.code === 126) stderr += NOEXEC_HINT;
    return {
      exitCode: result.timedOut ? TIMEOUT_EXIT_CODE : result.code,
      stdout: result.stdout.toString("utf8"),
      stderr,
      truncated: result.truncated,
      timedOut: result.timedOut,
      durationMs: result.durationMs,
      sandboxCreated: created,
      sandboxReset,
    };
  });
}

// ---------------------------------------------------------------- rate limits

const sessionHits = new Map(); // "sid action" -> timestamps
function limitSession(sid, action) {
  const key = `${sid} ${action}`;
  const now = Date.now();
  const hits = (sessionHits.get(key) ?? []).filter(
    (at) => now - at < WINDOW_MS,
  );
  if (hits.length >= SESSION_RATES[action]) {
    sessionHits.set(key, hits);
    const wait = Math.max(1, Math.ceil((hits[0] + WINDOW_MS - now) / 1000));
    throw new HttpError(
      429,
      "rate_limited",
      `Too many ${action} requests for this Session. Try again later.`,
      {
        "retry-after": String(wait),
      },
    );
  }
  hits.push(now);
  sessionHits.set(key, hits);
}

let globalWindow = { start: 0, count: 0 };
function limitGlobal() {
  const now = Date.now();
  if (now - globalWindow.start >= GLOBAL_RATE.windowMs)
    globalWindow = { start: now, count: 0 };
  globalWindow.count += 1;
  if (globalWindow.count > GLOBAL_RATE.limit) {
    const wait = Math.max(
      1,
      Math.ceil((globalWindow.start + GLOBAL_RATE.windowMs - now) / 1000),
    );
    throw new HttpError(
      429,
      "rate_limited",
      "The Runner is receiving too many requests.",
      {
        "retry-after": String(wait),
      },
    );
  }
}

// ---------------------------------------------------------------- http

function send(res, status, payload, headers = {}) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(body.length),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...headers,
  });
  res.end(body);
}

/** The JSON object in the body. Refuses more than LIMITS.bodyBytes with 413. */
function readJson(req) {
  return new Promise((resolve, reject) => {
    const tooLarge = () =>
      new HttpError(
        413,
        "body_too_large",
        `The body may be at most ${LIMITS.bodyBytes} bytes.`,
      );
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > LIMITS.bodyBytes) {
      reject(tooLarge());
      return;
    }
    const chunks = [];
    let size = 0;
    let done = false;
    req.on("data", (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > LIMITS.bodyBytes) {
        done = true;
        chunks.length = 0;
        reject(tooLarge());
        return;
      }
      chunks.push(chunk);
    });
    req.on("error", () => {
      if (!done)
        reject(
          new HttpError(400, "invalid_body", "The body could not be read."),
        );
      done = true;
    });
    req.on("end", () => {
      if (done) return;
      done = true;
      let parsed;
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        reject(
          new HttpError(400, "invalid_json", "The body is not valid JSON."),
        );
        return;
      }
      if (
        parsed === null ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
      ) {
        reject(
          new HttpError(400, "invalid_body", "The body must be a JSON object."),
        );
        return;
      }
      resolve(parsed);
    });
  });
}

/** Let a refused upload finish (up to a point) so the client can read the answer. */
function drain(req) {
  if (req.complete || req.destroyed) return;
  let extra = 0;
  req.on("data", (chunk) => {
    extra += chunk.length;
    if (extra > 8 * 1024 * 1024) req.destroy();
  });
  req.resume();
}

function authorize(req, sid, action) {
  // Actions that can start a Sandbox must name its Owner, for the per-Owner cap.
  const requireOwner = action === "write" || action === "run";
  const header = req.headers.authorization;
  const match =
    typeof header === "string"
      ? /^Bearer ([A-Za-z0-9_.-]{1,1024})$/.exec(header)
      : null;
  const checked = match
    ? verify(match[1], SECRET, { sid, act: action, requireOwner })
    : { ok: false, reason: "malformed" };
  if (checked.ok) return checked.payload;
  switch (checked.reason) {
    case "expired":
    case "too_far_ahead":
      throw new HttpError(
        401,
        "token_expired",
        "The token has expired or expires too far ahead.",
      );
    case "wrong_session":
    case "wrong_action":
      throw new HttpError(
        403,
        "forbidden",
        "The token is not for this Session and action.",
      );
    case "no_owner":
      throw new HttpError(
        403,
        "forbidden",
        "The token does not name an Owner.",
      );
    default:
      throw new HttpError(
        401,
        "unauthorized",
        "A valid bearer token is required.",
        {
          "www-authenticate": "Bearer",
        },
      );
  }
}

const SESSION_ROUTE = /^\/sessions\/([^/]+)(\/files|\/run)?$/;

async function route(req, url, seen) {
  if (url.pathname === "/health") {
    seen.route = "/health";
    if (req.method !== "GET")
      throw new HttpError(405, "method_not_allowed", "Use GET.", {
        allow: "GET",
      });
    // Unauthenticated, so it says nothing but whether the Runner can serve.
    return { ok: (await dockerAvailable()) && !shuttingDown };
  }

  if (url.pathname === "/status") {
    seen.route = "/status";
    if (req.method !== "GET")
      throw new HttpError(405, "method_not_allowed", "Use GET.", {
        allow: "GET",
      });
    authorize(req, "", "status");
    limitGlobal();
    const up = await dockerAvailable();
    return {
      ok: up && !shuttingDown,
      docker: up,
      live: sandboxes.size,
      max: MAX_SANDBOXES,
      maxPerOwner: MAX_PER_OWNER,
      runtime: RUNTIME ?? "runc",
    };
  }

  const match = SESSION_ROUTE.exec(url.pathname);
  if (!match) throw new HttpError(404, "not_found", "No such route.");
  const tail = match[2] ?? "";
  seen.route = `/sessions/:sid${tail}`;
  if (!isSessionId(match[1]))
    throw new HttpError(
      400,
      "invalid_session",
      "The session id must be a lower-case UUID.",
    );
  const sid = match[1];
  seen.sid = sid;

  let action;
  if (tail === "/files" && req.method === "POST") action = "write";
  else if (tail === "/files" && req.method === "GET")
    action = url.searchParams.has("path") ? "read" : "list";
  else if (tail === "/run" && req.method === "POST") action = "run";
  else if (tail === "" && req.method === "DELETE") action = "destroy";
  else {
    const allow =
      tail === "/files" ? "GET, POST" : tail === "/run" ? "POST" : "DELETE";
    throw new HttpError(405, "method_not_allowed", `Use ${allow}.`, { allow });
  }

  const claims = authorize(req, sid, action);
  if (shuttingDown)
    throw new HttpError(503, "shutting_down", "The Runner is shutting down.");
  // Only requests the app signed count against the limits, so a stranger
  // cannot use them up.
  limitGlobal();
  limitSession(sid, action);

  switch (action) {
    case "write":
      return writeFile(sid, await readJson(req), claims.own);
    case "read":
      return readFile(sid, url.searchParams.get("path"));
    case "list":
      return listFiles(sid);
    case "run":
      return runCommand(sid, await readJson(req), claims.own);
    default:
      return enqueue(sid, async () => ({
        destroyed: await destroySandbox(sid),
      }));
  }
}

async function handle(req, res) {
  const started = Date.now();
  const seen = { route: "unknown", sid: null };
  let status = 500;
  let code;
  try {
    let url;
    try {
      url = new URL(req.url ?? "/", "http://runner.invalid");
    } catch {
      throw new HttpError(
        400,
        "invalid_request",
        "The request URL is not valid.",
      );
    }
    const payload = await route(req, url, seen);
    status = 200;
    send(res, status, payload);
  } catch (error) {
    if (error instanceof HttpError) {
      status = error.status;
      code = error.code;
      send(
        res,
        status,
        { error: { code, message: error.message } },
        error.headers,
      );
    } else {
      code = "internal";
      log({ event: "error", err: brief(error?.message) });
      send(res, status, { error: { code, message: "Unexpected error." } });
    }
    drain(req);
  }
  log({
    method: req.method,
    route: seen.route,
    sid: seen.sid,
    status,
    ms: Date.now() - started,
    ...(code ? { code } : {}),
  });
}

// ---------------------------------------------------------------- lifecycle

async function labelled(filters) {
  const args = [
    "ps",
    "--all",
    "--no-trunc",
    "--format",
    '{{.Names}}\t{{.Label "harness.created"}}\t{{.Label "harness.runner"}}',
  ];
  for (const filter of filters) args.push("--filter", `label=${filter}`);
  const listed = await docker(args);
  if (listed.code !== 0) return null;
  return listed.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, created, instance] = line.split("\t");
      return { name, createdAt: Number(created) * 1000, instance };
    })
    .filter((row) => CONTAINER_NAME.test(row.name));
}

/** Remove what the last process of this instance left behind. */
async function reapLeftovers() {
  const rows = await labelled([LABEL, INSTANCE_LABEL]);
  if (!rows) return;
  await Promise.all(rows.map((row) => removeContainer(row.name)));
  if (rows.length > 0) log({ event: "reaped_leftovers", count: rows.length });
}

let reaping = false;
async function reap() {
  if (reaping || shuttingDown) return;
  reaping = true;
  try {
    const now = Date.now();
    // Idle or too old, by this process's own books. Through the Session's
    // queue, so a request that arrives meanwhile is not cut off halfway.
    for (const sb of [...sandboxes.values()]) {
      if (sb.keepPid === null) continue;
      const expired = (at) =>
        at.lastUsed + IDLE_MS <= Date.now() ||
        at.createdAt + MAX_AGE_MS <= Date.now();
      if (!expired(sb) || queues.has(sb.sid)) continue;
      try {
        await enqueue(sb.sid, async () => {
          const current = sandboxes.get(sb.sid);
          if (current && expired(current)) {
            await destroySandbox(sb.sid);
            log({ event: "reaped", sid: sb.sid });
          }
        });
      } catch {
        // busy again: leave it for the next pass
      }
    }
    // By Docker's books: any labelled container older than two hours, whoever
    // started it, and any container of this instance that it does not know.
    const rows = await labelled([LABEL]);
    if (rows) {
      const running = new Set(rows.map((row) => row.name));
      for (const row of rows) {
        const sid = row.name.slice(-36);
        const tooOld =
          Number.isFinite(row.createdAt) && row.createdAt + MAX_AGE_MS <= now;
        const orphan = row.instance === INSTANCE && !sandboxes.has(sid);
        if (!tooOld && !orphan) continue;
        if (row.instance === INSTANCE) sandboxes.delete(sid);
        await removeContainer(row.name);
        log({ event: "reaped", sid, why: tooOld ? "age" : "orphan" });
      }
      for (const sb of sandboxes.values()) {
        if (sb.keepPid !== null && !running.has(sb.name) && !queues.has(sb.sid))
          sandboxes.delete(sb.sid);
      }
    }
    for (const [key, hits] of sessionHits) {
      if (hits.length === 0 || now - hits[hits.length - 1] >= WINDOW_MS)
        sessionHits.delete(key);
    }
  } finally {
    reaping = false;
  }
}

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log({ event: "shutdown", signal });
  server.close();
  const names = new Set([...sandboxes.values()].map((sb) => sb.name));
  for (const row of (await labelled([LABEL, INSTANCE_LABEL])) ?? [])
    names.add(row.name);
  await Promise.all([...names].map((name) => removeContainer(name)));
  server.closeAllConnections();
  process.exit(0);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(() => res.destroy());
});
server.headersTimeout = 10_000;
server.requestTimeout = 20_000; // time to send a whole request, not to get the answer
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 64;

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("uncaughtException", (error) => {
  log({ event: "fatal", err: brief(error?.message) });
  process.exit(1);
});

await reapLeftovers();
ensureImage().catch(() => {}); // tried again when the first Sandbox is asked for
setInterval(() => void reap().catch(() => {}), REAP_MS).unref();

server.listen(PORT, HOST, () => {
  log({
    event: "listening",
    host: HOST,
    port: server.address().port,
    instance: INSTANCE,
    max: MAX_SANDBOXES,
    maxPerOwner: MAX_PER_OWNER,
    runtime: RUNTIME ?? "runc",
    cgroupParent: CGROUP_PARENT,
  });
});
