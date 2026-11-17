import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import type {
  SandboxFile,
  SandboxFileContent,
  SandboxRunResult,
  SandboxStatus,
} from "../domain/sandbox";
import type { Actor, PaidActor } from "./actor";
import { NotBuiltError } from "./errors";

/*
 * STUB. Owned by the Sandbox slice, which replaces every body here and keeps
 * the signatures (ADR 0017). Each call reaches the Runner on the VPS with a
 * short-lived HMAC token (`HARNESS_SANDBOX_SECRET`) that names the Session.
 * With `HARNESS_SANDBOX_URL` unset, or the Runner down, nothing here throws
 * an unexpected error: `sandboxStatus` says so and the others throw a
 * StateError("Sandbox offline"), so the rest of the Harness keeps working.
 *
 * Every function that takes a Staff member checks `can(staff,
 * "sandbox.use")` and that the Session is in the Owner's Workspace. The
 * container's limits, not the Role, are the security boundary.
 */

/** Whether the Sandbox can be used, and the Session's container if one is live. Never throws for an offline Runner. */
export async function sandboxStatus(_input?: {
  owner: Owner;
  sessionId?: string | null;
}): Promise<SandboxStatus> {
  throw new NotBuiltError("sandbox");
}

/** Writes a file under the Sandbox's workdir (at most `SANDBOX_LIMITS.fileBytes`), starting the container if needed. Writes `sandbox.command`. */
export async function sandboxWriteFile(
  _input: PaidActor & { sessionId: string; path: string; content: string },
): Promise<SandboxFile> {
  throw new NotBuiltError("sandbox");
}

/**
 * Runs one command in the Session's container and returns what it printed.
 * Takes one of the visitor's `LIMITS.sandboxCommandsPerHour` and writes
 * `sandbox.command` with the command (cut) and the exit code.
 */
export async function sandboxRun(
  _input: PaidActor & { sessionId: string; command: string },
): Promise<SandboxRunResult> {
  throw new NotBuiltError("sandbox");
}

/** Reads a file from the Sandbox's workdir, cut at `SANDBOX_LIMITS.fileBytes`. */
export async function sandboxReadFile(
  _input: Actor & { sessionId: string; path: string },
): Promise<SandboxFileContent> {
  throw new NotBuiltError("sandbox");
}

/** Lists the files under a directory of the Sandbox's workdir (the workdir itself by default). */
export async function sandboxListFiles(
  _input: Actor & { sessionId: string; path?: string },
): Promise<SandboxFile[]> {
  throw new NotBuiltError("sandbox");
}

/** Removes the Session's container. Best effort against the Runner; always clears the local row. Writes `sandbox.destroyed`. */
export async function sandboxDestroy(_input: {
  owner: Owner;
  sessionId: string;
}): Promise<void> {
  throw new NotBuiltError("sandbox");
}
