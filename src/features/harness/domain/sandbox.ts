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
  /** Whether the signed-in Staff member's Role may use it (`sandbox.use`). Set by the route. */
  canUse?: boolean;
  /** Why not, when `canUse` is false ("Only an admin may use the Sandbox..."). */
  cannotUseReason?: string | null;
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
  /** True when this command started a new container: files written earlier are gone. */
  sandboxCreated: boolean;
  /** True when the container was removed after this command: its files are gone. */
  sandboxReset: boolean;
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
 * What the Agent must know when the Runner started a fresh container: any
 * file written before is gone, so it writes them again before relying on them.
 */
export function sandboxNote(result: {
  sandboxCreated?: boolean;
  sandboxReset?: boolean;
}): string {
  if (result.sandboxReset)
    return " The Sandbox was reset before this ran (it had been idle or was stopped): files written earlier in this Session are gone; write them again.";
  if (result.sandboxCreated)
    return " This started a new Sandbox: any files written earlier in this Session are gone.";
  return "";
}
