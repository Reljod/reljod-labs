import "server-only";
import { createGateway, Output, streamText } from "ai";
import type { StoredBuild } from "../domain/build-events";
import { buildPlanSchema, type RawBuildPlan } from "../domain/build-plan";
import { describeContentTree } from "../domain/content-tree";
import { env } from "./env";
import { stubPlan } from "./stub-plans";

type DeepPartial<T> = T extends object
  ? { [K in keyof T]?: DeepPartial<T[K]> }
  : T;
export type PartialPlan = DeepPartial<RawBuildPlan>;

export type PlanStream = {
  /** The plan as it grows: each value replaces the last. */
  partials: AsyncIterable<PartialPlan>;
  plan: PromiseLike<RawBuildPlan>;
  model: string;
};

const INSTRUCTIONS = `You are Ledger, a ginger tabby cat banker in a navy suit who runs the front desk of Reljod Oreta's website. A visitor asks a question. You answer by rebuilding the site: you run to pieces of the page, cut out the ones that answer the question, carry them to your Build board in the order they should be read, and Reform them into one answer page.

You decide what Ledger does. The browser decides where things are on screen, so never mention positions.

Rules:
- Use only the content tree. Every source is a path copied exactly from it. Never invent facts, numbers, names or words.
- Cut the smallest piece that answers: an excerpt of one sentence for a single figure, a whole job for "where has he worked".
- excerpt: only for sources marked (excerptable), copied character for character from that source's text; otherwise null.
- Steps: 2 to 8 fetch steps, ordered as the answer should be read. You may add up to 2 toss steps before the fetch they are confused with, when a nearby piece looks right but is not: Ledger picks it up, thinks better of it and throws it away. Do not toss for every answer.
- pace: dash for the key piece, trot by default, stroll for supporting pieces.
- line: what Ledger says on that step, at most 8 words, playful and precise, like a cat who loves bookkeeping.
- layout: timeline for jobs over time, figures for numbers, cards for projects or services, steps for the approach, mixed for a headline figure followed by supporting pieces.
- title: the answer page heading, at most 8 words.
- answer: 2 or 3 plain sentences about Reljod in the third person, only facts from the pieces you fetch.
- If the question is not about Reljod, his work, services, projects, experience, approach or how to contact him: verdict not_found, title "Not on my ledger", steps [], and a one-sentence answer saying you only keep books on Reljod's work.

Content tree (path | section | kind | text):
${describeContentTree()}`;

function describeHistory(history: StoredBuild[]) {
  if (history.length === 0) return "";
  const turns = history.map(
    (build) =>
      `Q: ${build.question}\nA: ${build.plan.answer}\nSources: ${build.plan.steps.map((step) => step.source).join(", ") || "none"}`,
  );
  return `Earlier in this session:\n${turns.join("\n\n")}\n\n`;
}

/** Streams a Build plan from the model, or from a canned plan in stubbed e2e runs. */
export function streamPlan(input: {
  question: string;
  history: StoredBuild[];
  stubbed: boolean;
}): PlanStream {
  if (input.stubbed) return streamStub(stubPlan(input.question));

  const gateway = createGateway({ apiKey: env.aiGatewayApiKey() });
  const result = streamText({
    model: gateway(env.model()),
    instructions: INSTRUCTIONS,
    output: Output.object({ schema: buildPlanSchema }),
    reasoning: "low",
    messages: [
      {
        role: "user",
        content: `${describeHistory(input.history)}Visitor's question: ${input.question}`,
      },
    ],
  });
  return {
    partials: result.partialOutputStream,
    plan: result.output,
    model: env.model(),
  };
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Grows a canned plan the way the model would: frame, answer in chunks, then each step. */
function streamStub(plan: RawBuildPlan): PlanStream {
  async function* partials(): AsyncIterable<PartialPlan> {
    const frame = {
      verdict: plan.verdict,
      title: plan.title,
      layout: plan.layout,
    };
    yield frame;
    const words = plan.answer.split(" ");
    for (let count = 4; count < words.length + 4; count += 4) {
      await pause(60);
      yield { ...frame, answer: words.slice(0, count).join(" ") };
    }
    for (let count = 1; count <= plan.steps.length; count++) {
      await pause(150);
      // Like the model's stream: the last step may still be half-written.
      yield {
        ...frame,
        answer: plan.answer,
        steps: [
          ...plan.steps.slice(0, count),
          { action: plan.steps[count]?.action },
        ],
      };
    }
  }
  return { partials: partials(), plan: Promise.resolve(plan), model: "stub" };
}
