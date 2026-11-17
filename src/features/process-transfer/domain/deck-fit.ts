import type { Deck, DeckPlan, Slide, SlideKind, SlidePlan } from "./deck";
import { deckIssues, type Issue, wordCount } from "./deck-checks";
import { layoutDeck } from "./deck-layout";
import { clock, type Process, type ProcessStep } from "./process";
import type { RuleSet } from "./rules";

/*
 * Fit by rule: the last Round's fallback, with no model. `fitPlan` repairs a
 * Deck plan in two passes. First the content Rules, by editing words and
 * structure (trim titles and bullets, split long lists, add the slides a
 * deck must have). Then the layout: it lays the plan out, runs the Checks and
 * relieves every slide that still fails, moving a bullet to a continuation
 * slide or shortening the words that overflow, until nothing blocking is
 * left that the plan can change.
 */

/** Kinds whose bullets are the slide's list; their surplus moves to a continuation slide. */
const LIST_KINDS = new Set<SlideKind>([
  "step",
  "exceptions",
  "summary",
  "questions",
]);

const TRAILING = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "but",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "are",
  "of",
  "on",
  "or",
  "so",
  "the",
  "then",
  "to",
  "with",
]);

const CONTINUED = " (continued)";

type Limits = { bullets: number; words: number; titleChars: number };

function limitsOf(rules: RuleSet): Limits {
  const param = (id: string, key: string) => {
    const rule = rules.get(id);
    return rule?.enabled
      ? (rule.params[key] ?? Number.POSITIVE_INFINITY)
      : Number.POSITIVE_INFINITY;
  };
  return {
    bullets: param("content.max-bullets", "max"),
    // Words and characters keep a sane ceiling even when their Rule is off.
    words: Math.min(param("content.bullet-length", "maxWords"), 30),
    titleChars: Math.min(param("content.title-length", "maxChars"), 90),
  };
}

/** Drops a dangling "and", "the" or comma from the end of a cut phrase. */
function tidy(words: string[]): string {
  const kept = [...words];
  while (kept.length > 1) {
    const last = kept[kept.length - 1];
    const bare = last.replace(/[,;:—–-]+$/, "");
    if (bare !== last) kept[kept.length - 1] = bare;
    if (!bare || TRAILING.has(bare.toLowerCase())) kept.pop();
    else break;
  }
  return kept.join(" ").replace(/[,;:—–-]+$/, "");
}

/** At most `max` words, cut at the end of a sentence or clause when there is one in the second half. */
export function shortenWords(text: string, max: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= max) return words.join(" ");
  const floor = Math.max(1, Math.ceil(max / 2));
  for (const pattern of [/[.!?]$/, /[,;:]$/]) {
    for (let cut = max; cut >= floor; cut--) {
      if (pattern.test(words[cut - 1])) {
        return tidy(words.slice(0, cut)).replace(/[.!?]$/, "");
      }
    }
  }
  // Else before a conjunction, so the cut ends a clause rather than starting one.
  for (let cut = max; cut >= floor; cut--) {
    if (CONJUNCTIONS.has(words[cut]?.toLowerCase()))
      return tidy(words.slice(0, cut));
  }
  return tidy(words.slice(0, max));
}

const SUBORDINATE =
  /^(because|if|when|once|since|unless|although|while|as|before|after)\b/i;

const CONJUNCTIONS = new Set([
  "and",
  "or",
  "but",
  "then",
  "so",
  "while",
  "before",
  "after",
]);

/**
 * An instruction as bullets of at most `max` words: a long sentence is split
 * where its clauses join ("Sign in … and download …" becomes two bullets),
 * and only cut short when it has no such joint.
 */
export function instructionBullets(sentence: string, max: number): string[] {
  const clean = sentence.trim().replace(/[.!]+$/, "");
  if (wordCount(clean) <= max) return clean ? [clean] : [];
  const joints =
    /;\s+|,\s+(?:and|then)\s+|\s+and then\s+|\s+and\s+|\s+then\s+|,\s+/g;
  let best: { left: string; right: string; score: number } | null = null;
  for (const match of clean.matchAll(joints)) {
    const left = clean.slice(0, match.index);
    const right = clean.slice((match.index ?? 0) + match[0].length);
    if (wordCount(left) < 2 || wordCount(right) < 2) continue;
    // "Because the names are close, mark …" is one instruction, not two.
    if (SUBORDINATE.test(left) && !/\band\b|;/.test(match[0])) continue;
    const score = Math.max(wordCount(left), wordCount(right));
    if (!best || score < best.score) best = { left, right, score };
  }
  if (!best) return [shortenWords(clean, max)];
  const right = best.right.charAt(0).toUpperCase() + best.right.slice(1);
  return [
    ...instructionBullets(best.left, max),
    ...instructionBullets(right, max),
  ];
}

/** At most `max` characters, cut at a word boundary. */
export function trimTitle(text: string, max: number): string {
  const clean = text.trim().replace(/\s+/g, " ");
  if (clean.length <= max) return clean;
  const head = clean.slice(0, max + 1);
  const space = head.lastIndexOf(" ");
  if (space <= 0) return clean.slice(0, max);
  return tidy(head.slice(0, space).split(" ")).slice(0, max);
}

function continuedTitle(title: string, max: number): string {
  const base = title.replace(/\s*\(continued\)$/i, "");
  return `${trimTitle(base, Math.max(1, max - CONTINUED.length))}${CONTINUED}`;
}

/** Hands out slide ids no other slide has. */
class Ids {
  private readonly used = new Set<string>();

  take(wanted: string): string {
    const base = wanted.trim() || "p";
    let id = base;
    for (let n = 2; this.used.has(id); n++) id = `${base}-${n}`;
    this.used.add(id);
    return id;
  }

  next(): string {
    let n = this.used.size + 1;
    while (this.used.has(`p${n}`)) n++;
    return this.take(`p${n}`);
  }
}

const KIND_TITLES: Record<SlideKind, string> = {
  title: "Process handover",
  overview: "The process at a glance",
  roles: "Who does what, and where",
  step: "Step",
  decision: "Which way next",
  exceptions: "When it goes wrong",
  summary: "What to remember",
  questions: "Still to confirm",
};

const SLIDE = (
  id: string,
  kind: SlideKind,
  title: string,
  bullets: string[],
  notes: string,
  extra: Partial<SlidePlan> = {},
): SlidePlan => ({
  id,
  kind,
  title,
  subtitle: null,
  bullets,
  stepId: null,
  notes,
  ...extra,
});

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function titleSlide(process: Process, id: string, limits: Limits): SlidePlan {
  return SLIDE(
    id,
    "title",
    trimTitle(process.title, limits.titleChars),
    [],
    `${process.purpose} ${process.owner} hands this over to ${process.receiver}.`,
    { subtitle: `${process.owner} hands over to ${process.receiver}` },
  );
}

function stepSlide(step: ProcessStep, id: string, limits: Limits): SlidePlan {
  const bullets = [
    ...sentences(step.action).flatMap((item) =>
      instructionBullets(item, limits.words),
    ),
    ...step.details.map((item) => shortenWords(item, limits.words)),
  ]
    .filter(Boolean)
    .slice(0, Math.min(3, limits.bullets));
  const notes = [
    step.action,
    step.warning ? `Watch out: ${step.warning}` : null,
    `The recording shows it at ${clock(step.at)}.`,
  ]
    .filter(Boolean)
    .join(" ");
  return SLIDE(
    id,
    "step",
    trimTitle(step.title, limits.titleChars),
    bullets,
    notes,
    {
      stepId: step.id,
    },
  );
}

function summarySlide(process: Process, id: string, limits: Limits): SlidePlan {
  const first = process.steps[0];
  const last = process.steps[process.steps.length - 1];
  const bullets = [
    first && last && first !== last
      ? `${process.steps.length} steps, from “${first.title}” to “${last.title}”`
      : null,
    ...process.controls,
  ]
    .filter((item): item is string => Boolean(item))
    .map((item) => shortenWords(item, limits.words))
    .slice(0, Math.min(4, limits.bullets));
  return SLIDE(
    id,
    "summary",
    trimTitle(KIND_TITLES.summary, limits.titleChars),
    bullets,
    `To sum up: ${process.purpose}`,
  );
}

const COUNT_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six"];

/** A decent deck written by rule from the Process, already fitted. */
export function planFromProcess(process: Process, rules: RuleSet): DeckPlan {
  const limits = limitsOf(rules);
  const ids = new Ids();
  const slides: SlidePlan[] = [titleSlide(process, ids.next(), limits)];
  slides.push(
    SLIDE(
      ids.next(),
      "overview",
      trimTitle(KIND_TITLES.overview, limits.titleChars),
      [
        process.purpose,
        `Starts: ${process.trigger.charAt(0).toLowerCase()}${process.trigger.slice(1)}`,
        process.frequency ? `Runs: ${process.frequency}` : null,
      ]
        .filter((item): item is string => Boolean(item))
        .map((item) => shortenWords(item.replace(/[.!]+$/, ""), limits.words))
        .slice(0, limits.bullets),
      `${process.purpose} ${process.scope}`,
    ),
  );
  slides.push(
    SLIDE(
      ids.next(),
      "roles",
      trimTitle(KIND_TITLES.roles, limits.titleChars),
      [],
      process.roles
        .map((role) => `${role.name}: ${role.responsibility}.`)
        .join(" ") || "The recording names no roles.",
    ),
  );
  for (const step of process.steps) {
    slides.push(stepSlide(step, ids.next(), limits));
    if (step.decision) {
      const count = step.decision.branches.length;
      slides.push(
        SLIDE(
          ids.next(),
          "decision",
          trimTitle(
            `${COUNT_WORDS[count] ?? count} ways from here`,
            limits.titleChars,
          ),
          [],
          `${step.decision.question} ${step.decision.branches
            .map((branch) => `${branch.when}: ${branch.then}.`)
            .join(" ")}`,
          { stepId: step.id },
        ),
      );
    }
  }
  if (process.exceptions.length > 0) {
    slides.push(
      SLIDE(
        ids.next(),
        "exceptions",
        trimTitle(KIND_TITLES.exceptions, limits.titleChars),
        process.exceptions.map((item) =>
          shortenWords(`${item.situation}: ${item.handling}`, limits.words),
        ),
        process.exceptions
          .map((item) => `${item.situation}: ${item.handling}`)
          .join(" "),
      ),
    );
  }
  slides.push(summarySlide(process, ids.next(), limits));
  if (process.openQuestions.length > 0) {
    slides.push(
      SLIDE(
        ids.next(),
        "questions",
        trimTitle(KIND_TITLES.questions, limits.titleChars),
        process.openQuestions.map((item) => shortenWords(item, limits.words)),
        `Questions the call left open: ${process.openQuestions.join(" ")}`,
      ),
    );
  }
  return fitPlan({ title: process.title, slides }, process, rules);
}

/** Unique ids, trimmed words, and step ids that point at real steps. */
function normalise(
  plan: DeckPlan,
  process: Process,
  limits: Limits,
  ids: Ids,
): SlidePlan[] {
  const stepIds = new Set(process.steps.map((step) => step.id));
  return plan.slides.map((slide, index) => {
    const pointsAtStep = slide.kind === "step" || slide.kind === "decision";
    return {
      id: ids.take(slide.id || `p${index + 1}`),
      kind: slide.kind,
      title: trimTitle(
        slide.title.trim() || KIND_TITLES[slide.kind],
        limits.titleChars,
      ),
      subtitle: slide.subtitle?.trim() ? slide.subtitle.trim() : null,
      bullets: slide.bullets
        .map((bullet) => shortenWords(bullet, limits.words))
        .filter(Boolean),
      stepId:
        pointsAtStep && slide.stepId && stepIds.has(slide.stepId)
          ? slide.stepId
          : null,
      notes: slide.notes.trim(),
    };
  });
}

/** Puts the step and decision slides into the Process's order, in the places they already hold. */
function orderSteps(slides: SlidePlan[], process: Process): SlidePlan[] {
  const position = new Map(
    process.steps.map((step, index) => [step.id, index]),
  );
  const showsStep = (slide: SlidePlan) =>
    (slide.kind === "step" || slide.kind === "decision") &&
    slide.stepId !== null;
  const places = slides.flatMap((slide, index) =>
    showsStep(slide) ? [index] : [],
  );
  const sorted = places
    .map((index) => slides[index])
    .map((slide, rank) => ({ slide, rank }))
    .sort(
      (a, b) =>
        (position.get(a.slide.stepId ?? "") ?? 0) -
          (position.get(b.slide.stepId ?? "") ?? 0) ||
        Number(a.slide.kind === "decision") -
          Number(b.slide.kind === "decision") ||
        a.rank - b.rank,
    );
  const out = [...slides];
  places.forEach((place, index) => {
    out[place] = sorted[index].slide;
  });
  return out;
}

function coverSteps(
  slides: SlidePlan[],
  process: Process,
  limits: Limits,
  ids: Ids,
): SlidePlan[] {
  const out = [...slides];
  const position = new Map(
    process.steps.map((step, index) => [step.id, index]),
  );
  const indexOf = (slide: SlidePlan) =>
    (slide.kind === "step" || slide.kind === "decision") && slide.stepId
      ? (position.get(slide.stepId) ?? null)
      : null;
  process.steps.forEach((step, stepIndex) => {
    if (
      out.some((slide) => slide.stepId === step.id && indexOf(slide) !== null)
    )
      return;
    let at = -1;
    out.forEach((slide, index) => {
      const shown = indexOf(slide);
      if (shown !== null && shown < stepIndex) at = index + 1;
    });
    if (at < 0) {
      at = out.findIndex((slide) => {
        const shown = indexOf(slide);
        return (
          (shown !== null && shown > stepIndex) ||
          slide.kind === "exceptions" ||
          slide.kind === "summary" ||
          slide.kind === "questions"
        );
      });
      if (at < 0) at = out.length;
    }
    out.splice(at, 0, stepSlide(step, ids.next(), limits));
  });
  return out;
}

function openAndClose(
  slides: SlidePlan[],
  process: Process,
  limits: Limits,
  ids: Ids,
): SlidePlan[] {
  const out = [...slides];
  if (out[0]?.kind !== "title") {
    const existing = out.findIndex((slide) => slide.kind === "title");
    if (existing >= 0) out.unshift(...out.splice(existing, 1));
    else out.unshift(titleSlide(process, ids.next(), limits));
  }
  const closes = (slide: SlidePlan | undefined) =>
    slide?.kind === "summary" || slide?.kind === "questions";
  if (!closes(out[out.length - 1])) {
    let existing = -1;
    out.forEach((slide, index) => {
      if (index > 0 && closes(slide)) existing = index;
    });
    if (existing >= 0) out.push(...out.splice(existing, 1));
    else out.push(summarySlide(process, ids.next(), limits));
  }
  return out;
}

function continuation(
  slide: SlidePlan,
  bullets: string[],
  limits: Limits,
  ids: Ids,
  root = slide.id,
): SlidePlan {
  return {
    ...slide,
    id: ids.take(root),
    title: continuedTitle(slide.title, limits.titleChars),
    subtitle: null,
    bullets,
    notes: `Continuing from the slide before: ${bullets.join("; ")}.`,
  };
}

/** Continuation slides by id, each pointing at the slide it continues. */
type Continuations = Map<string, string>;

function splitBullets(
  slides: SlidePlan[],
  limits: Limits,
  ids: Ids,
  continuations: Continuations,
): SlidePlan[] {
  return slides.flatMap((slide) => {
    if (slide.bullets.length <= limits.bullets) return [slide];
    if (!LIST_KINDS.has(slide.kind)) {
      return [{ ...slide, bullets: slide.bullets.slice(0, limits.bullets) }];
    }
    const chunks: string[][] = [];
    for (let i = 0; i < slide.bullets.length; i += limits.bullets) {
      chunks.push(slide.bullets.slice(i, i + limits.bullets));
    }
    let parent = slide.id;
    return chunks.map((bullets, index) => {
      if (index === 0) return { ...slide, bullets };
      const added = continuation(slide, bullets, limits, ids);
      continuations.set(added.id, parent);
      parent = added.id;
      return added;
    });
  });
}

function fillNotes(slides: SlidePlan[], process: Process): SlidePlan[] {
  return slides.map((slide) => {
    if (slide.notes) return slide;
    const step = process.steps.find((item) => item.id === slide.stepId);
    const notes =
      slide.kind === "step" && step
        ? `${step.action} The recording shows it at ${clock(step.at)}.`
        : [slide.title, ...slide.bullets].join(". ").concat(".");
    return { ...slide, notes };
  });
}

/** The words of an element, flattened, for matching it to the bullet it shows. */
function squash(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function bulletShown(
  slide: SlidePlan,
  laid: Slide,
  elementId: string | undefined,
): number {
  const element = laid.elements.find((item) => item.id === elementId);
  if (!element || element.type !== "text") return -1;
  const shown = squash(
    element.paragraphs.flatMap((p) => p.runs.map((r) => r.text)).join(" "),
  );
  return slide.bullets.findIndex((bullet) => {
    const words = squash(bullet);
    return words.length > 0 && shown.includes(words);
  });
}

function shorter(text: string): string | null {
  const words = wordCount(text);
  if (words <= 3) return null;
  return shortenWords(text, words - 2);
}

type Found = { ruleId: string; issue: Issue };

/** One step of relief for a slide that still fails. Returns the slide (and a continuation) or null when nothing in the plan can help. */
function relieve(
  slide: SlidePlan,
  found: Found[],
  laid: Slide,
  next: SlidePlan | undefined,
  continuations: Continuations,
  limits: Limits,
  ids: Ids,
): { slides: SlidePlan[]; consumedNext: boolean } | null {
  const role = (issue: Issue) =>
    laid.elements.find((element) => element.id === issue.elementId)?.role;
  const overflow = found.filter((item) => item.ruleId === "layout.text-fits");

  // Words that do not fit their own fixed box: shorten those words.
  for (const { issue } of overflow) {
    if (role(issue) === "title") {
      const title = trimTitle(
        slide.title,
        Math.max(8, Math.floor(slide.title.length * 0.8)),
      );
      if (title !== slide.title)
        return { slides: [{ ...slide, title }], consumedNext: false };
    }
    if (role(issue) === "subtitle" && slide.subtitle) {
      return {
        slides: [{ ...slide, subtitle: shorter(slide.subtitle) }],
        consumedNext: false,
      };
    }
    const index = bulletShown(slide, laid, issue.elementId);
    if (index >= 0) {
      const bullets = [...slide.bullets];
      const cut = shorter(bullets[index]);
      if (cut) bullets[index] = cut;
      else bullets.splice(index, 1);
      return { slides: [{ ...slide, bullets }], consumedNext: false };
    }
  }

  // Too much on the slide: move the last bullet on, or let one go.
  if (slide.bullets.length > 1) {
    const bullets = slide.bullets.slice(0, -1);
    const moved = slide.bullets[slide.bullets.length - 1];
    if (!LIST_KINDS.has(slide.kind)) {
      return { slides: [{ ...slide, bullets }], consumedNext: false };
    }
    if (next && continuations.get(next.id) === slide.id) {
      return {
        slides: [
          { ...slide, bullets },
          { ...next, bullets: [moved, ...next.bullets] },
        ],
        consumedNext: true,
      };
    }
    let root = slide.id;
    while (continuations.has(root)) root = continuations.get(root) as string;
    const added = continuation(slide, [moved], limits, ids, root);
    continuations.set(added.id, slide.id);
    return { slides: [{ ...slide, bullets }, added], consumedNext: false };
  }
  if (slide.subtitle) {
    return { slides: [{ ...slide, subtitle: null }], consumedNext: false };
  }
  if (slide.bullets.length === 1) {
    const cut = shorter(slide.bullets[0]);
    return {
      slides: [{ ...slide, bullets: cut ? [cut] : [] }],
      consumedNext: false,
    };
  }
  return null;
}

/** Rules whose failures the plan can relieve by saying less on a slide. */
const RELIEVABLE = new Set([
  "layout.safe-area",
  "layout.no-overlap",
  "layout.text-fits",
  "motion.budget",
]);

function failingSlides(plan: DeckPlan, process: Process, rules: RuleSet) {
  const deck = layoutDeck(plan, process, rules);
  const failing = new Map<string, Found[]>();
  for (const { rule, issues } of deckIssues(deck, plan, process, rules)) {
    if (rule.severity !== "block" || !RELIEVABLE.has(rule.id)) continue;
    for (const issue of issues) {
      if (!issue.target) continue;
      failing.set(issue.target, [
        ...(failing.get(issue.target) ?? []),
        { ruleId: rule.id, issue },
      ]);
    }
  }
  return { deck, failing };
}

/**
 * True when the slide fails even with no bullets and no subtitle: the
 * failure comes from what the Process puts there (a long warning, many
 * roles), so taking words out of the plan cannot fix it.
 */
function structural(
  plan: DeckPlan,
  index: number,
  process: Process,
  rules: RuleSet,
): boolean {
  const bare = { ...plan.slides[index], bullets: [], subtitle: null };
  const slides = plan.slides.map((slide, at) => (at === index ? bare : slide));
  const found =
    failingSlides({ ...plan, slides }, process, rules).failing.get(bare.id) ??
    [];
  const laid = laidOf(layoutDeck({ ...plan, slides }, process, rules), bare.id);
  const titles = new Set(
    laid.elements
      .filter((element) => element.role === "title")
      .map((element) => element.id),
  );
  return found.some(
    (item) =>
      !(
        item.ruleId === "layout.text-fits" &&
        titles.has(item.issue.elementId ?? "")
      ),
  );
}

/** Every Deck slide a plan slide was laid out on, as one slide's elements. */
function laidOf(deck: Deck, planId: string): Slide {
  const pages = deck.slides.filter((slide) => slide.planId === planId);
  return { ...pages[0], elements: pages.flatMap((slide) => slide.elements) };
}

function settle(
  plan: DeckPlan,
  process: Process,
  rules: RuleSet,
  limits: Limits,
  ids: Ids,
  continuations: Continuations,
): DeckPlan {
  let current = plan;
  const stuck = new Set<string>();
  for (let round = 0; round < 400; round++) {
    const { deck, failing } = failingSlides(current, process, rules);
    for (const id of stuck) failing.delete(id);
    if (failing.size === 0) break;
    let changed = false;
    const slides: SlidePlan[] = [];
    for (let i = 0; i < current.slides.length; i++) {
      const slide = current.slides[i];
      const found = failing.get(slide.id);
      const laid = laidOf(deck, slide.id);
      if (!found) {
        slides.push(slide);
        continue;
      }
      if (structural(current, i, process, rules)) {
        stuck.add(slide.id);
        slides.push(slide);
        continue;
      }
      const relief = relieve(
        slide,
        found,
        laid,
        current.slides[i + 1],
        continuations,
        limits,
        ids,
      );
      if (!relief) {
        slides.push(slide);
        continue;
      }
      changed = true;
      slides.push(...relief.slides);
      if (relief.consumedNext) i += 1;
    }
    if (!changed) break;
    current = { ...current, slides };
  }
  return current;
}

/** Repairs a Deck plan by rule so that it passes every blocking Check it can. */
export function fitPlan(
  plan: DeckPlan,
  process: Process,
  rules: RuleSet,
): DeckPlan {
  const limits = limitsOf(rules);
  const ids = new Ids();
  let slides = normalise(plan, process, limits, ids);
  slides = orderSteps(slides, process);
  slides = coverSteps(slides, process, limits, ids);
  slides = openAndClose(slides, process, limits, ids);
  const continuations: Continuations = new Map();
  slides = splitBullets(slides, limits, ids, continuations);
  slides = fillNotes(slides, process);
  const title = trimTitle(
    plan.title.trim() || process.title,
    Math.min(limits.titleChars, 60),
  );
  return settle({ title, slides }, process, rules, limits, ids, continuations);
}
