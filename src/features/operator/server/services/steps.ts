import "server-only";
import { randomUUID } from "node:crypto";
import { actionLabel, type ScreenAction } from "../../domain/actions";
import {
  evaluate,
  type Finding,
  progressOf,
  type Verdict,
} from "../../domain/checks";
import type {
  PendingApproval,
  RunEventInput,
  StopReason,
} from "../../domain/contract";
import { describeChange } from "../../domain/guard";
import { CODE_LIMITS, LIMITS } from "../../domain/limits";
import type { Change, ScreenCode } from "../../legacy/types";
import { skillById } from "../../skills";
import {
  type Counters,
  emptyCounters,
  expectedOf,
  fixtureOf,
  metricsFrom,
  type RunContext,
} from "../context";
import {
  actionOf,
  isToolName,
  type ToolCall,
  type TranscriptItem,
  type TurnResult,
} from "../operator";
import type {
  ApprovalStore,
  CodeRunner,
  FrameStore,
  OperatorModel,
  RunStore,
  ScreenPort,
  TrailStore,
} from "../ports";
import type { Blocked } from "../sandbox/protocol";
import { createTrail } from "./trail";

/*
 * What a Run does, whoever drives (ADR 0025): the workflow's steps for the
 * in-app Operator (`run-steps.ts` → `run-workflow.ts`) and the Runs service
 * for an outside client both call these, so the caps, the Guard, the Trail
 * and the checks at the end are the same. Every Action goes through
 * `performAction`: the Action cap, then the Screen (where the Guard sees
 * every key first), then the Frame and the Trail.
 */

export type StepsPorts = {
  runs: Pick<RunStore, "status" | "update" | "move" | "endIfGoing">;
  trail: TrailStore;
  approvals: Pick<
    ApprovalStore,
    "insert" | "decide" | "get" | "approvedFingerprints" | "expirePending"
  >;
  frames: FrameStore;
  screen: ScreenPort;
  code: CodeRunner;
  operator: OperatorModel;
  now: () => number;
};

export type ActOutcome = {
  /** The Frame that shows the Screen after the Action; null when nothing was done. */
  frame: number | null;
  screen: ScreenCode | null;
  message: string;
  /** What the driver is told. */
  text: string;
  /** Set when the Guard stopped an input of the Action. */
  blocked: Blocked | null;
  /** The Books against the Fixture, when the Action committed something. */
  diff: Change[] | null;
  counters: Counters;
  /** The Run reached its Action cap: nothing was done. */
  capped: boolean;
};

export type CallResult = {
  output: string;
  counters: Counters;
  /** The Frame taken, for a screen call. */
  frame: number | null;
  hint: string | null;
  diff: Change[] | null;
  /** The Guard stopped the Action: the workflow pauses or halts the Turn. */
  outcome: ActOutcome | null;
  /** `finish_run` was called, with this summary. */
  finished?: string;
};

export type Settled = {
  decision: "approved" | "refused" | "expired";
  /** False when the Run ended while it waited: nothing more may be keyed. */
  active: boolean;
};

export type EndOutcome =
  | { status: "completed"; stoppedBy: StopReason; summary?: string }
  | { status: "failed"; error: string };

/** One line that stands in for a picture dropped from the Operator's context. */
export const frameHint = (screen: ScreenCode | null, message: string) =>
  `${screen ?? "unknown Screen"}${message ? `, message line "${message}"` : ""}`;

export interface RunStepsService {
  /** Starts the Screen sandbox and takes Frame 0, the sign-on Screen. */
  begin(
    ctx: RunContext,
  ): Promise<{ counters: Counters; hint: string; startedAt: number }>;
  /** One Turn, with its thought and cost on the Trail. A Run that is over spends nothing more. */
  turn(
    ctx: RunContext,
    transcript: TranscriptItem[],
    number: number,
  ): Promise<TurnResult>;
  /** Runs one tool call of a Turn. */
  runCall(
    ctx: RunContext,
    counters: Counters,
    at: { turn: number; intent: string },
    call: ToolCall,
    keyed: Change[],
  ): Promise<CallResult>;
  /** After a person approved: presses the rest of the Action, from the key the Guard stopped. */
  resumeCall(
    ctx: RunContext,
    counters: Counters,
    at: { turn: number; intent: string },
    call: ToolCall,
    skip: number,
  ): Promise<CallResult>;
  /**
   * Opens an Approval for a guarded Action the Guard stopped: the row, the
   * `pause` event, and the Run goes to `paused`. Null when the Run ended meanwhile.
   */
  openApproval(
    ctx: RunContext,
    counters: Counters,
    outcome: ActOutcome,
    hookToken: string | null,
  ): Promise<{ pending: PendingApproval; counters: Counters } | null>;
  /** The workflow's pause: opens the Approval its hook waits on. */
  pause(
    ctx: RunContext,
    counters: Counters,
    outcome: ActOutcome,
    token: string,
  ): Promise<{
    approvalId: string;
    fingerprint: string;
    counters: Counters;
  } | null>;
  /**
   * Settles a pause. `answer` is the person's decision, or null when the wait
   * ran out (the harness then refuses the Action itself). The Guard is told
   * of an approval here, by the harness, never by the driver.
   */
  settle(
    ctx: RunContext,
    approvalId: string,
    fingerprint: string,
    answer: "approved" | "refused" | null,
  ): Promise<Settled>;
  /** Writes the Run's totals to its row, so the list and a reload show them. */
  saveCounters(ctx: RunContext, counters: Counters): Promise<void>;
  note(ctx: RunContext, text: string): Promise<void>;
  /**
   * Ends a Run: checks the Books (a completed Run only), writes the Findings
   * and the `end` event, closes the row and removes both sandboxes. A Run
   * already ended keeps its status; the sandboxes are removed either way.
   */
  finish(
    ctx: RunContext,
    counters: Counters,
    outcome: EndOutcome,
    startedAt: number,
  ): Promise<{ ended: boolean; verdict: Verdict | null }>;
  /** What the Run has changed in the Books so far, for `run_code`. */
  keyed(ctx: RunContext): Promise<Change[]>;
  /** Removes both of a Run's sandboxes. Best effort. */
  dispose(runId: string): Promise<void>;
}

export function createRunStepsService(ports: StepsPorts): RunStepsService {
  const { runs, approvals, screen } = ports;
  const { emit, emitStrict } = createTrail(ports.trail);

  const dispose = async (runId: string) => {
    await Promise.all([screen.dispose(runId), ports.code.dispose(runId)]);
  };

  async function performAction(
    ctx: RunContext,
    counters: Counters,
    at: { turn: number; intent: string },
    action: ScreenAction | null,
    skip = 0,
  ): Promise<ActOutcome> {
    if (action && counters.actions >= LIMITS.actionsPerRun) {
      return {
        frame: null,
        screen: null,
        message: "",
        text: `Not done: this Run has used its ${LIMITS.actionsPerRun} Actions.`,
        blocked: null,
        diff: null,
        counters,
        capped: true,
      };
    }
    const result = await screen.act(ctx.runId, ctx.secret, { action, skip });
    const n = counters.frames;

    const label = action
      ? actionLabel(action)
      : n === 0
        ? "sign-on Screen"
        : "look";
    const events: RunEventInput[] = [
      {
        type: "frame",
        n,
        turn: at.turn,
        action,
        label,
        intent: at.intent,
        screen: result.screen,
        pointer: result.pointer,
        caret: result.caret,
        changes: result.changes,
        message: result.message,
        ms: result.ms,
      },
    ];
    const blocked = result.blocked;
    if (blocked)
      events.push({
        type: "rule",
        ruleId: blocked.decision.ruleId,
        outcome: blocked.decision.kind === "pause" ? "paused" : "refused",
        reason: blocked.decision.reason,
        label: label === blocked.input ? label : `${label} (${blocked.input})`,
        screen: result.screen,
        frame: n,
      });
    const expected = expectedOf(ctx.taskId);
    if (result.diff && expected)
      events.push({ type: "progress", met: progressOf(expected, result.diff) });
    // The picture and its event go up together; the event names the Frame.
    await Promise.all([
      ports.frames.put(ctx.runId, n, Buffer.from(result.png, "base64")),
      emit(ctx.runId, ...events),
    ]);

    const next: Counters = {
      ...counters,
      frames: n + 1,
      // A resumed Action (after a pause) was already counted.
      actions: counters.actions + (action && skip === 0 ? 1 : 0),
      records: result.records,
      errors: result.errors,
      refusals:
        counters.refusals + (blocked?.decision.kind === "refuse" ? 1 : 0),
    };
    const text = !blocked
      ? action
        ? "Done. The Screen now is in the picture."
        : "The Screen now is in the picture."
      : blocked.decision.kind === "refuse"
        ? `REFUSED by the Rule ${blocked.decision.ruleId}: ${blocked.decision.reason} The input (${blocked.input}) did not reach HARBOURMASTER${blocked.applied > 0 ? `; the ${blocked.applied} input(s) before it in this Action did` : ""}. Do not try to make the same change another way.`
        : `PAUSED by the Rule ${blocked.decision.ruleId}: ${blocked.decision.reason}`;
    return {
      frame: n,
      screen: result.screen,
      message: result.message,
      text,
      blocked,
      diff: result.diff,
      counters: next,
      capped: false,
    };
  }

  const plain = (output: string, counters: Counters): CallResult => ({
    output,
    counters,
    frame: null,
    hint: null,
    diff: null,
    outcome: null,
  });

  const fromAct = (outcome: ActOutcome): CallResult => ({
    output: outcome.text,
    counters: outcome.counters,
    frame: outcome.frame,
    hint:
      outcome.frame === null
        ? null
        : frameHint(outcome.screen, outcome.message),
    diff: outcome.diff,
    outcome: outcome.blocked ? outcome : null,
  });

  async function openApproval(
    ctx: RunContext,
    counters: Counters,
    outcome: ActOutcome,
    hookToken: string | null,
  ) {
    const blocked = outcome.blocked;
    if (!blocked || blocked.decision.kind !== "pause" || outcome.frame === null)
      return null;
    const { decision } = blocked;
    const pending: PendingApproval = {
      approvalId: randomUUID(),
      actionKind: decision.actionKind,
      label: describeChange(decision.change),
      change: decision.change,
      screen: outcome.screen ?? "HMM100",
      key: blocked.input,
      frame: outcome.frame,
      expiresAt: ports.now() + LIMITS.approvalWaitMinutes * 60_000,
    };
    const next = { ...counters, pauses: counters.pauses + 1 };
    await approvals.insert({
      id: pending.approvalId,
      runId: ctx.runId,
      fingerprint: decision.fingerprint,
      pending,
      hookToken,
    });
    if (!(await runs.move(ctx.runId, ["running"], "paused"))) {
      // The Run ended meanwhile: nothing may wait on an Approval nobody can settle.
      await approvals.decide(ctx.runId, pending.approvalId, "expired");
      return null;
    }
    // The sandbox must outlive the wait the harness is about to impose.
    await screen.extend(ctx.runId, (LIMITS.approvalWaitMinutes + 1) * 60_000);
    await runs.update(ctx.runId, { metrics: metricsFrom(next) });
    await emit(ctx.runId, { type: "pause", pending });
    return { pending, counters: next };
  }

  /** Reads the Books and checks them. Null when the Screen sandbox is gone. */
  async function check(
    ctx: RunContext,
  ): Promise<{ verdict: Verdict; findings: Finding[]; errors: number } | null> {
    try {
      const [report, approved] = await Promise.all([
        screen.books(ctx.runId, ctx.secret),
        approvals.approvedFingerprints(ctx.runId),
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

  return {
    async begin(ctx) {
      await runs.update(ctx.runId, { status: "running" });
      await screen.boot({
        runId: ctx.runId,
        fixture: fixtureOf(ctx.taskId),
        rulebook: ctx.rulebook,
        secret: ctx.secret,
      });
      const first = await performAction(
        ctx,
        emptyCounters(),
        { turn: 0, intent: "HARBOURMASTER is up: the sign-on Screen." },
        null,
      );
      return {
        counters: first.counters,
        hint: frameHint(first.screen, first.message),
        startedAt: ports.now(),
      };
    },

    async turn(ctx, transcript, number) {
      if ((await runs.status(ctx.runId)) !== "running") return { kind: "over" };
      const result = await ports.operator.turn(ctx, transcript, number);
      const events: RunEventInput[] = [];
      if (result.text)
        events.push({ type: "thought", turn: number + 1, text: result.text });
      if (result.usage)
        events.push({ type: "cost", turn: number + 1, ...result.usage });
      if (events.length > 0) await emit(ctx.runId, ...events);
      return result;
    },

    async runCall(ctx, counters, at, call, keyed) {
      const input = (call.input ?? {}) as Record<string, unknown>;
      if (!isToolName(call.toolName))
        return plain(`Unknown tool ${call.toolName}.`, counters);
      if (typeof input.__invalid === "string")
        return plain(`Not done: invalid input (${input.__invalid}).`, counters);

      switch (call.toolName) {
        case "finish_run":
          return {
            ...plain("Finished. The harness now checks the Books.", counters),
            finished: typeof input.summary === "string" ? input.summary : "",
          };
        case "update_plan": {
          const items = Array.isArray(input.items)
            ? (input.items as { text?: unknown; done?: unknown }[])
                .slice(0, 20)
                .map((item) => ({
                  text: String(item.text ?? "").slice(0, 140),
                  done: item.done === true,
                }))
            : [];
          await emit(ctx.runId, { type: "plan", items });
          return plain("Plan updated.", counters);
        }
        case "load_skill": {
          const skill = skillById(String(input.id ?? ""));
          if (!skill) return plain("No such Skill.", counters);
          await emit(ctx.runId, {
            type: "skill",
            id: skill.id,
            title: skill.title,
          });
          return plain(skill.body(ctx.rulebook), counters);
        }
        case "run_code": {
          if (counters.codeRuns >= LIMITS.codeRunsPerRun)
            return plain(
              `Not run: this Run has used its ${LIMITS.codeRunsPerRun} code runs.`,
              counters,
            );
          const code = String(input.code ?? "").slice(0, CODE_LIMITS.codeChars);
          if (!code.trim()) return plain("Not run: no code.", counters);
          const pending = {
            type: "code" as const,
            callId: call.toolCallId,
            code,
            exitCode: -1,
            stdout: "",
            stderr: "",
            ms: 0,
          };
          // The Trail first: code the driver wrote never runs untraced.
          await emitStrict(ctx.runId, pending);
          const result = await ports.code.run({
            ctx,
            callId: call.toolCallId,
            code,
            keyed,
          });
          await emit(ctx.runId, { ...pending, ...result });
          return plain(
            `exit ${result.exitCode}\n--- stdout ---\n${result.stdout || "(empty)"}${result.stderr ? `\n--- stderr ---\n${result.stderr}` : ""}`,
            { ...counters, codeRuns: counters.codeRuns + 1 },
          );
        }
        default: {
          const wanted = actionOf(call.toolName, input);
          if ("error" in wanted) return plain(wanted.error, counters);
          return fromAct(await performAction(ctx, counters, at, wanted.action));
        }
      }
    },

    async resumeCall(ctx, counters, at, call, skip) {
      const wanted = actionOf(call.toolName, call.input);
      if ("error" in wanted) return plain(wanted.error, counters);
      return fromAct(
        await performAction(ctx, counters, at, wanted.action, skip),
      );
    },

    openApproval,

    async pause(ctx, counters, outcome, token) {
      const opened = await openApproval(ctx, counters, outcome, token);
      if (!opened || outcome.blocked?.decision.kind !== "pause") return null;
      return {
        approvalId: opened.pending.approvalId,
        fingerprint: outcome.blocked.decision.fingerprint,
        counters: opened.counters,
      };
    },

    async settle(ctx, approvalId, fingerprint, answer) {
      let decision: Settled["decision"];
      if (answer) {
        decision = answer;
      } else if (await approvals.decide(ctx.runId, approvalId, "expired")) {
        decision = "expired";
      } else {
        // Decided in the same moment the wait ran out: the person's decision stands.
        const row = await approvals.get(ctx.runId, approvalId);
        decision =
          row?.status === "approved"
            ? "approved"
            : row?.status === "refused"
              ? "refused"
              : "expired";
      }
      // A Run that ended while it waited must not key anything (conventions.md).
      const active = await runs.move(ctx.runId, ["paused"], "running");
      await emit(ctx.runId, { type: "decision", approvalId, decision });
      if (active) {
        if (decision === "approved")
          await screen.approve(ctx.runId, ctx.secret, fingerprint);
        else await screen.touch(ctx.runId, ctx.secret);
      }
      return { decision, active };
    },

    async saveCounters(ctx, counters) {
      await runs.update(ctx.runId, {
        metrics: metricsFrom(counters),
        cost_usd: Number(counters.costUsd.toFixed(6)),
      });
    },

    async note(ctx, text) {
      await emit(ctx.runId, { type: "log", level: "warn", text });
    },

    async finish(ctx, counters, outcome, startedAt) {
      const checked = outcome.status === "completed" ? await check(ctx) : null;
      const final: Counters = {
        ...counters,
        errors: checked?.errors ?? counters.errors,
        ms: Math.max(0, ports.now() - startedAt),
      };
      // Completed but unreadable: the work may be right, but nothing can say so.
      const failed =
        outcome.status === "failed"
          ? outcome.error
          : checked === null
            ? "The Screen sandbox was gone before the Books could be checked."
            : null;
      const summary =
        outcome.status === "completed" && outcome.summary
          ? outcome.summary.slice(0, 2000)
          : null;
      const ended = await runs.endIfGoing(ctx.runId, {
        status: failed ? "failed" : "completed",
        metrics: metricsFrom(final),
        cost_usd: Number(final.costUsd.toFixed(6)),
        ...(failed ? { error: failed } : {}),
        ...(outcome.status === "completed"
          ? { stopped_by: outcome.stoppedBy, ...(summary ? { summary } : {}) }
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
                      ...(summary ? { summary } : {}),
                    }
                  : {}),
              },
        );
        await emit(ctx.runId, ...events);
      }
      await approvals.expirePending(ctx.runId).catch(() => {});
      await dispose(ctx.runId);
      return { ended, verdict: checked?.verdict ?? null };
    },

    async keyed(ctx) {
      return (await screen.books(ctx.runId, ctx.secret)).diff;
    },

    dispose,
  };
}
