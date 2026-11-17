import {
  type Deck,
  type DeckPlan,
  SLIDE_H,
  SLIDE_W,
  type Slide,
  type SlideElement,
  type SlideKind,
  type TextElement,
} from "./deck";
import { linesThatFit, measureText } from "./deck-text";
import type { Process } from "./process";
import {
  type CheckFailure,
  type CheckResult,
  RULES,
  type Rule,
  type RuleSet,
} from "./rules";

/*
 * The Checks for the Deck's layout, content and motion Rules. Each measures
 * the laid-out Deck (geometry, the shared text measurement, the actual
 * colours, the entrances) or, where the Rule is about what the deck says, the
 * plan and the Process. A disabled Rule gives no result.
 *
 * Decorations: elements with the role `decoration` are bands, rules,
 * progress tracks and connector lines drawn on purpose behind or between
 * content, some of them to the slide's edge. They carry no words and no
 * screenshot, so the safe area, overlap and alignment Checks skip them.
 * Everything else, footers included, is measured.
 */

/** A failure with the element it is about, for the fit to act on. */
export type Issue = CheckFailure & { elementId?: string };

export type DeckIssues = {
  rule: Rule;
  issues: Issue[];
  summary: string;
};

type Input = {
  deck: Deck;
  plan: DeckPlan;
  process: Process;
};

type Outcome = { issues: Issue[]; summary: string };
type Check = (input: Input, params: Record<string, number>) => Outcome;

const MAX_FAILURES = 6;

const ROLE_NAMES: Record<SlideElement["role"], string> = {
  title: "The title",
  subtitle: "The subtitle",
  body: "Body text",
  number: "The step number",
  label: "A label",
  callout: "The callout",
  screenshot: "The screenshot",
  footer: "The footer",
  decoration: "A decoration",
};

function named(element: SlideElement): string {
  return ROLE_NAMES[element.role];
}

function lower(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "has" for one slide, "have" for more. */
function agree(phrase: string, count: number): string {
  if (count !== 1) return phrase;
  return phrase.replace(/^(have|do|animate)\b/, (verb) =>
    verb === "have" ? "has" : verb === "do" ? "does" : "animates",
  );
}

/** "2 of 11 slides …" or the passing sentence. The failing phrase is plural ("have …"). */
function slideSummary(
  deck: Deck,
  issues: Issue[],
  failed: string,
  passed: string,
): string {
  const slides = new Set(issues.map((issue) => issue.target));
  if (issues.length === 0) return passed;
  return `${slides.size} of ${plural(deck.slides.length, "slide")} ${agree(failed, slides.size)}`;
}

const measured = (element: SlideElement) => element.role !== "decoration";

const isText = (element: SlideElement): element is TextElement =>
  element.type === "text";

function safeArea({ deck }: Input, params: Record<string, number>): Outcome {
  const margin = params.margin;
  const issues: Issue[] = [];
  for (const slide of deck.slides) {
    let worst: { element: SlideElement; by: number } | null = null;
    for (const element of slide.elements.filter(measured)) {
      const by = Math.max(
        margin - element.x,
        margin - element.y,
        element.x + element.w - (SLIDE_W - margin),
        element.y + element.h - (SLIDE_H - margin),
      );
      if (by > 0.5 && (!worst || by > worst.by)) worst = { element, by };
    }
    if (worst) {
      issues.push({
        target: slide.planId,
        elementId: worst.element.id,
        message: `${named(worst.element)} comes ${Math.ceil(worst.by)} px inside the ${margin} px margin`,
      });
    }
  }
  return {
    issues,
    summary: slideSummary(
      deck,
      issues,
      `have something closer than ${margin} px to the edge`,
      `All ${plural(deck.slides.length, "slide")} keep a ${margin} px margin`,
    ),
  };
}

/** Space between two boxes on each axis; negative where they overlap. */
function gaps(a: SlideElement, b: SlideElement) {
  return {
    x: Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w)),
    y: Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h)),
  };
}

function noOverlap({ deck }: Input, params: Record<string, number>): Outcome {
  const gap = params.gap;
  const issues: Issue[] = [];
  for (const slide of deck.slides) {
    const elements = slide.elements.filter(measured);
    let found: Issue | null = null;
    for (let i = 0; i < elements.length && !found; i++) {
      for (let j = i + 1; j < elements.length && !found; j++) {
        const a = elements[i];
        const b = elements[j];
        const space = gaps(a, b);
        if (space.x >= gap - 0.5 || space.y >= gap - 0.5) continue;
        const later = a.y + a.h > b.y + b.h ? a : b;
        const message =
          space.x < 0 && space.y < 0
            ? `${named(a)} and ${lower(named(b))} overlap by ${Math.ceil(Math.min(-space.x, -space.y))} px`
            : `${named(a)} and ${lower(named(b))} are ${Math.max(0, Math.floor(Math.max(space.x, space.y)))} px apart; they need ${gap}`;
        found = { target: slide.planId, elementId: later.id, message };
      }
    }
    if (found) issues.push(found);
  }
  return {
    issues,
    summary: slideSummary(
      deck,
      issues,
      "have elements that overlap or touch",
      `Nothing overlaps; every element keeps ${gap} px clear`,
    ),
  };
}

function textFits({ deck }: Input): Outcome {
  const issues: Issue[] = [];
  for (const slide of deck.slides) {
    for (const element of slide.elements.filter(isText)) {
      const need = measureText(element).lines;
      const room = linesThatFit(element);
      if (need > room) {
        issues.push({
          target: slide.planId,
          elementId: element.id,
          message: `${named(element)} needs ${plural(need, "line")}, the box holds ${room}`,
        });
      }
    }
  }
  const slides = new Set(issues.map((issue) => issue.target)).size;
  return {
    issues,
    summary:
      issues.length === 0
        ? `All text fits its box on all ${plural(deck.slides.length, "slide")}`
        : `${slides} of ${plural(deck.slides.length, "slide")} ${slides === 1 ? "has" : "have"} text that does not fit`,
  };
}

const BODY_ROLES = new Set<SlideElement["role"]>([
  "body",
  "subtitle",
  "callout",
]);

/*
 * Titles are held to the title minimum and body, subtitle and callout text to
 * the body minimum. Labels, step numbers and footers are furniture: small on
 * purpose and never the point of the slide.
 */
function minFontSize({ deck }: Input, params: Record<string, number>): Outcome {
  const issues: Issue[] = [];
  for (const slide of deck.slides) {
    for (const element of slide.elements.filter(isText)) {
      const min =
        element.role === "title"
          ? params.title
          : BODY_ROLES.has(element.role)
            ? params.body
            : null;
      if (min !== null && element.fontSize < min) {
        issues.push({
          target: slide.planId,
          elementId: element.id,
          message: `${named(element)} is ${element.fontSize} pt; the minimum is ${min} pt`,
        });
        break;
      }
    }
  }
  return {
    issues,
    summary: slideSummary(
      deck,
      issues,
      "have text below the minimum size",
      `Body text is at least ${params.body} pt and titles at least ${params.title} pt`,
    ),
  };
}

function aligned({ deck }: Input, params: Record<string, number>): Outcome {
  const issues: Issue[] = [];
  for (const slide of deck.slides) {
    const lefts = slide.elements
      .filter(measured)
      .map((element) => element.x)
      .sort((a, b) => a - b);
    const edges: number[] = [];
    for (const x of lefts) {
      if (
        edges.length === 0 ||
        x - edges[edges.length - 1] > params.tolerance
      ) {
        edges.push(x);
      }
    }
    if (edges.length > params.maxEdges) {
      issues.push({
        target: slide.planId,
        message: `Elements start at ${edges.length} different left edges (${edges.map((x) => Math.round(x)).join(", ")} px); at most ${params.maxEdges}`,
      });
    }
  }
  return {
    issues,
    summary: slideSummary(
      deck,
      issues,
      "have elements on too many left edges",
      `Every slide lines up on at most ${plural(params.maxEdges, "left edge")}`,
    ),
  };
}

function titlePosition({ deck }: Input): Outcome {
  const issues: Issue[] = [];
  const first = new Map<SlideKind, SlideElement>();
  for (const slide of deck.slides) {
    const title = slide.elements.find((element) => element.role === "title");
    if (!title) {
      issues.push({ target: slide.planId, message: "The slide has no title" });
      continue;
    }
    const reference = first.get(slide.kind);
    if (!reference) {
      first.set(slide.kind, title);
      continue;
    }
    const dx = Math.abs(title.x - reference.x);
    const dy = Math.abs(title.y - reference.y);
    if (dx > 1 || dy > 1) {
      issues.push({
        target: slide.planId,
        elementId: title.id,
        message: `The title sits at ${Math.round(title.x)}, ${Math.round(title.y)} px; other ${slide.kind} slides have it at ${Math.round(reference.x)}, ${Math.round(reference.y)} px`,
      });
    }
  }
  return {
    issues,
    summary: slideSummary(
      deck,
      issues,
      "have a title out of place",
      "Titles sit in the same place on every slide of a kind",
    ),
  };
}

function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((index) => {
    const channel = Number.parseInt(value.slice(index, index + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** What a text element is read against: its own fill, else the topmost filled box behind its centre, else the slide. */
function backdrop(slide: Slide, element: TextElement): string | null {
  if (element.fill) return element.fill;
  const index = slide.elements.indexOf(element);
  const cx = element.x + element.w / 2;
  const cy = element.y + element.h / 2;
  for (let i = index - 1; i >= 0; i--) {
    const behind = slide.elements[i];
    const inside =
      cx >= behind.x &&
      cx <= behind.x + behind.w &&
      cy >= behind.y &&
      cy <= behind.y + behind.h;
    if (!inside) continue;
    if (behind.type === "image") return null;
    if (behind.type === "shape" && behind.shape !== "line" && behind.fill) {
      return behind.fill;
    }
    if (behind.type === "text" && behind.fill) return behind.fill;
  }
  return slide.background;
}

function contrast({ deck }: Input, params: Record<string, number>): Outcome {
  const issues: Issue[] = [];
  for (const slide of deck.slides) {
    let worst: { element: TextElement; ratio: number } | null = null;
    for (const element of slide.elements.filter(isText)) {
      const back = backdrop(slide, element);
      for (const paragraph of element.paragraphs) {
        for (const run of paragraph.runs) {
          if (!run.text.trim()) continue;
          // Text on a screenshot cannot be measured, so it counts as failing.
          const ratio = back
            ? contrastRatio(run.color ?? element.color, back)
            : 1;
          if (ratio < params.ratio && (!worst || ratio < worst.ratio)) {
            worst = { element, ratio };
          }
        }
      }
    }
    if (worst) {
      issues.push({
        target: slide.planId,
        elementId: worst.element.id,
        message: `${named(worst.element)} has a contrast of ${worst.ratio.toFixed(1)}:1; it needs ${params.ratio}:1`,
      });
    }
  }
  return {
    issues,
    summary: slideSummary(
      deck,
      issues,
      "have text too faint against its background",
      `All text has a contrast of at least ${params.ratio}:1`,
    ),
  };
}

function maxBullets(
  { plan, deck }: Input,
  params: Record<string, number>,
): Outcome {
  const issues: Issue[] = plan.slides
    .filter((slide) => slide.bullets.length > params.max)
    .map((slide) => ({
      target: slide.id,
      message: `Has ${slide.bullets.length} bullets; at most ${params.max}`,
    }));
  return {
    issues,
    summary: slideSummary(
      deck,
      issues,
      `have more than ${params.max} bullets`,
      `No slide has more than ${plural(params.max, "bullet")}`,
    ),
  };
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function bulletLength(
  { plan, deck }: Input,
  params: Record<string, number>,
): Outcome {
  const issues: Issue[] = [];
  for (const slide of plan.slides) {
    const longest = Math.max(0, ...slide.bullets.map(wordCount));
    if (longest > params.maxWords) {
      issues.push({
        target: slide.id,
        message: `A bullet has ${longest} words; at most ${params.maxWords}`,
      });
    }
  }
  return {
    issues,
    summary: slideSummary(
      deck,
      issues,
      `have a bullet longer than ${params.maxWords} words`,
      `Every bullet has at most ${params.maxWords} words`,
    ),
  };
}

function titleLength(
  { plan, deck }: Input,
  params: Record<string, number>,
): Outcome {
  const issues: Issue[] = plan.slides
    .filter((slide) => slide.title.trim().length > params.maxChars)
    .map((slide) => ({
      target: slide.id,
      message: `The title has ${slide.title.trim().length} characters; at most ${params.maxChars}`,
    }));
  return {
    issues,
    summary: slideSummary(
      deck,
      issues,
      `have a title longer than ${params.maxChars} characters`,
      `Every title has at most ${params.maxChars} characters`,
    ),
  };
}

/** Step and decision slides are the ones that show a step; their order must follow the Process. */
function everyStepCovered({ plan, process }: Input): Outcome {
  const issues: Issue[] = [];
  const position = new Map(
    process.steps.map((step, index) => [step.id, index]),
  );
  const covered = new Set<string>();
  let last = -1;
  let lastId = "";
  for (const slide of plan.slides) {
    if (slide.kind !== "step" && slide.kind !== "decision") continue;
    if (slide.stepId === null) continue;
    const index = position.get(slide.stepId);
    if (index === undefined) {
      issues.push({
        target: slide.id,
        message: `Points at step ${slide.stepId}, which is not in the Process`,
      });
      continue;
    }
    covered.add(slide.stepId);
    if (index < last) {
      issues.push({
        target: slide.id,
        message: `Shows step ${slide.stepId} after step ${lastId}`,
      });
    } else {
      last = index;
      lastId = slide.stepId;
    }
  }
  const missing = process.steps.filter((step) => !covered.has(step.id));
  for (const step of missing) {
    issues.push({
      target: step.id,
      message: `Step ${step.id} "${step.title}" has no slide`,
    });
  }
  const outOfOrder = issues.length - missing.length;
  return {
    issues,
    summary:
      issues.length === 0
        ? `All ${plural(process.steps.length, "step")} have a slide, in order`
        : [
            missing.length > 0
              ? `${missing.length} of ${plural(process.steps.length, "step")} ${missing.length === 1 ? "has" : "have"} no slide`
              : null,
            outOfOrder > 0
              ? `${plural(outOfOrder, "slide")} ${outOfOrder === 1 ? "is" : "are"} out of order or point at no step`
              : null,
          ]
            .filter(Boolean)
            .join("; "),
  };
}

function opensAndCloses({ plan }: Input): Outcome {
  const issues: Issue[] = [];
  const first = plan.slides[0];
  const last = plan.slides[plan.slides.length - 1];
  if (!first || first.kind !== "title") {
    issues.push({
      target: first?.id ?? null,
      message: first
        ? `The deck opens with a ${first.kind} slide, not a title slide`
        : "The deck has no slides",
    });
  }
  if (last && last.kind !== "summary" && last.kind !== "questions") {
    issues.push({
      target: last.id,
      message: `The deck closes with a ${last.kind} slide, not a summary or open questions`,
    });
  }
  return {
    issues,
    summary:
      issues.length === 0
        ? `Opens with a title slide and closes with ${last.kind === "summary" ? "a summary" : "open questions"}`
        : issues.map((issue) => issue.message).join("; "),
  };
}

function slideCount({ deck }: Input, params: Record<string, number>): Outcome {
  const count = deck.slides.length;
  const issues: Issue[] =
    count > params.max
      ? [
          {
            target: null,
            message: `${plural(count, "slide")}; at most ${params.max}`,
          },
        ]
      : [];
  return {
    issues,
    summary:
      issues.length === 0
        ? `${plural(count, "slide")}, within ${params.max}`
        : `${plural(count, "slide")}, ${count - params.max} more than ${params.max}`,
  };
}

function speakerNotes({ deck }: Input): Outcome {
  const issues: Issue[] = deck.slides
    .filter((slide) => !slide.notes.trim())
    .map((slide) => ({ target: slide.planId, message: "No speaker notes" }));
  return {
    issues,
    summary: slideSummary(
      deck,
      issues,
      "have no speaker notes",
      `All ${plural(deck.slides.length, "slide")} have speaker notes`,
    ),
  };
}

function transitions({ deck }: Input): Outcome {
  const issues: Issue[] = [];
  const styles = new Map<string, number>();
  for (const slide of deck.slides) {
    if (slide.transition.type === "none" || slide.transition.durationMs <= 0) {
      issues.push({ target: slide.planId, message: "No transition" });
    } else {
      styles.set(
        slide.transition.type,
        (styles.get(slide.transition.type) ?? 0) + 1,
      );
    }
  }
  if (styles.size > 1) {
    const counts = [...styles]
      .map(([type, count]) => `${type} on ${count}`)
      .join(", ");
    issues.push({
      target: null,
      message: `Uses ${styles.size} transition styles: ${counts}`,
    });
  }
  const style = [...styles.keys()][0] ?? "none";
  const bare = issues.filter((issue) => issue.target).length;
  return {
    issues,
    summary:
      issues.length === 0
        ? `Every slide changes with a ${style} transition`
        : [
            bare > 0
              ? `${bare} of ${plural(deck.slides.length, "slide")} change without a transition`
              : null,
            styles.size > 1
              ? `the deck mixes ${styles.size} transition styles`
              : null,
          ]
            .filter(Boolean)
            .join("; ")
            .replace(/^./, (char) => char.toUpperCase()),
  };
}

const POINT_ROLES = new Set<SlideElement["role"]>([
  "body",
  "callout",
  "screenshot",
]);

/** True when `later` sits above `earlier` in the same column, or left of it in the same row. */
function readsBefore(later: SlideElement, earlier: SlideElement): boolean {
  const sameColumn =
    later.x < earlier.x + earlier.w && earlier.x < later.x + later.w;
  const sameRow =
    later.y < earlier.y + earlier.h && earlier.y < later.y + later.h;
  return (
    (sameColumn && later.y + later.h <= earlier.y) ||
    (sameRow && later.x + later.w <= earlier.x)
  );
}

/*
 * Content slides (every kind but the title slide) must bring each point
 * (body text, callouts, screenshots) in with an entrance. On every slide the
 * orders run 1..n without gaps, nothing arrives before something it is read
 * after, and two points never arrive together.
 */
function entrances({ deck }: Input): Outcome {
  const issues: Issue[] = [];
  for (const slide of deck.slides) {
    const problems: Issue[] = [];
    if (slide.kind !== "title") {
      const still = slide.elements.find(
        (element) => POINT_ROLES.has(element.role) && !element.animation,
      );
      if (still) {
        problems.push({
          target: slide.planId,
          elementId: still.id,
          message: `${named(still)} appears without an entrance`,
        });
      }
    }
    const animated = slide.elements
      .filter((element) => element.animation)
      .sort((a, b) => (a.animation?.order ?? 0) - (b.animation?.order ?? 0));
    const orders = animated.map((element) => element.animation?.order ?? 0);
    if (orders.some((order, index) => order !== index + 1)) {
      problems.push({
        target: slide.planId,
        message: `Entrance orders skip or repeat (${orders.join(", ")})`,
      });
    }
    for (let i = 0; i < animated.length && problems.length === 0; i++) {
      for (let j = i + 1; j < animated.length; j++) {
        if (readsBefore(animated[j], animated[i])) {
          problems.push({
            target: slide.planId,
            elementId: animated[j].id,
            message: `${named(animated[j])} arrives after ${lower(named(animated[i]))} but is read before it`,
          });
          break;
        }
      }
    }
    for (let i = 1; i < animated.length && problems.length === 0; i++) {
      const current = animated[i];
      const previous = animated[i - 1];
      if (
        current.animation?.trigger === "with" &&
        current.role === "body" &&
        previous.role === "body"
      ) {
        problems.push({
          target: slide.planId,
          elementId: current.id,
          message: "Two points arrive together instead of one at a time",
        });
      }
    }
    if (problems.length > 0) issues.push(problems[0]);
  }
  return {
    issues,
    summary: slideSummary(
      deck,
      issues,
      "do not bring their points in one at a time, in reading order",
      "Every content slide brings its points in one at a time, in reading order",
    ),
  };
}

function budget({ deck }: Input, params: Record<string, number>): Outcome {
  const issues: Issue[] = [];
  for (const slide of deck.slides) {
    const count = slide.elements.filter((element) => element.animation).length;
    if (count > params.max) {
      issues.push({
        target: slide.planId,
        message: `${count} animated elements; at most ${params.max}`,
      });
    }
  }
  return {
    issues,
    summary: slideSummary(
      deck,
      issues,
      `animate more than ${params.max} elements`,
      `No slide animates more than ${params.max} elements`,
    ),
  };
}

function timing({ deck }: Input, params: Record<string, number>): Outcome {
  const issues: Issue[] = [];
  for (const slide of deck.slides) {
    const off = slide.elements.find(
      (element) =>
        element.animation &&
        (element.animation.durationMs < params.min ||
          element.animation.durationMs > params.max),
    );
    if (off?.animation) {
      issues.push({
        target: slide.planId,
        elementId: off.id,
        message: `${named(off)} takes ${off.animation.durationMs} ms to arrive; between ${params.min} and ${params.max} ms`,
      });
    }
  }
  return {
    issues,
    summary: slideSummary(
      deck,
      issues,
      `have entrances outside ${params.min}–${params.max} ms`,
      `Every entrance takes ${params.min}–${params.max} ms`,
    ),
  };
}

const CHECKS: Record<string, Check> = {
  "layout.safe-area": safeArea,
  "layout.no-overlap": noOverlap,
  "layout.text-fits": textFits,
  "layout.min-font-size": minFontSize,
  "layout.aligned": aligned,
  "layout.title-position": titlePosition,
  "layout.contrast": contrast,
  "content.max-bullets": maxBullets,
  "content.bullet-length": bulletLength,
  "content.title-length": titleLength,
  "content.every-step-covered": everyStepCovered,
  "content.opens-and-closes": opensAndCloses,
  "content.slide-count": slideCount,
  "content.speaker-notes": speakerNotes,
  "motion.transition-on-every-slide": transitions,
  "motion.entrances": entrances,
  "motion.budget": budget,
  "motion.timing": timing,
};

/** Every enabled Deck Rule applied, with all its failures and the element each is about. */
export function deckIssues(
  deck: Deck,
  plan: DeckPlan,
  process: Process,
  rules: RuleSet,
): DeckIssues[] {
  const input = { deck, plan, process };
  const out: DeckIssues[] = [];
  for (const def of RULES) {
    const check = CHECKS[def.id];
    const rule = rules.get(def.id);
    if (!check || !rule?.enabled) continue;
    const outcome = check(input, rule.params);
    out.push({ rule, issues: outcome.issues, summary: outcome.summary });
  }
  return out;
}

/** One CheckResult per enabled layout, content and motion Rule, in `RULES` order. */
export function checkDeck(
  deck: Deck,
  plan: DeckPlan,
  process: Process,
  rules: RuleSet,
): CheckResult[] {
  return deckIssues(deck, plan, process, rules).map(
    ({ rule, issues, summary }) => ({
      ruleId: rule.id,
      severity: rule.severity,
      passed: issues.length === 0,
      summary,
      failures: issues
        .slice(0, MAX_FAILURES)
        .map(({ target, message }) => ({ target, message })),
    }),
  );
}
