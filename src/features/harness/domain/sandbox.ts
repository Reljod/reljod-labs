/** The Sandbox: a container on the VPS where the Agent writes and runs code for one Session (ADR 0017). */

export type SandboxStatus = {
  /** False when `HARNESS_SANDBOX_URL` is unset: the Sandbox is off. */
  configured: boolean;
  /** Whether the Runner answered just now. */
  online: boolean;
  /** This Session's container, if one is live. */
  container: {
    status: "starting" | "ready" | "stopped";
    lastUsedAt: string;
  } | null;
  /** What to tell the person when it cannot be used ("Sandbox offline"). */
  message: string | null;
};

/** What the Sandbox enforces on every container; the Runner holds the same numbers. */
export const SANDBOX_LIMITS = {
  commandSeconds: 60,
  memoryMb: 512,
  cpus: 1,
  fileBytes: 256 * 1024,
  outputChars: 20_000,
} as const;

export type SandboxRunResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** True when the command was cut off at `SANDBOX_LIMITS.commandSeconds`. */
  timedOut: boolean;
  /** True when the output was cut at `SANDBOX_LIMITS.outputChars`. */
  truncated: boolean;
  ms: number;
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
