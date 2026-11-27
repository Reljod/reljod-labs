import "server-only";
import { ConflictError, InvalidError, NotFoundError } from "@/platform/errors";
import {
  SANDBOX_LIMITS,
  type SandboxFile,
  type SandboxFileContent,
  type SandboxRunResult,
  type SandboxWriteResult,
  workdirPath,
} from "../../domain/sandbox";
import { sandboxUnavailable as unavailable } from "../errors";
import type {
  Actor,
  AuditLog,
  HarnessRate,
  OwnedAuditInput,
  PaidActor,
  SessionSandboxes,
} from "../ports";
import type { SessionService } from "./sessions";

const DEFAULT_COMMAND_MS = 30_000;
const MIN_COMMAND_MS = 1_000;
const COMMAND_AUDIT_CHARS = 200;
const OUTPUT_HEAD_CHARS = 120;
const MAX_COMMAND_CHARS = 64 * 1024;

const cut = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}…` : text;
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
const viaOf = (via?: "app" | "agent") => (via ? { via } : {});

/** A failure's message when it is one of ours; a plain phrase otherwise. */
const safeMessage = (error: unknown): string =>
  error instanceof ConflictError || error instanceof InvalidError
    ? error.message
    : "The Sandbox failed.";

type Where = { sessionId: string; via?: "app" | "agent" };

/**
 * A Session's Sandbox (ADR 0022), for the Agent to code with: only in the
 * Staff member's own Session, every write and command taking one of the
 * visitor's Sandbox commands this hour, and every command audited before it
 * runs (nothing runs if its event cannot be written). Code is analysis:
 * only a Pipeline's checks return a Finding.
 */
export interface SandboxService {
  write(
    actor: PaidActor,
    where: Where,
    path: string,
    content: string,
  ): Promise<SandboxWriteResult>;
  /** One shell command under `sh -c` in the workdir; `timeoutMs` is held to 1 s .. the limit. */
  run(
    actor: PaidActor,
    where: Where & { timeoutMs?: number },
    command: string,
  ): Promise<SandboxRunResult>;
  read(
    actor: Actor,
    sessionId: string,
    path: string,
  ): Promise<SandboxFileContent>;
  list(actor: Actor, sessionId: string, path?: string): Promise<SandboxFile[]>;
}

export function createSandboxService(ports: {
  sandboxes: SessionSandboxes;
  sessions: Pick<SessionService, "readable" | "writable">;
  rate: HarnessRate;
  audit: AuditLog;
}): SandboxService {
  const { sandboxes } = ports;

  const requireConfigured = () => {
    if (!sandboxes.configured) throw unavailable("it is not set up here");
  };

  /** An Audit write that cannot fail the command it records. */
  const record = (input: OwnedAuditInput) =>
    ports.audit.record(input).catch((error) => {
      console.error("[harness] sandbox audit failed", input.action, error);
      return null;
    });

  const started = (actor: Actor, where: Where) =>
    record({
      owner: actor.owner,
      sessionId: where.sessionId,
      actor: { kind: "staff", staff: actor.staff },
      action: "sandbox.started",
      summary: "Started a Sandbox",
      target: { kind: "session", id: where.sessionId },
      detail: viaOf(where.via),
    });

  async function readable(actor: Actor, sessionId: string) {
    if (!(await ports.sessions.readable(actor, sessionId)))
      throw new NotFoundError("That Session is not in this Workspace.");
  }

  return {
    async write(actor, where, rawPath, content) {
      await ports.sessions.writable(actor, where.sessionId);
      requireConfigured();
      if (typeof rawPath !== "string" || typeof content !== "string") {
        throw new InvalidError("Give a path and the file's text.");
      }
      const path = workdirPath(rawPath);
      if (!path) {
        throw new InvalidError(
          "Give a path inside the Sandbox's work directory, like data/schedule.csv.",
        );
      }
      const bytes = Buffer.byteLength(content, "utf8");
      if (bytes > SANDBOX_LIMITS.fileBytes) {
        throw new InvalidError(
          `A file in the Sandbox is at most ${SANDBOX_LIMITS.fileBytes / 1024} KB.`,
        );
      }
      await ports.rate.take("sandbox_command", actor.visitor, {
        owner: actor.owner,
      });
      const { created } = await sandboxes.write(
        where.sessionId,
        actor.owner,
        path,
        content,
      );
      if (created) await started(actor, where);
      // Always recorded: the path and size, never the content.
      await record({
        owner: actor.owner,
        sessionId: where.sessionId,
        actor: { kind: "staff", staff: actor.staff },
        action: "sandbox.file_written",
        summary: `Wrote ${cut(path, 120)}`,
        target: { kind: "session", id: where.sessionId },
        detail: { ...viaOf(where.via), path, bytes },
      });
      return { path, bytes, directory: false, sandboxCreated: created };
    },

    async run(actor, where, raw) {
      await ports.sessions.writable(actor, where.sessionId);
      requireConfigured();
      const command = typeof raw === "string" ? raw : "";
      if (!command.trim()) throw new InvalidError("Give a command to run.");
      if (command.length > MAX_COMMAND_CHARS) {
        throw new InvalidError("That command is too long.");
      }
      const timeoutMs = Math.min(
        SANDBOX_LIMITS.commandSeconds * 1000,
        Math.max(
          MIN_COMMAND_MS,
          Math.trunc(Number(where.timeoutMs ?? DEFAULT_COMMAND_MS)) ||
            DEFAULT_COMMAND_MS,
        ),
      );
      await ports.rate.take("sandbox_command", actor.visitor, {
        owner: actor.owner,
      });
      const staffActor = { kind: "staff", staff: actor.staff } as const;
      const target = { kind: "session", id: where.sessionId };
      // The command stands or falls with its Audit event (ADR 0018):
      // written first, and nothing runs if it cannot be.
      try {
        await ports.audit.strict({
          owner: actor.owner,
          sessionId: where.sessionId,
          actor: staffActor,
          action: "sandbox.command",
          summary: `Asked to run: ${cut(oneLine(command), 80)}`,
          target,
          detail: {
            ...viaOf(where.via),
            command: cut(command, COMMAND_AUDIT_CHARS),
            timeoutMs,
          },
        });
      } catch (error) {
        console.error("[harness] sandbox command audit failed", error);
        throw new ConflictError(
          "The command was not run: its Audit event could not be written. Try again.",
        );
      }
      let run: SandboxRunResult;
      try {
        run = await sandboxes.run(
          where.sessionId,
          actor.owner,
          command,
          timeoutMs,
        );
      } catch (error) {
        // The trail already says it was asked; say it did not run (best effort).
        const message = safeMessage(error);
        await record({
          owner: actor.owner,
          sessionId: where.sessionId,
          actor: staffActor,
          action: "sandbox.command_finished",
          summary: `Not run: ${cut(message, 120)}`,
          target,
          detail: { ...viaOf(where.via), error: message },
        });
        throw error;
      }
      if (run.sandboxCreated) await started(actor, where);
      await record({
        owner: actor.owner,
        sessionId: where.sessionId,
        actor: staffActor,
        action: "sandbox.command_finished",
        summary: `Exit ${run.exitCode ?? "none"}: ${cut(oneLine(command), 80)}`,
        target,
        detail: {
          ...viaOf(where.via),
          exitCode: run.exitCode,
          durationMs: run.ms,
          timedOut: run.timedOut,
          truncated: run.truncated,
          outputHead: cut(oneLine(run.stdout || run.stderr), OUTPUT_HEAD_CHARS),
        },
      });
      return run;
    },

    async read(actor, sessionId, rawPath) {
      await readable(actor, sessionId);
      requireConfigured();
      const path = workdirPath(String(rawPath));
      if (!path)
        throw new InvalidError("Give a path inside the work directory.");
      return sandboxes.read(sessionId, path);
    },

    async list(actor, sessionId, rawPath) {
      await readable(actor, sessionId);
      requireConfigured();
      const dir = rawPath?.trim() ? workdirPath(rawPath) : "";
      if (dir === null)
        throw new InvalidError("Give a directory inside the work directory.");
      return sandboxes.list(sessionId, dir);
    },
  };
}
