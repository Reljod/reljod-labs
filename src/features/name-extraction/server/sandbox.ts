import "server-only";
import { Sandbox } from "@vercel/sandbox";
import type { DocumentText } from "../domain/contract";
import { runSink } from "./emit";
import { isOver } from "./repository";
import {
  documentFiles,
  RUN_DIR,
  type SandboxFile,
} from "./toolkit/sandbox-files";

/**
 * One Vercel Sandbox per Run, named after it, with no network. Created on the
 * first `run_code` with the pages on disk, reused by later calls (they may
 * run in other function instances: the name finds it), and stopped when the
 * Run ends. Auth is the deployment's OIDC token (VERCEL_OIDC_TOKEN locally).
 *
 * Not persistent: a persistent Sandbox (the SDK's default) snapshots its whole
 * disk (~800 MB) every time it stops, and those snapshots live for 30 days
 * and count against the plan's Sandbox quota. Nothing on the disk is worth
 * keeping: the state files and the code are written on every `run_code`, and
 * the pages whenever a session starts (made, or resumed after a timeout).
 */
export const SANDBOX_LIMITS = {
  /** Wall time of one run_code. */
  commandMs: 60_000,
  /**
   * The Sandbox's own lifetime when made: short, so one a stopped Run leaves
   * behind is reaped soon. Each run_code extends it when less than
   * `extendBelowMs` is left.
   */
  sandboxMs: 10 * 60_000,
  extendBelowMs: 2 * 60_000,
  extendByMs: 5 * 60_000,
  outputChars: 8_000,
  /** Bytes of stdout and of stderr read back; the rest is cut in the Sandbox. */
  outputBytes: 32_000,
  /** The most either stream may write to disk before node is killed (SIGXFSZ). */
  outputFileBlocks: 20_000,
};

export function sandboxName(runId: string) {
  return `sieve-${runId}`;
}

const WRITE_BATCH = 100;

async function writeAll(sandbox: Sandbox, files: SandboxFile[]) {
  for (let index = 0; index < files.length; index += WRITE_BATCH) {
    await sandbox.writeFiles(files.slice(index, index + WRITE_BATCH));
  }
}

function capOutput(text: string) {
  return text.length > SANDBOX_LIMITS.outputChars
    ? `${text.slice(0, SANDBOX_LIMITS.outputChars)}\n… [${text.length - SANDBOX_LIMITS.outputChars} more characters cut]`
    : text;
}

/**
 * Runs `node $1` with stdout and stderr to files (each capped on disk by
 * `ulimit -f`), then prints at most `outputBytes` of each and exits with
 * node's own exit code. Output is cut in the Sandbox, so reading it back
 * never loads more than a few KB, however much the code printed.
 */
const NODE_SECONDS = Math.floor(SANDBOX_LIMITS.commandMs / 1000) - 2;

export const RUNNER_SCRIPT = [
  `ulimit -f ${SANDBOX_LIMITS.outputFileBlocks} 2>/dev/null`,
  'out="$1.out"; err="$1.err"',
  // `timeout` kills node itself; the Sandbox's own timeout would kill only sh.
  `if command -v timeout >/dev/null 2>&1; then timeout -k 2 ${NODE_SECONDS} node "$1" >"$out" 2>"$err"; else node "$1" >"$out" 2>"$err"; fi`,
  "code=$?",
  `cap() { size=$(wc -c <"$1"); head -c ${SANDBOX_LIMITS.outputBytes} "$1"; if [ "$size" -gt ${SANDBOX_LIMITS.outputBytes} ]; then printf '\\n… [%s more bytes cut]' $((size - ${SANDBOX_LIMITS.outputBytes})); fi; }`,
  'cap "$out"; cap "$err" >&2',
  `[ "$code" = 124 ] && printf '\\nTimed out after ${NODE_SECONDS} s.' >&2`,
  `[ "$code" = 153 ] && printf '\\nKilled: the output passed the size limit.' >&2`,
  'rm -f "$out" "$err"',
  'exit "$code"',
].join("\n");

export type CodeResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  ms: number;
};

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** Whether the Run has ended (stopped, failed, completed) or is gone. */
async function runIsOver(runId: string) {
  try {
    const status = await runSink().status(runId);
    return status === null || isOver(status);
  } catch {
    // Unknown: let the code run; the Run's end disposes the Sandbox anyway.
    return false;
  }
}

/** Gives the Sandbox room for one more command, best effort. */
async function extendIfShort(sandbox: Sandbox) {
  const expires = sandbox.expiresAt?.getTime();
  if (expires === undefined) return;
  if (expires - Date.now() >= SANDBOX_LIMITS.extendBelowMs) return;
  try {
    await sandbox.extendTimeout(SANDBOX_LIMITS.extendByMs);
  } catch {
    // At the plan's limit: the command still has whatever time is left.
  }
}

/**
 * Runs the Analyst's code in the Run's Sandbox, with the current state files
 * written first. Never throws: every failure (no Sandbox, a write that fails,
 * a Run that was stopped meanwhile) comes back as a result with a non-zero
 * exit code and the reason in stderr, so the step is not retried and the
 * pending `code` event gets its result.
 */
export async function runInSandbox(input: {
  runId: string;
  callId: string;
  code: string;
  document: () => Promise<DocumentText>;
  state: SandboxFile[];
}): Promise<CodeResult> {
  const started = Date.now();
  const refused = (stderr: string, exitCode = 1): CodeResult => ({
    stdout: "",
    stderr,
    exitCode,
    ms: Date.now() - started,
  });
  // A Run stopped while the Analyst was deciding must not get a new Sandbox.
  if (await runIsOver(input.runId))
    return refused("The Run is over; the code was not run.");
  const seed = async (box: Sandbox) =>
    writeAll(box, documentFiles(await input.document()));
  let sandbox: Sandbox;
  try {
    sandbox = await Sandbox.getOrCreate({
      name: sandboxName(input.runId),
      persistent: false,
      networkPolicy: "deny-all",
      timeout: SANDBOX_LIMITS.sandboxMs,
      // A Sandbox that timed out between two calls comes back as a new
      // session with an empty disk (it is not persistent), so the pages go
      // in again whenever a session starts, not only when the Sandbox is made.
      onCreate: seed,
      onResume: seed,
    });
  } catch (error) {
    return refused(`The Sandbox could not be started: ${message(error)}`);
  }
  try {
    // getOrCreate may hand back a Sandbox made with other settings: enforce them.
    await sandbox.update({ networkPolicy: "deny-all", persistent: false });
    await extendIfShort(sandbox);
    const file = `${RUN_DIR}/${input.callId.replace(/[^\w-]/g, "_").slice(0, 80)}.mjs`;
    await writeAll(sandbox, [
      ...input.state,
      { path: file, content: input.code },
    ]);
    const result = await sandbox.runCommand(
      "sh",
      ["-c", RUNNER_SCRIPT, "sieve", file],
      // A little over node's own limit, so `timeout` fires first.
      { timeoutMs: SANDBOX_LIMITS.commandMs + 5_000 },
    );
    const [stdout, stderr] = await Promise.all([
      result.stdout(),
      result.stderr(),
    ]);
    return {
      stdout: capOutput(stdout),
      stderr: capOutput(stderr),
      exitCode: result.exitCode,
      ms: Date.now() - started,
    };
  } catch (error) {
    const ms = Date.now() - started;
    const timedOut = ms >= SANDBOX_LIMITS.commandMs;
    return {
      stdout: "",
      stderr: timedOut
        ? `Timed out after ${SANDBOX_LIMITS.commandMs / 1000} s.`
        : `The Sandbox could not run the code: ${message(error)}`,
      // 124 is what `timeout(1)` exits with; -1 is kept for "not run yet".
      exitCode: timedOut ? 124 : 1,
      ms,
    };
  } finally {
    // Stopped while the code ran: stopRun's dispose may have come first.
    if (await runIsOver(input.runId)) await disposeSandbox(input.runId);
  }
}

/** Stops and deletes the Run's Sandbox, if it has one. Best effort. */
export async function disposeSandbox(runId: string) {
  try {
    const sandbox = await Sandbox.get({ name: sandboxName(runId) });
    try {
      await sandbox.stop();
    } catch {
      // Already stopped.
    }
    // Also drop any snapshot a stop left behind (one made before this
    // Sandbox stopped being persistent); the SDK keeps them by default.
    await sandbox.delete({ deleteOrphanSnapshots: true });
  } catch {
    // No Sandbox was made for this Run, or it is already gone.
  }
}
