import "server-only";
import { evaluate, type Finding, type Verdict } from "../domain/checks";
import type { RunEventInput, StopReason } from "../domain/contract";
import { disposeCode } from "./code-sandbox";
import { type Counters, expectedOf, metricsFrom, type RunContext } from "./context";
import { emit } from "./emit";
import {
  approvedFingerprints,
  endRunIfGoing,
  expirePending,
} from "./repository";
import { disposeScreen, screenBooks } from "./screen";

/*
 * How a Run ends, whoever drove it. Code reads HARBOURMASTER's Books out of
 * the Screen sandbox, compares them with the Task and the Rules, and writes
 * the Findings and the Verdict (ADR 0025). The driver's own summary is kept
 * as a note and decides nothing.
 */

export type EndOutcome =
  | { status: "completed"; stoppedBy: StopReason; summary?: string }
  | { status: "failed"; error: string };

/** Reads the Books and checks them. Null when the Screen sandbox is gone. */
async function check(
  ctx: RunContext,
): Promise<{ verdict: Verdict; findings: Finding[]; errors: number } | null> {
  try {
    const [report, approved] = await Promise.all([
      screenBooks(ctx.runId, ctx.secret),
      approvedFingerprints(ctx.runId),
    ]);
    return {
      ...evaluate({
        rulebook: ctx.rulebook,
        expected: expectedOf(ctx.taskId),
        manifest: ctx.manifest
          ? { voyage: ctx.manifest.voyage, lines: ctx.manifest.lines }
          : null,
        changes: report.diff,
        after: report.books,
        signedOn: report.signedOn,
        screens: report.screens,
        approved,
        byHand: false,
      }),
      errors: report.errors,
    };
  } catch (error) {
    console.error("[operator] the Books could not be read at the end", error);
    return null;
  }
}

/**
 * Ends a Run: checks the Books (a completed Run only), writes the Findings
 * and the `end` event, closes the row and removes both sandboxes. A Run
 * already ended (stopped by its Owner) keeps its status; the sandboxes are
 * removed either way.
 */
export async function finishRun(
  ctx: RunContext,
  counters: Counters,
  outcome: EndOutcome,
  startedAt: number,
) {
  const checked = outcome.status === "completed" ? await check(ctx) : null;
  const final: Counters = {
    ...counters,
    errors: checked?.errors ?? counters.errors,
    ms: Math.max(0, Date.now() - startedAt),
  };
  // Completed but unreadable: the work may be right, but nothing can say so.
  const failed =
    outcome.status === "failed"
      ? outcome.error
      : checked === null
        ? "The Screen sandbox was gone before the Books could be checked."
        : null;
  const ended = await endRunIfGoing(ctx.runId, {
    status: failed ? "failed" : "completed",
    metrics: metricsFrom(final),
    cost_usd: Number(final.costUsd.toFixed(6)),
    ...(failed ? { error: failed } : {}),
    ...(outcome.status === "completed"
      ? {
          stopped_by: outcome.stoppedBy,
          ...(outcome.summary ? { summary: outcome.summary.slice(0, 2000) } : {}),
        }
      : {}),
    ...(checked && !failed
      ? { verdict: checked.verdict, findings: checked.findings }
      : {}),
  });
  if (ended) {
    const events: RunEventInput[] = [];
    if (checked && !failed)
      events.push({
        type: "findings",
        verdict: checked.verdict,
        findings: checked.findings,
      });
    events.push(
      failed
        ? { type: "end", status: "failed", error: failed }
        : {
            type: "end",
            status: "completed",
            ...(outcome.status === "completed"
              ? {
                  stoppedBy: outcome.stoppedBy,
                  ...(outcome.summary
                    ? { summary: outcome.summary.slice(0, 2000) }
                    : {}),
                }
              : {}),
          },
    );
    await emit(ctx.runId, ...events);
  }
  await expirePending(ctx.runId).catch(() => {});
  await Promise.all([disposeScreen(ctx.runId), disposeCode(ctx.runId)]);
  return { ended, verdict: checked?.verdict ?? null };
}
