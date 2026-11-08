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
export const MAX_SENTENCES = 8;
const MAX_LINE = 60;
const MAX_SENTENCE = 320;
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
      "fetch: cut this piece and stack it above the page. toss: pick it up, decide it does not answer the question, and throw it away.",
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
  writeup: z
    .array(
      z.object({
        text: z
          .string()
          .describe(
            "One plain sentence about Reljod, third person, only facts from the cited pieces.",
          ),
        cites: z
          .array(z.number().int())
          .describe(
            "The fetch steps this sentence comes from, numbered 1, 2, 3… in the order the fetch steps appear (toss steps are not counted).",
          ),
      }),
    )
    .describe(
      "The Write-up: 3 to 6 sentences that read as one complete answer, in reading order. Written after the steps, because it cites them.",
    ),
});

export type PlanStep = z.infer<typeof planStepSchema>;
export type RawBuildPlan = z.infer<typeof buildPlanSchema>;

/** One sentence of the Write-up and the Source blocks it comes from, numbered from 1. */
export type Sentence = { text: string; cites: number[] };

/** A Build plan that only names real sources and real words. */
export type BuildPlan = {
  verdict: "answer" | "not_found";
  title: string;
  layout: Layout;
  answer: string;
  steps: PlanStep[];
  writeup: Sentence[];
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

/**
 * Tracks which of the model's fetch steps survive validation, so the
 * Write-up's citations can be renumbered to the fetches that were kept.
 */
export function createFetchNumbering() {
  const kept = new Map<number, number>();
  let written = 0;
  let placed = 0;
  return {
    /** Call for every step the model wrote, in order, with what validation made of it. */
    record(
      raw: { action?: unknown } | null | undefined,
      valid: PlanStep | null,
    ) {
      if (raw?.action !== "fetch") return;
      written++;
      if (valid?.action === "fetch") kept.set(written, ++placed);
    },
    get placed() {
      return placed;
    },
    renumber: (cite: number) => kept.get(cite) ?? null,
  };
}

/**
 * The Write-up as it will be shown: sentences trimmed and capped, citations
 * renumbered to the fetches that were kept, and any sentence that no longer
 * cites a kept block dropped. With nothing usable, the chat answer stands in,
 * citing every block.
 */
export function cleanWriteup(
  raw: RawBuildPlan["writeup"] | undefined,
  answer: string,
  numbering: Pick<
    ReturnType<typeof createFetchNumbering>,
    "renumber" | "placed"
  >,
): Sentence[] {
  if (numbering.placed === 0) return [];
  const sentences = (raw ?? []).flatMap((sentence) => {
    const text = sentence.text?.replace(/\s+/g, " ").trim() ?? "";
    if (!text) return [];
    const cites = [
      ...new Set(
        (sentence.cites ?? []).flatMap(
          (cite) => numbering.renumber(cite) ?? [],
        ),
      ),
    ].sort((a, b) => a - b);
    // Every sentence must rest on a block that is really on the page.
    if (cites.length === 0) return [];
    return [
      {
        text:
          text.length <= MAX_SENTENCE
            ? text
            : `${text.slice(0, MAX_SENTENCE - 1).trimEnd()}…`,
        cites,
      },
    ];
  });
  if (sentences.length > 0) return sentences.slice(0, MAX_SENTENCES);
  return [
    {
      text: answer.trim(),
      cites: Array.from({ length: numbering.placed }, (_, index) => index + 1),
    },
  ];
}

/** Validates a whole plan: what gets stored, and what a replay plays. */
export function finalizePlan(
  raw: RawBuildPlan,
  tree: ContentTree = contentTree,
): BuildPlan {
  const validate = createStepValidator(tree);
  const numbering = createFetchNumbering();
  const steps =
    raw.verdict === "answer"
      ? raw.steps.flatMap((step) => {
          const valid = validate(step);
          numbering.record(step, valid);
          return valid ?? [];
        })
      : [];
  const answers = numbering.placed > 0;
  return {
    verdict: answers ? "answer" : "not_found",
    title: trimLine(raw.title) || "Here's what I found",
    layout: LAYOUTS.includes(raw.layout) ? raw.layout : "mixed",
    answer: raw.answer.trim(),
    steps: answers ? steps : [],
    writeup: answers ? cleanWriteup(raw.writeup, raw.answer, numbering) : [],
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
