import "server-only";
import { randomUUID } from "node:crypto";
import { type ToolSet, tool } from "ai";
import { z } from "zod";
import type { Owner } from "@/features/access/domain/owner";
import { SANDBOX_LIMITS, SANDBOX_WORKDIR } from "../../domain/sandbox";
import { audit, auditStrict } from "../audit";
import { StateError } from "../errors";
import { execIn, type Opened, openSandbox, removeSandbox } from "../sandbox";

/*
 * Code for a model Step (ADR 0022). A Step that reads papers may write and
 * run JavaScript to count, total or compare what they say, in a Sandbox of
 * its own: made on its first `run_code` with the papers on disk, removed when
 * the call ends. What the code prints is the model's reading aid, never a
 * Finding: only the Pipeline's checks return those (ADR 0015).
 */

/** Who the code runs for: the Run and the Step, for the Audit trail. */
export type StepScope = {
  owner: Owner;
  runId: string;
  sessionId: string | null;
  stepId: string;
};

export type StepPaper = { title: string; text: string };

/** Where the papers are, as the model is told. */
export const PAPERS_DIR = "papers";

/** The papers as files: `papers/1.txt`, …, and `papers/index.json` with their titles. */
export function paperFiles(papers: StepPaper[]) {
  return [
    ...papers.map((paper, index) => ({
      path: `${SANDBOX_WORKDIR}/${PAPERS_DIR}/${index + 1}.txt`,
      content: paper.text,
    })),
    {
      path: `${SANDBOX_WORKDIR}/${PAPERS_DIR}/index.json`,
      content: JSON.stringify(
        papers.map((paper, index) => ({
          file: `${PAPERS_DIR}/${index + 1}.txt`,
          title: paper.title,
        })),
        null,
        2,
      ),
    },
  ];
}

/** What the model reads back from one `run_code`; short, so a Step's tokens stay bounded. */
const RESULT_CHARS = 6_000;
const AUDIT_CODE_CHARS = 200;

export const RUN_CODE_TOOL = "run_code";

export const RUN_CODE_HINT = `You can code: when the papers need counting, totalling, comparing or checking a format, call ${RUN_CODE_TOOL} with a Node.js script (ES module) instead of working it out in your head. The papers are in ./${PAPERS_DIR}/ (index.json lists them). There is no network and at most ${SANDBOX_LIMITS.stepCodeCalls} runs; print what you need with console.log. Code helps you read; it decides nothing.`;

const cut = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}…` : text;

function resultText(run: {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}): string {
  const parts = [`exit ${run.exitCode ?? "none"}`];
  if (run.stdout) parts.push(`stdout:\n${run.stdout}`);
  if (run.stderr) parts.push(`stderr:\n${run.stderr}`);
  return cut(parts.join("\n"), RESULT_CHARS);
}

/**
 * The `run_code` tool for one model call, and `dispose` to remove its
 * Sandbox: call it in a `finally`. Never throws to the model: a refusal or a
 * failure comes back as text it can read.
 */
export function stepCode(scope: StepScope, papers: StepPaper[]) {
  const name = `harness-step-${randomUUID()}`;
  let opened: Promise<Opened> | null = null;
  let calls = 0;

  const tools = {
    [RUN_CODE_TOOL]: tool({
      description: `Runs a Node.js script (ES module) in a Sandbox with no network and returns its exit code and output. The papers are in ./${PAPERS_DIR}/. At most ${SANDBOX_LIMITS.stepCodeCalls} calls.`,
      inputSchema: z.object({
        code: z.string().min(1).max(20_000).describe("The script to run."),
      }),
      execute: async ({ code }) => {
        if (calls >= SANDBOX_LIMITS.stepCodeCalls)
          return `No more runs: this Step may run code ${SANDBOX_LIMITS.stepCodeCalls} times. Answer from what you have.`;
        calls += 1;
        const call = calls;
        const base = {
          owner: scope.owner,
          runId: scope.runId,
          sessionId: scope.sessionId,
          actor: { kind: "agent" } as const,
          target: { kind: "run", id: scope.runId },
        };
        // The code stands or falls with its Audit event (ADR 0018).
        try {
          await auditStrict({
            ...base,
            action: "sandbox.command",
            summary: `${scope.stepId} asked to run code (${code.length} characters)`,
            detail: {
              step: scope.stepId,
              call,
              code: cut(code, AUDIT_CODE_CHARS),
            },
          });
        } catch (error) {
          console.error("[harness] step code audit failed", error);
          return "The code was not run: its Audit event could not be written. Answer without it.";
        }
        try {
          opened ??= openSandbox(name, {
            persistent: false,
            onCreate: async (made) => {
              await made.writeFiles(paperFiles(papers));
            },
          });
          const { sandbox } = await opened;
          const file = `step-${call}.mjs`;
          await sandbox.writeFiles([
            { path: `${SANDBOX_WORKDIR}/${file}`, content: code },
          ]);
          const run = await execIn(
            sandbox,
            `node ${file}`,
            SANDBOX_LIMITS.commandSeconds * 1000,
          );
          await audit({
            ...base,
            action: "sandbox.command_finished",
            summary: `${scope.stepId} code exit ${run.exitCode ?? "none"}`,
            detail: {
              step: scope.stepId,
              call,
              exitCode: run.exitCode,
              durationMs: run.ms,
              timedOut: run.timedOut,
              truncated: run.truncated,
            },
          }).catch((error) =>
            console.error("[harness] step code audit failed", error),
          );
          return resultText(run);
        } catch (error) {
          const why =
            error instanceof StateError ? error.message : "The Sandbox failed.";
          if (!(error instanceof StateError))
            console.error("[harness] step code failed", error);
          await audit({
            ...base,
            action: "sandbox.command_finished",
            summary: `${scope.stepId} code not run`,
            detail: { step: scope.stepId, call, error: cut(why, 200) },
          }).catch(() => {});
          return `The code could not be run (${why}). Answer without it.`;
        }
      },
    }),
  } satisfies ToolSet;

  return {
    tools,
    /** Removes the Sandbox, if `run_code` made one. Never throws. */
    dispose: async () => {
      if (!opened) return;
      await opened.catch(() => null);
      await removeSandbox(name);
    },
  };
}
