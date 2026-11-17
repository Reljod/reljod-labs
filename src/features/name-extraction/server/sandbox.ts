import "server-only";
import { Sandbox } from "@vercel/sandbox";
import type { DocumentText } from "../domain/contract";
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
 */
export const SANDBOX_LIMITS = {
  /** Wall time of one run_code. */
  commandMs: 60_000,
  /** The Sandbox's own lifetime: a Run that dies without stopping it is reaped. */
  sandboxMs: 30 * 60_000,
  outputChars: 8_000,
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

export type CodeResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  ms: number;
};

/** Runs the Analyst's code in the Run's Sandbox, with the current state files written first. */
export async function runInSandbox(input: {
  runId: string;
  callId: string;
  code: string;
  document: () => Promise<DocumentText>;
  state: SandboxFile[];
}): Promise<CodeResult> {
  const started = Date.now();
  const sandbox = await Sandbox.getOrCreate({
    name: sandboxName(input.runId),
    networkPolicy: "deny-all",
    timeout: SANDBOX_LIMITS.sandboxMs,
    onCreate: async (created) => {
      await writeAll(created, documentFiles(await input.document()));
    },
  });
  // getOrCreate may hand back a Sandbox made with another policy: enforce it.
  await sandbox.update({ networkPolicy: "deny-all" });
  const file = `${RUN_DIR}/${input.callId.replace(/[^\w-]/g, "_").slice(0, 80)}.mjs`;
  await writeAll(sandbox, [
    ...input.state,
    { path: file, content: input.code },
  ]);
  try {
    const result = await sandbox.runCommand("node", [file], {
      timeoutMs: SANDBOX_LIMITS.commandMs,
    });
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
    const timedOut = ms >= SANDBOX_LIMITS.commandMs - 500;
    return {
      stdout: "",
      stderr: timedOut
        ? `Timed out after ${SANDBOX_LIMITS.commandMs / 1000} s.`
        : `The Sandbox could not run the code: ${error instanceof Error ? error.message : String(error)}`,
      // 124 is what `timeout(1)` exits with; -1 is kept for "not run yet".
      exitCode: timedOut ? 124 : 1,
      ms,
    };
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
    await sandbox.delete();
  } catch {
    // No Sandbox was made for this Run, or it is already gone.
  }
}
