import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import { InvalidError, NotFoundError } from "@/platform/errors";
import type { StartAskResult } from "../domain/api";
import type { AskSessionView, BuildEvent } from "../domain/build-events";
import {
  type BuildPlan,
  createStepValidator,
  LAYOUTS,
  type Layout,
  type PlanStep,
  planStepSchema,
} from "../domain/build-plan";
import { type LimitHit, limitMessage } from "../domain/limits";
import type { Caller, LedgerPorts } from "./ports";

/** How many earlier Builds of the session the planner is told about. */
const HISTORY = 4;

/** e2e only: what the suite asks for to see the limited path without spending the cap. */
export type Ask = { forceLimit?: boolean };

/**
 * Everything Ledger does. The REST routes and the pages are thin adapters
 * over it. Every Build takes its rate hit before the planner is asked, and
 * every read is scoped to the caller's Owner.
 */
export interface LedgerService {
  /** Opens an Ask session for a question; over the cap, points at the Owner's latest answer instead. */
  start(caller: Caller, question: string, ask?: Ask): Promise<StartAskResult>;
  /** The Owner's Ask session; another Owner's answers as missing. */
  session(owner: Owner, id: string): Promise<AskSessionView>;
  /**
   * Plans the session's next Build. Resolves once the question and the
   * session are checked; the rate hit is already being taken, and the
   * stream reads it before the planner is asked.
   */
  build(
    caller: Caller,
    sessionId: string,
    question: string,
    ask?: Ask,
  ): Promise<AsyncGenerator<BuildEvent>>;
}

const isComplete = (step: unknown): step is PlanStep =>
  planStepSchema.safeParse(step).success;

export function createLedgerService(ports: LedgerPorts): LedgerService {
  const { sessions, rate, planner } = ports;

  const limited = (caller: Caller, ask: Ask, take: boolean) =>
    ask.forceLimit
      ? Promise.resolve<LimitHit | null>("visitor")
      : take
        ? rate.take(caller.visitor)
        : rate.peek(caller.visitor);

  /**
   * The frame, the chat answer as it grows, and each step once the planner
   * has finished writing it and it passed validation; the plan is stored at
   * the end.
   */
  async function* stream(
    caller: Caller,
    session: AskSessionView,
    question: string,
    limit: Promise<LimitHit | null>,
  ): AsyncGenerator<BuildEvent> {
    try {
      const hit = await limit;
      if (hit) {
        yield {
          type: "limited",
          message: limitMessage(hit) ?? "",
          sessionId: await sessions.latestAnswered(caller.owner),
        };
        return;
      }

      const planned = planner.plan({
        question,
        history: session.builds.slice(-HISTORY),
      });
      const validate = createStepValidator();
      const steps: PlanStep[] = [];
      const out: BuildEvent[] = [];
      let examined = 0;
      let answerSent = "";
      let framed = false;
      let answering = true;

      const frame = (title?: string, layout?: string) => {
        if (framed) return;
        framed = true;
        out.push({
          type: "frame",
          title: title ?? "",
          layout: LAYOUTS.includes(layout as Layout)
            ? (layout as Layout)
            : "mixed",
        });
      };
      const examine = (candidates: unknown[]) => {
        for (; examined < candidates.length; examined++) {
          const candidate = candidates[examined];
          if (!isComplete(candidate)) continue;
          const step = validate(candidate);
          if (step) {
            steps.push(step);
            out.push({ type: "step", step });
          }
        }
      };
      const answer = (text: string) => {
        if (text.length > answerSent.length && text.startsWith(answerSent)) {
          out.push({ type: "answer", delta: text.slice(answerSent.length) });
          answerSent = text;
        }
      };

      for await (const partial of planned.partials) {
        if (partial.verdict === "not_found") answering = false;
        if (partial.answer !== undefined || partial.steps !== undefined)
          frame(partial.title, partial.layout);
        answer(partial.answer ?? "");
        // The last item may still be streaming; every earlier one is final.
        if (answering) examine((partial.steps ?? []).slice(0, -1));
        yield* out.splice(0);
      }

      const raw = await planned.plan;
      frame(raw.title, raw.layout);
      answer(raw.answer);
      if (raw.verdict === "answer") examine(raw.steps);
      yield* out.splice(0);

      const fetches = steps.some((step) => step.action === "fetch");
      const plan: BuildPlan = {
        verdict: fetches ? "answer" : "not_found",
        title: raw.title,
        layout: raw.layout,
        answer: raw.answer,
        steps: fetches ? steps : [],
      };
      const build = await sessions.insertBuild({
        askSessionId: session.id,
        question,
        plan,
        model: planned.model,
        visitorHash: caller.visitor.hash,
      });
      yield { type: "done", build };
    } catch (error) {
      console.error("Ledger Build failed", error);
      yield {
        type: "error",
        message: "Ledger tripped over his tail. Please try again.",
      };
    }
  }

  return {
    async start(caller, input, ask = {}) {
      if (!input) return { status: "empty" };
      const hit = await limited(caller, ask, false);
      if (hit)
        return {
          status: "limited",
          sessionId: await sessions.latestAnswered(caller.owner),
          message: limitMessage(hit) ?? "",
        };
      return {
        status: "started",
        sessionId: await sessions.create({
          owner: caller.owner,
          visitorHash: caller.visitor.hash,
        }),
      };
    },

    async session(owner, id) {
      const session = await sessions.load(id, owner);
      if (!session) throw new NotFoundError();
      return session;
    },

    async build(caller, sessionId, question, ask = {}) {
      if (!question) throw new InvalidError("Ask a question");
      // The hit is taken while the session loads, before any model call; a
      // dropped stream or parallel posts still count. The stream reads it first.
      const limit = limited(caller, ask, true);
      limit.catch(() => {}); // Read (and reported) by the stream; unread on a 404.
      const session = await sessions.load(sessionId, caller.owner);
      // Another Owner's session is answered as if it did not exist.
      if (!session) throw new NotFoundError();
      return stream(caller, session, question, limit);
    },
  };
}
