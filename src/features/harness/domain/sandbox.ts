/**
 * The Sandbox: a Vercel Sandbox (a microVM with no network) where the Agent,
 * and a Pipeline's model Steps, write and run code (ADR 0022). Every Staff
 * member's Session may use one; the hourly command cap is what holds it in.
 */

/** What the app enforces on every Sandbox and every command. */
export const SANDBOX_LIMITS = {
  /** Wall time of one command. */
  commandSeconds: 60,
  /** One file written through `code_write_file`. */
  fileBytes: 256 * 1024,
  /** Characters of stdout, and of stderr, handed back. */
  outputChars: 20_000,
  /**
   * A Session's Sandbox lives this long when made, and each command extends it
   * when less than `extendBelowMinutes` is left, so an idle one stops soon.
   */
  sandboxMinutes: 10,
  extendBelowMinutes: 3,
  extendByMinutes: 5,
  /** A stopped Session Sandbox keeps its files this long, then starts empty. */
  keepFilesHours: 24,
  /** `run_code` calls one model Step may make (its Sandbox is removed after). */
  stepCodeCalls: 3,
} as const;

/** The default working directory of a Vercel Sandbox. */
export const SANDBOX_WORKDIR = "/vercel/sandbox";

/** A Session's Sandbox, found again by name from any function instance. */
export const sessionSandboxName = (sessionId: string) =>
  `harness-session-${sessionId}`;

export type SandboxRunResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** True when the command was cut off at `SANDBOX_LIMITS.commandSeconds`. */
  timedOut: boolean;
  /** True when the output was cut at `SANDBOX_LIMITS.outputChars`. */
  truncated: boolean;
  ms: number;
  /** True when this command started a new Sandbox: files written earlier are gone. */
  sandboxCreated: boolean;
};

export type SandboxFile = {
  /** Relative to the Sandbox's workdir. */
  path: string;
  bytes: number;
  directory: boolean;
};

export type SandboxFileContent = {
  path: string;
  content: string;
  bytes: number;
  truncated: boolean;
};

/** A written file; `sandboxCreated` means earlier files of the Session are gone. */
export type SandboxWriteResult = SandboxFile & { sandboxCreated: boolean };

/**
 * What the Agent must know when a fresh Sandbox was started: any file
 * written before is gone, so it writes them again before relying on them.
 */
export function sandboxNote(result: { sandboxCreated?: boolean }): string {
  return result.sandboxCreated
    ? " This started a new Sandbox: any files written earlier in this Session are gone."
    : "";
}

/**
 * A path the Agent gave, made relative to the workdir. Refuses a path that
 * climbs out of it: not a security boundary (the Sandbox is the Session's
 * own), but it keeps every file where `code_list_files` finds it.
 */
export function workdirPath(given: string): string | null {
  const trimmed = given.trim().replace(/\\/g, "/");
  const relative = trimmed.startsWith(`${SANDBOX_WORKDIR}/`)
    ? trimmed.slice(SANDBOX_WORKDIR.length + 1)
    : trimmed.replace(/^(\.\/)+/, "");
  if (!relative || relative.startsWith("/")) return null;
  const parts = relative.split("/").filter((part) => part && part !== ".");
  if (parts.length === 0 || parts.some((part) => part === "..")) return null;
  return parts.join("/");
}

/**
 * The shell script every command runs under: `sh -c "$1"` with stdout and
 * stderr to files (each capped on disk by `ulimit -f`) and a `timeout` that
 * kills the command itself, then at most `outputBytes` of each printed back,
 * exiting with the command's own code. Output is cut in the Sandbox, so
 * reading it back never loads more than a few KB, however much was printed.
 */
const OUTPUT_BYTES = SANDBOX_LIMITS.outputChars * 2;
const OUTPUT_FILE_BLOCKS = 20_000;
const COMMAND_SECONDS = SANDBOX_LIMITS.commandSeconds - 2;

export function runnerScript(seconds = COMMAND_SECONDS): string {
  return [
    `ulimit -f ${OUTPUT_FILE_BLOCKS} 2>/dev/null`,
    "out=$(mktemp); err=$(mktemp)",
    `if command -v timeout >/dev/null 2>&1; then timeout -k 2 ${seconds} sh -c "$1" >"$out" 2>"$err"; else sh -c "$1" >"$out" 2>"$err"; fi`,
    "code=$?",
    `cap() { size=$(wc -c <"$1"); head -c ${OUTPUT_BYTES} "$1"; if [ "$size" -gt ${OUTPUT_BYTES} ]; then printf '\\n… [%s more bytes cut]' $((size - ${OUTPUT_BYTES})); fi; }`,
    'cap "$out"; cap "$err" >&2',
    `[ "$code" = 124 ] && printf '\\nTimed out after ${seconds} s.' >&2`,
    `[ "$code" = 153 ] && printf '\\nKilled: the output passed the size limit.' >&2`,
    'rm -f "$out" "$err"',
    'exit "$code"',
  ].join("\n");
}

/** Seconds a command may run before `timeout` kills it, for a wanted wall time. */
export const commandSecondsFor = (timeoutMs: number) =>
  Math.max(1, Math.min(COMMAND_SECONDS, Math.floor(timeoutMs / 1000)));
