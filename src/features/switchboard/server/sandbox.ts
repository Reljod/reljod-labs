import "server-only";
import { createHash } from "node:crypto";
import { Sandbox } from "@vercel/sandbox";
import type { Owner } from "@/features/access/domain/owner";
import { SANDBOX_LIMITS } from "../domain/limits";
import { env } from "./env";

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * The coding Sandbox, as Sieve and the Harness run it: a Vercel Sandbox with
 * no network, one per Owner, found again by name. The Agent's code reads the
 * files it is handed (past Calls, the Rulebook) and prints what it finds.
 * Code is analysis: only the Back office's Checks decide anything.
 */

const DIR = "/vercel/run";
const NODE_SECONDS = Math.floor(SANDBOX_LIMITS.commandMs / 1000) - 2;

const RUNNER_SCRIPT = [
  `ulimit -f ${SANDBOX_LIMITS.outputFileBlocks} 2>/dev/null`,
  `cd ${DIR}`,
  'out="$1.out"; err="$1.err"',
  `if command -v timeout >/dev/null 2>&1; then timeout -k 2 ${NODE_SECONDS} node "$1" >"$out" 2>"$err"; else node "$1" >"$out" 2>"$err"; fi`,
  "code=$?",
  `cap() { size=$(wc -c <"$1"); head -c ${SANDBOX_LIMITS.outputBytes} "$1"; if [ "$size" -gt ${SANDBOX_LIMITS.outputBytes} ]; then printf '\\n… [%s more bytes cut]' $((size - ${SANDBOX_LIMITS.outputBytes})); fi; }`,
  'cap "$out"; cap "$err" >&2',
  `[ "$code" = 124 ] && printf '\\nTimed out after ${NODE_SECONDS} s.' >&2`,
  'rm -f "$out" "$err"',
  'exit "$code"',
].join("\n");

export type CodeResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  ms: number;
};

const cap = (text: string) =>
  text.length > SANDBOX_LIMITS.outputChars
    ? `${text.slice(0, SANDBOX_LIMITS.outputChars)}\n… [${text.length - SANDBOX_LIMITS.outputChars} more characters cut]`
    : text;

const nameOf = (owner: Owner) =>
  `switchboard-${createHash("sha256").update(owner).digest("hex").slice(0, 24)}`;

/**
 * Runs the Agent's code with the given files beside it. Never throws: no
 * Sandbox, a failed write or a timeout all come back as a result with a
 * non-zero exit code and the reason in stderr.
 */
export async function runCode(input: {
  owner: Owner;
  code: string;
  files: { path: string; content: string }[];
}): Promise<CodeResult> {
  const started = Date.now();
  const refused = (stderr: string): CodeResult => ({
    stdout: "",
    stderr,
    exitCode: 1,
    ms: Date.now() - started,
  });
  if (!env.sandboxConfigured())
    return refused(
      "Sandbox unavailable: this deployment cannot reach Vercel Sandbox (no OIDC token).",
    );
  if (input.code.length > SANDBOX_LIMITS.codeChars)
    return refused(`The code is over ${SANDBOX_LIMITS.codeChars} characters.`);
  let sandbox: Sandbox;
  try {
    sandbox = await Sandbox.getOrCreate({
      name: nameOf(input.owner),
      networkPolicy: "deny-all",
      timeout: SANDBOX_LIMITS.sandboxMs,
      // Nothing is resumed: every run writes its own files. A persistent
      // Sandbox would snapshot its whole disk at each stop and keep it 30 days.
      persistent: false,
    });
  } catch (error) {
    return refused(`Sandbox unavailable: ${messageOf(error)}`);
  }
  try {
    // getOrCreate may hand back a Sandbox made with other settings: enforce them.
    await sandbox.update({ networkPolicy: "deny-all", persistent: false });
    const expires = sandbox.expiresAt?.getTime();
    if (expires !== undefined && expires - Date.now() < 90_000) {
      try {
        await sandbox.extendTimeout(SANDBOX_LIMITS.sandboxMs);
      } catch {
        // At the plan's limit: the command has what is left.
      }
    }
    const file = `${DIR}/run-${Date.now()}.mjs`;
    await sandbox.writeFiles([
      ...input.files.map((item) => ({
        path: `${DIR}/${item.path}`,
        content: item.content,
      })),
      { path: file, content: input.code },
    ]);
    const result = await sandbox.runCommand(
      "sh",
      ["-c", RUNNER_SCRIPT, "switchboard", file],
      { timeoutMs: SANDBOX_LIMITS.commandMs + 5_000 },
    );
    const [stdout, stderr] = await Promise.all([
      result.stdout(),
      result.stderr(),
    ]);
    return {
      stdout: cap(stdout),
      stderr: cap(stderr),
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
        : `The Sandbox could not run the code: ${messageOf(error)}`,
      exitCode: timedOut ? 124 : 1,
      ms,
    };
  }
}
