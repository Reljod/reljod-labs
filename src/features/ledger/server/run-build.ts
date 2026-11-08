import "server-only";
import {
  type AskSessionView,
  type BuildEvent,
  encodeEvent,
} from "../domain/build-events";
import {
  type BuildPlan,
  createStepValidator,
  LAYOUTS,
  type Layout,
  type PlanStep,
  planStepSchema,
} from "../domain/build-plan";
import { streamPlan } from "./planner";
import { rateLimitMessage } from "./rate-limit";
import { insertBuild, latestAnsweredSessionId } from "./repository";
import type { Visitor } from "./visitor";

const HISTORY = 4;

const isComplete = (step: unknown): step is PlanStep =>
  planStepSchema.safeParse(step).success;

/**
 * Plans one Build and streams it as newline-delimited JSON: the frame, the
 * chat answer as it grows, and each step once the model has finished writing
 * it and it passed validation. Stores the plan at the end.
 */
export function runBuild(input: {
  session: AskSessionView;
  question: string;
  visitor: Visitor;
}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      const send = (event: BuildEvent) =>
        controller.enqueue(encoder.encode(encodeEvent(event)));
      try {
        const limit = await rateLimitMessage(input.visitor);
        if (limit) {
          send({
            type: "limited",
            message: limit,
            sessionId: await latestAnsweredSessionId(),
          });
          return;
        }

        const stream = streamPlan({
          question: input.question,
          history: input.session.builds.slice(-HISTORY),
          stubbed: input.visitor.stubbed,
        });
        const validate = createStepValidator();
        const steps: PlanStep[] = [];
        let examined = 0;
        let answerSent = "";
        let framed = false;
        let answering = true;

        const frame = (title?: string, layout?: string) => {
          if (framed) return;
          framed = true;
          send({
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
              send({ type: "step", step });
            }
          }
        };

        for await (const partial of stream.partials) {
          if (partial.verdict === "not_found") answering = false;
          if (partial.answer !== undefined || partial.steps !== undefined) {
            frame(partial.title, partial.layout);
          }
          const answer = partial.answer ?? "";
          if (
            answer.length > answerSent.length &&
            answer.startsWith(answerSent)
          ) {
            send({ type: "answer", delta: answer.slice(answerSent.length) });
            answerSent = answer;
          }
          // The last item may still be streaming; every earlier one is final.
          if (answering) examine((partial.steps ?? []).slice(0, -1));
        }

        const raw = await stream.plan;
        frame(raw.title, raw.layout);
        if (
          raw.answer.length > answerSent.length &&
          raw.answer.startsWith(answerSent)
        ) {
          send({ type: "answer", delta: raw.answer.slice(answerSent.length) });
        }
        if (raw.verdict === "answer") examine(raw.steps);

        const fetches = steps.some((step) => step.action === "fetch");
        const plan: BuildPlan = {
          verdict: fetches ? "answer" : "not_found",
          title: raw.title,
          layout: raw.layout,
          answer: raw.answer,
          steps: fetches ? steps : [],
        };
        const build = await insertBuild({
          askSessionId: input.session.id,
          question: input.question,
          plan,
          model: stream.model,
          visitorHash: input.visitor.hash,
        });
        send({ type: "done", build });
      } catch (error) {
        console.error("Ledger Build failed", error);
        send({
          type: "error",
          message: "Ledger tripped over his tail. Please try again.",
        });
      } finally {
        controller.close();
      }
    },
  });
}
