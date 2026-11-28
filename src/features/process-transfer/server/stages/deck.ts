import "server-only";
import { type DeckPlan, deckPlanSchema } from "../../domain/deck";
import { checkDeck } from "../../domain/deck-checks";
import { fitPlan, planFromProcess } from "../../domain/deck-fit";
import { layoutDeck } from "../../domain/deck-layout";
import { LIMITS } from "../../domain/limits";
import type { ModelChoice } from "../../domain/models";
import type { Process } from "../../domain/process";
import {
  type CheckResult,
  type ReviewFinding,
  type RuleSet,
  reviewSchema,
} from "../../domain/rules";
import type { DeckRound } from "../../domain/run";
import { generate, type RunContext } from "../llm";
import type { Designed } from "../ports";
import {
  DECK_REVIEW_INSTRUCTIONS,
  deckDraftPrompt,
  deckInstructions,
  deckReviewPrompt,
  deckRevisePrompt,
} from "../prompts";

/** Slide ids in order (p1, p2, ...); a step id the Process does not have is dropped. */
function cleanPlan(plan: DeckPlan, process: Process): DeckPlan {
  const steps = new Set(process.steps.map((step) => step.id));
  return {
    title: plan.title.trim() || process.title,
    slides: plan.slides.slice(0, LIMITS.maxSlides).map((slide, index) => ({
      ...slide,
      id: `p${index + 1}`,
      stepId: slide.stepId && steps.has(slide.stepId) ? slide.stepId : null,
    })),
  };
}

/**
 * The Design stage for one Round: a draft or a revision by the Write model,
 * or a fit by rule. A plan the model could not deliver is replaced by a deck
 * planned by rule from the Process, so the Round still has a Deck.
 */
export async function designPlan(
  ctx: RunContext,
  input: {
    round: number;
    by: DeckRound["by"];
    process: Process;
    previous: DeckRound | null;
    rules: RuleSet;
    models: ModelChoice;
  },
): Promise<Designed> {
  const { process, rules, previous } = input;
  if (input.by === "auto-fit" && previous) {
    return { plan: fitPlan(previous.plan, process, rules), fallback: null };
  }
  const revising = input.by === "revision" && previous;
  try {
    const plan = await generate(ctx, {
      purpose: "write",
      label: revising
        ? `Revise the slides (round ${input.round})`
        : "Plan the slides",
      model: input.models.write,
      schema: deckPlanSchema,
      instructions: deckInstructions(rules),
      content: revising
        ? deckRevisePrompt({
            process,
            plan: previous.plan,
            checks: previous.checks.filter((check) => !check.passed),
            findings: previous.findings,
            round: input.round,
          })
        : deckDraftPrompt(process),
      maxOutputTokens: 16_000,
    });
    const clean = cleanPlan(plan, process);
    if (clean.slides.length === 0) throw new Error("The plan has no slides.");
    return { plan: clean, fallback: null };
  } catch (error) {
    console.error("[process-transfer] unusable Deck plan", error);
    return {
      plan: planFromProcess(process, rules),
      fallback: "the model's plan was unusable",
    };
  }
}

/** The Check stage for one Round: the Deck's Checks, then the reviewer. */
export async function checkRound(
  ctx: RunContext,
  input: {
    round: number;
    plan: DeckPlan;
    process: Process;
    rules: RuleSet;
    models: ModelChoice;
  },
): Promise<{ checks: CheckResult[]; findings: ReviewFinding[] }> {
  const { plan, process, rules } = input;
  const deck = layoutDeck(plan, process, rules);
  const checks = checkDeck(deck, plan, process, rules);
  if (!(rules.get("loop.reviewer")?.enabled ?? false)) {
    return { checks, findings: [] };
  }
  const review = await generate(ctx, {
    purpose: "review",
    label: `Review the slides (round ${input.round})`,
    model: input.models.review,
    schema: reviewSchema,
    instructions: DECK_REVIEW_INSTRUCTIONS,
    content: deckReviewPrompt(deck, process),
    maxOutputTokens: 8_000,
  });
  return { checks, findings: review.findings.slice(0, 30) };
}
