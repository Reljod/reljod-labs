import { z } from "zod";
import {
  type ContentBlock,
  type ContentTree,
  contentTree,
  type SourceNode,
} from "./content-tree";

export const LAYOUTS = [
  "timeline",
  "figures",
  "cards",
  "steps",
  "mixed",
] as const;
export const PACES = ["stroll", "trot", "dash"] as const;
export const MAX_STEPS = 14;
export const MAX_TOSSES = 2;
const MAX_LINE = 60;
const MIN_EXCERPT = 8;

export type Layout = (typeof LAYOUTS)[number];
export type Pace = (typeof PACES)[number];

/*
 * The shape the model writes. Lengths and counts are described, not enforced,
 * so one long line never fails the whole answer: validation trims instead.
 * Field order matters: the answer streams before the steps it explains.
 */
export const planStepSchema = z.object({
  action: z
    .enum(["fetch", "toss"])
    .describe(
      "fetch: cut this piece and place it on the Build board. toss: pick it up, decide it does not answer the question, and throw it away.",
    ),
  source: z
    .string()
    .describe("A source path copied exactly from the content tree."),
  excerpt: z
    .string()
    .nullable()
    .describe(
      "For an excerptable source only: the exact words to cut, copied character for character. null takes the whole piece.",
    ),
  pace: z.enum(PACES).describe("How fast Ledger runs to this piece."),
  line: z
    .string()
    .describe("What Ledger says on this step, at most 8 words, in character."),
});

export const buildPlanSchema = z.object({
  verdict: z
    .enum(["answer", "not_found"])
    .describe("not_found when nothing on the site answers the question."),
  title: z.string().describe("The answer page title, at most 8 words."),
  layout: z.enum(LAYOUTS),
  answer: z
    .string()
    .describe(
      "Two or three sentences for the chat, using only the site's facts.",
    ),
  steps: z.array(planStepSchema),
});

export type PlanStep = z.infer<typeof planStepSchema>;
export type RawBuildPlan = z.infer<typeof buildPlanSchema>;

/** A Build plan that only names real sources and real words. */
export type BuildPlan = {
  verdict: "answer" | "not_found";
  title: string;
  layout: Layout;
  answer: string;
  steps: PlanStep[];
};

/* Curly quotes and dashes swap one character for one, so indexes still line up. */
const fold = (text: string) =>
  text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-");

/**
 * Finds `excerpt` inside `text` and returns the site's own words for it, or
 * null when the model changed anything beyond quotes, dashes and spacing.
 */
export function matchExcerpt(text: string, excerpt: string): string | null {
  const wanted = fold(excerpt.replace(/\s+/g, " ").trim()).replace(
    /[.,;:]+$/,
    "",
  );
  if (wanted.length < MIN_EXCERPT) return null;
  const at = fold(text).indexOf(wanted);
  return at === -1 ? null : text.slice(at, at + wanted.length);
}

function trimLine(line: string) {
  const clean = line.replace(/\s+/g, " ").trim();
  return clean.length <= MAX_LINE
    ? clean
    : `${clean.slice(0, MAX_LINE - 1).trimEnd()}…`;
}

/**
 * Checks streamed steps one at a time, in order. Returns the step as it will
 * be played and stored, or null to drop it: an unknown source, an excerpt the
 * site doesn't say, a repeat, a piece inside one already placed (or around
 * one), or one step too many.
 */
export function createStepValidator(tree: ContentTree = contentTree) {
  const seen = new Set<string>();
  const placed: string[] = [];
  let accepted = 0;
  let tosses = 0;
  const nested = (a: string, b: string) =>
    a.startsWith(`${b}.`) || b.startsWith(`${a}.`);

  return (step: PlanStep): PlanStep | null => {
    if (accepted >= MAX_STEPS) return null;
    const node = tree.get(step.source.trim());
    if (!node) return null;

    let excerpt: string | null = null;
    if (step.excerpt && node.block.kind === "quote") {
      const whole = node.block.text;
      const matched = matchExcerpt(whole, step.excerpt);
      if (!matched) return null;
      const all =
        matched === whole || matched === whole.replace(/[.,;:]+$/, "");
      excerpt = all ? null : matched;
    }

    const key = `${node.path}#${excerpt ?? ""}`;
    if (seen.has(key)) return null;
    if (step.action === "toss" && tosses >= MAX_TOSSES) return null;
    if (step.action === "fetch") {
      if (placed.some((path) => nested(path, node.path))) return null;
      placed.push(node.path);
    }

    seen.add(key);
    accepted++;
    if (step.action === "toss") tosses++;
    return {
      action: step.action,
      source: node.path,
      excerpt,
      pace: PACES.includes(step.pace) ? step.pace : "trot",
      line: trimLine(step.line ?? ""),
    };
  };
}

/** Validates a whole plan: what gets stored, and what a replay plays. */
export function finalizePlan(
  raw: RawBuildPlan,
  tree: ContentTree = contentTree,
): BuildPlan {
  const validate = createStepValidator(tree);
  const steps =
    raw.verdict === "answer"
      ? raw.steps.flatMap((step) => validate(step) ?? [])
      : [];
  const answers = steps.some((step) => step.action === "fetch");
  return {
    verdict: answers ? "answer" : "not_found",
    title: trimLine(raw.title) || "Here's what I found",
    layout: LAYOUTS.includes(raw.layout) ? raw.layout : "mixed",
    answer: raw.answer.trim(),
    steps: answers ? steps : [],
  };
}

/* "90% lower KYC operating cost", "+7 pts approval rate", "3 yrs inside…" */
const LEADING_FIGURE = /^([+-]?\d[\d.,]*(?:\s?(?:%|pts|yrs|x))?)\s+(\S.*)$/;

/**
 * The Content block a step cuts: the whole piece, or just its excerpt. An
 * excerpt that opens with a number reads as a figure, still in the site's words.
 */
export function cutBlock(
  node: SourceNode,
  excerpt: string | null,
): ContentBlock {
  if (!excerpt || node.block.kind !== "quote") return node.block;
  const figure = LEADING_FIGURE.exec(excerpt);
  if (figure) {
    return {
      kind: "figure",
      figure: figure[1],
      label: figure[2],
      context: node.block.context,
    };
  }
  return { ...node.block, text: excerpt };
}
