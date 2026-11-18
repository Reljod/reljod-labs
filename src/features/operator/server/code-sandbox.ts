import "server-only";
import { Sandbox } from "@vercel/sandbox";
import type { Change } from "../legacy/types";
import type { RunContext } from "./context";
import { env } from "./env";

/*
 * The Code sandbox: where `run_code` runs (ADR 0026). A second Vercel
 * Sandbox, made on the first call, with no network and nothing in it but the
 * Task, the Manifest, what the Run has keyed so far and a check-digit helper.
 * It is a different microVM from the Screen sandbox, so code the driver
 * wrote cannot reach HARBOURMASTER or the Guard: the keyboard is the only
 * way in. After Sieve's (name-extraction/server/sandbox.ts).
 */
export const CODE_LIMITS = {
  commandMs: 30_000,
  sandboxMs: 6 * 60_000,
  codeChars: 20_000,
  outputChars: 6_000,
  outputBytes: 24_000,
  outputFileBlocks: 20_000,
} as const;

const DIR = "/vercel/sandbox/work";

export const codeSandboxName = (runId: string) => `operator-code-${runId}`;

const NODE_SECONDS = Math.floor(CODE_LIMITS.commandMs / 1000) - 2;

/** Runs `node $1` with both streams capped on disk and cut before they are read back. */
const RUNNER_SCRIPT = [
  `ulimit -f ${CODE_LIMITS.outputFileBlocks} 2>/dev/null`,
  `cd ${DIR}`,
  'out="$1.out"; err="$1.err"',
  `if command -v timeout >/dev/null 2>&1; then timeout -k 2 ${NODE_SECONDS} node "$1" >"$out" 2>"$err"; else node "$1" >"$out" 2>"$err"; fi`,
  "code=$?",
  `cap() { size=$(wc -c <"$1"); head -c ${CODE_LIMITS.outputBytes} "$1"; if [ "$size" -gt ${CODE_LIMITS.outputBytes} ]; then printf '\\n... [%s more bytes cut]' $((size - ${CODE_LIMITS.outputBytes})); fi; }`,
  'cap "$out"; cap "$err" >&2',
  `[ "$code" = 124 ] && printf '\\nTimed out after ${NODE_SECONDS} s.' >&2`,
  'rm -f "$out" "$err"',
  'exit "$code"',
].join("\n");

const ISO6346 = `// ISO 6346 container numbers: 4 letters, 6 digits, 1 check digit.
const VALUES = {};
{
  let value = 10;
  for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    if (value % 11 === 0) value += 1;
    VALUES[letter] = value;
    value += 1;
  }
}
export function normalise(text) {
  return String(text).toUpperCase().replace(/[^A-Z0-9]/g, "");
}
export function checkDigit(first10) {
  if (!/^[A-Z]{4}[0-9]{6}$/.test(first10)) return null;
  let sum = 0;
  for (let index = 0; index < 10; index += 1) {
    const char = first10[index];
    sum += (index < 4 ? VALUES[char] : Number(char)) * 2 ** index;
  }
  return (sum % 11) % 10;
}
export function isValid(container) {
  const text = normalise(container);
  return text.length === 11 && checkDigit(text.slice(0, 10)) === Number(text[10]);
}
`;

const README = `Files here (read-only inputs, no network):
- task.txt       the Task in plain words
- manifest.txt   the attached Manifest as text (absent when there is none)
- keyed.json     what the Books have gained or lost in this Run so far: an array of
                 { op, record, key, before?, after?, fields? } changes against the start
- iso6346.mjs    import { normalise, checkDigit, isValid } from "./iso6346.mjs"
Write plain Node.js (ESM). Print what you need with console.log.
`;

export type CodeResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  ms: number;
};

const cap = (text: string) =>
  text.length > CODE_LIMITS.outputChars
    ? `${text.slice(0, CODE_LIMITS.outputChars)}\n... [${text.length - CODE_LIMITS.outputChars} more characters cut]`
    : text;

/**
 * Runs the driver's code. Never throws: every failure comes back as a result
 * with a non-zero exit code and a plain reason, so the step is not retried.
 */
export async function runCode(input: {
  ctx: RunContext;
  callId: string;
  code: string;
  keyed: Change[];
}): Promise<CodeResult> {
  const started = Date.now();
  const refused = (stderr: string): CodeResult => ({
    stdout: "",
    stderr,
    exitCode: 1,
    ms: Date.now() - started,
  });
  if (!env.sandboxConfigured())
    return refused("Code sandbox unavailable: it is not set up here.");
  let sandbox: Sandbox;
  try {
    sandbox = await Sandbox.getOrCreate({
      name: codeSandboxName(input.ctx.runId),
      networkPolicy: "deny-all",
      persistent: false,
      timeout: CODE_LIMITS.sandboxMs,
    });
    // getOrCreate may hand back a sandbox made with another policy: enforce it.
    await sandbox.update({ networkPolicy: "deny-all" });
  } catch (error) {
    console.error("[operator] code sandbox:", error);
    return refused("Code sandbox unavailable.");
  }
  try {
    const file = `${DIR}/${input.callId.replace(/[^\w-]/g, "_").slice(0, 60)}.mjs`;
    await sandbox.writeFiles([
      { path: `${DIR}/README.txt`, content: README },
      { path: `${DIR}/task.txt`, content: input.ctx.brief },
      { path: `${DIR}/iso6346.mjs`, content: ISO6346 },
      {
        path: `${DIR}/keyed.json`,
        content: JSON.stringify(input.keyed, null, 1),
      },
      ...(input.ctx.manifest
        ? [{ path: `${DIR}/manifest.txt`, content: input.ctx.manifest.text }]
        : []),
      { path: file, content: input.code },
    ]);
    const result = await sandbox.runCommand(
      "sh",
      ["-c", RUNNER_SCRIPT, "operator", file],
      { timeoutMs: CODE_LIMITS.commandMs + 5_000 },
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
    console.error("[operator] code sandbox:", error);
    const ms = Date.now() - started;
    const timedOut = ms >= CODE_LIMITS.commandMs;
    return {
      stdout: "",
      stderr: timedOut
        ? `Timed out after ${CODE_LIMITS.commandMs / 1000} s.`
        : "The Code sandbox could not run the code.",
      exitCode: timedOut ? 124 : 1,
      ms,
    };
  }
}

/** Stops and deletes a Run's Code sandbox, if it has one. Best effort. */
export async function disposeCode(runId: string) {
  try {
    const sandbox = await Sandbox.get({ name: codeSandboxName(runId) });
    // Deleting a running sandbox ends it; waiting for a clean stop first takes far longer.
    await sandbox.delete().catch(async () => {
      await sandbox.stop().catch(() => {});
      await sandbox.delete();
    });
  } catch {
    // None was made, or it is already gone.
  }
}
