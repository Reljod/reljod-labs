import "server-only";
import type { ModelMessage } from "ai";
import type { AnalystModel, CodeSandbox, ReaderModel, ToolCall } from "./ports";
import { readerNames, squash } from "./toolkit/register";
import { RUN_LIMITS } from "./toolkit/state";

/*
 * The paid adapters of the stubbed e2e suite (an e2e request without
 * `x-e2e-live: 1`, and the Runs it starts). Nothing calls a model or starts
 * a Sandbox; the workflow, the Done gate, the caps, the Register's checks
 * and the database are the real ones, so a stubbed Run ends the way a real
 * one does: through `finish` once the gate passes.
 */

/** Pages each scripted Reader takes. */
const READER_PAGES = 20;

function reply(text: string, toolCalls: ToolCall[]) {
  const message: ModelMessage = {
    role: "assistant",
    content: [
      { type: "text", text },
      ...toolCalls.map((call) => ({
        type: "tool-call" as const,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        input: call.input,
      })),
    ],
  };
  return { text, toolCalls, responseMessages: [message], cost: null };
}

/**
 * The scripted Analyst. Its first turn spawns Readers over every page; its
 * second dismisses whatever Sweep Candidate the Readers did not record and
 * calls `finish`, which the gate then lets through. If the gate still
 * refuses (a Reader range the harness cut), it stops calling tools and the
 * harness winds the Run up as idle, as it would a real Analyst.
 */
export const scriptedAnalyst: AnalystModel = {
  async turn({ ctx, messages, prepared }) {
    const turn = messages.filter(
      (message) => message.role === "assistant",
    ).length;
    if (turn === 0) {
      const ranges: { from: number; to: number }[] = [];
      for (let from = 1; from <= ctx.pages; from += READER_PAGES)
        ranges.push({ from, to: Math.min(ctx.pages, from + READER_PAGES - 1) });
      return reply("Scripted Analyst (stubbed): Readers over every page.", [
        {
          toolCallId: "stub-1-readers",
          toolName: "spawn_readers",
          input: { ranges: ranges.slice(0, RUN_LIMITS.readersPerCall) },
        },
      ]);
    }
    if (turn === 1) {
      const { candidates } = await prepared();
      const ids = candidates.map((candidate) => candidate.id).slice(0, 2000);
      return reply("Scripted Analyst (stubbed): closing the Sweep.", [
        ...(ids.length
          ? [
              {
                toolCallId: "stub-2-record",
                toolName: "record_names",
                input: {
                  dismiss: [
                    { ids, reason: "Scripted e2e Analyst: not reviewed." },
                  ],
                },
              },
            ]
          : []),
        {
          toolCallId: "stub-2-finish",
          toolName: "finish",
          input: {
            summary:
              "Scripted e2e Run: Readers covered every page; the Sweep's leftovers were dismissed unreviewed.",
          },
        },
      ]);
    }
    return reply("Scripted Analyst (stubbed): nothing more to do.", []);
  },
};

/**
 * A scripted Reader: every Sweep Candidate seen on its pages, quoted where
 * it is verbatim. The quotes go through the same check a model's do.
 */
export const scriptedReader: ReaderModel = {
  async read({ pages, candidates, job }) {
    const range = { from: job.from, to: job.to };
    const names = candidates
      .map((candidate) => ({
        name: candidate.text,
        type:
          candidate.typeGuess === "unknown"
            ? ("person" as const)
            : candidate.typeGuess,
        role: "other" as const,
        confidence: 0.9,
        quotes: candidate.pages
          .filter(
            (page) =>
              page >= range.from &&
              page <= range.to &&
              squash(pages[page - 1] ?? "").includes(squash(candidate.text)),
          )
          .slice(0, 200)
          .map((page) => ({ page, quote: candidate.text })),
      }))
      .filter((entry) => entry.quotes.length > 0);
    const verified = readerNames(pages, { names }, range);
    return { ...job, ...verified, cost: null, ms: 0 };
  },
};

/** The stubbed suite has no Sandbox: `run_code` answers that the code was not run. */
export const noSandbox: CodeSandbox = {
  async run() {
    return {
      stdout: "",
      stderr: "The stubbed e2e suite has no Sandbox; the code was not run.",
      exitCode: 1,
      ms: 0,
    };
  },
  async dispose() {},
};
