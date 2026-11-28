import { describe, expect, it } from "vitest";
import {
  type DeckPlan,
  SLIDE_H,
  SLIDE_W,
  type Slide,
  type SlideElement,
  type TextElement,
} from "./deck";
import { planFromProcess } from "./deck-fit";
import {
  DECK_THEME,
  deckGrid,
  entranceSchedule,
  layoutDeck,
  measureText,
  plainText,
  TYPE,
} from "./deck-layout";
import { resolveRules, ruleSet } from "./rules";
import { SAMPLE_PROCESS } from "./test-fixtures";

const rules = ruleSet(resolveRules());
const plan = planFromProcess(SAMPLE_PROCESS, rules);
const deck = layoutDeck(plan, SAMPLE_PROCESS, rules);

const ELLIPSIS_MARK = "…";

const texts = (slide: Slide) =>
  slide.elements.filter(
    (element): element is TextElement => element.type === "text",
  );

function overloaded(): DeckPlan {
  const long =
    "Open the remittance screen, check the employer number against the schedule, compare the totals line by line and write down every difference you find before posting";
  return {
    title: "Overloaded",
    slides: [
      {
        id: "p1",
        kind: "title",
        title: "Handover",
        subtitle: null,
        bullets: [],
        stepId: null,
        notes: "n",
      },
      {
        id: "p2",
        kind: "step",
        title: "A step with far too much to say on one slide",
        subtitle: null,
        bullets: Array.from({ length: 8 }, () => long),
        stepId: "s4",
        notes: "n",
      },
      {
        id: "p3",
        kind: "summary",
        title: "Done",
        subtitle: null,
        bullets: ["One"],
        stepId: null,
        notes: "n",
      },
    ],
  };
}

describe("layoutDeck", () => {
  it("is deterministic", () => {
    expect(JSON.stringify(layoutDeck(plan, SAMPLE_PROCESS, rules))).toBe(
      JSON.stringify(deck),
    );
  });

  it("lays out one slide per plan slide with unique element ids", () => {
    expect(deck.slides.map((slide) => slide.planId)).toEqual(
      plan.slides.map((slide) => slide.id),
    );
    for (const slide of deck.slides) {
      const ids = slide.elements.map((element) => element.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
    expect(new Set(deck.slides.map((slide) => slide.id)).size).toBe(
      deck.slides.length,
    );
    expect(deck.theme).toBe(DECK_THEME);
  });

  it("keeps everything that is not a decoration on the slide", () => {
    for (const slide of deck.slides) {
      for (const element of slide.elements.filter(
        (item) => item.role !== "decoration",
      )) {
        expect(element.x).toBeGreaterThanOrEqual(0);
        expect(element.y).toBeGreaterThanOrEqual(0);
        expect(element.x + element.w).toBeLessThanOrEqual(SLIDE_W);
        expect(element.y + element.h).toBeLessThanOrEqual(SLIDE_H);
      }
    }
  });

  it("draws a decision as a question and one card per branch", () => {
    const slide = deck.slides.find(
      (item) => item.kind === "decision" && item.stepId === "s5",
    ) as Slide;
    const decision = SAMPLE_PROCESS.steps[4].decision;
    const all = texts(slide).map(plainText).join(" | ");
    expect(all).toContain(decision?.question);
    for (const branch of decision?.branches ?? []) {
      expect(all).toContain(branch.when);
      expect(all).toContain(branch.then);
    }
    // Connectors are decorations: a line out, a spine and a stub per branch.
    expect(
      slide.elements.filter((element) => element.role === "decoration").length,
    ).toBeGreaterThanOrEqual(2 + 1 + 1 + (decision?.branches.length ?? 0));
  });

  it("lists every role and system on the roles slide", () => {
    const slide = deck.slides.find((item) => item.kind === "roles") as Slide;
    const all = texts(slide).map(plainText).join(" ");
    for (const role of SAMPLE_PROCESS.roles) expect(all).toContain(role.name);
    for (const system of SAMPLE_PROCESS.systems)
      expect(all).toContain(system.name);
  });

  it("uses one transition and entrances in order 1..n, with no animated decorations or footers", () => {
    const types = new Set(
      deck.slides.map(
        (slide) => `${slide.transition.type}:${slide.transition.durationMs}`,
      ),
    );
    expect(types.size).toBe(1);
    for (const slide of deck.slides) {
      const orders = slide.elements
        .flatMap((element) =>
          element.animation ? [element.animation.order] : [],
        )
        .sort((a, b) => a - b);
      expect(orders).toEqual(orders.map((_, index) => index + 1));
      for (const element of slide.elements) {
        if (element.role === "decoration" || element.role === "footer")
          expect(element.animation).toBeNull();
      }
    }
  });

  it("continues a slide that says too much instead of shrinking type or dropping words", () => {
    const tooMuch = overloaded();
    const laid = layoutDeck(tooMuch, SAMPLE_PROCESS, rules);
    const pages = laid.slides.filter((slide) => slide.planId === "p2");
    expect(pages.length).toBeGreaterThan(1);
    const body = pages.flatMap(
      (slide) =>
        slide.elements.filter(
          (element) => element.role === "body",
        ) as TextElement[],
    );
    expect(body).toHaveLength(8);
    const grid = deckGrid(rules);
    for (const element of body) {
      expect(element.fontSize).toBe(TYPE.body);
      expect(element.y + element.h).toBeLessThanOrEqual(grid.contentBottom);
    }
    const kicker = (slide: Slide) =>
      plainText(
        slide.elements.find(
          (element) => element.role === "label",
        ) as TextElement,
      );
    expect(kicker(pages[0])).not.toContain("CONTINUED");
    for (const page of pages.slice(1))
      expect(kicker(page)).toContain("CONTINUED");
    // The warning sits on the first slide only; the screenshot on every one.
    expect(
      pages.filter((slide) =>
        slide.elements.some((element) => element.role === "callout"),
      ),
    ).toHaveLength(1);
    for (const page of pages)
      expect(page.elements.some((element) => element.type === "image")).toBe(
        true,
      );
    // Footers count every slide.
    expect(
      plainText(
        laid.slides[1].elements.find(
          (element) => element.role === "footer",
        ) as TextElement,
      ),
    ).toContain(`2 / ${laid.slides.length}`);
  });

  it("keeps every gap at least the overlap Rule's and every slide within the animation budget", () => {
    for (const gap of [12, 20, 32, 48]) {
      const tight = ruleSet(
        resolveRules({
          "layout.no-overlap": { params: { gap } },
          "motion.budget": { params: { max: 4 } },
        }),
      );
      const laid = layoutDeck(overloaded(), SAMPLE_PROCESS, tight);
      for (const slide of [
        ...laid.slides,
        ...layoutDeck(plan, SAMPLE_PROCESS, tight).slides,
      ]) {
        const measured = slide.elements.filter(
          (element) => element.role !== "decoration",
        );
        for (let i = 0; i < measured.length; i++) {
          for (let j = i + 1; j < measured.length; j++) {
            const a = measured[i];
            const b = measured[j];
            const apart = Math.max(
              Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w)),
              Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h)),
            );
            expect(
              apart,
              `${slide.id} ${a.id} ${b.id} at gap ${gap}`,
            ).toBeGreaterThanOrEqual(gap - 0.5);
          }
        }
        const animated = slide.elements.filter(
          (element) => element.animation,
        ).length;
        if (slide.kind !== "step")
          expect(animated, slide.id).toBeLessThanOrEqual(4);
      }
    }
  });

  it("pages roles and systems, each row once, when they do not fit one slide", () => {
    const words = (count: number) =>
      Array.from({ length: count }, (_, at) => `duty${at}`).join(" ");
    const crowded = {
      ...SAMPLE_PROCESS,
      roles: Array.from({ length: 8 }, (_, at) => ({
        name: `Role ${at + 1}`,
        responsibility: words(30),
      })),
      systems: Array.from({ length: 6 }, (_, at) => ({
        name: `System ${at + 1}`,
        usedFor: words(16),
      })),
    };
    const laid = layoutDeck(plan, crowded, rules);
    const pages = laid.slides.filter((slide) => slide.kind === "roles");
    expect(pages.length).toBeGreaterThan(1);
    const text = pages
      .flatMap((slide) => texts(slide).map(plainText))
      .join(" | ");
    for (let at = 1; at <= 8; at++)
      expect(text.split(`Role ${at} `).length - 1, `Role ${at}`).toBe(1);
    for (let at = 1; at <= 6; at++)
      expect(text.split(`System ${at} `).length - 1, `System ${at}`).toBe(1);
    expect(text).toContain("SYSTEMS");
    expect(text).not.toContain(ELLIPSIS_MARK);
    const grid = deckGrid(rules);
    for (const slide of pages) {
      for (const element of slide.elements.filter(
        (item) => item.role === "body",
      )) {
        expect(element.y + element.h).toBeLessThanOrEqual(grid.contentBottom);
      }
    }
  });

  it("sizes decision cards to their words and continues the decision when they do not fit", () => {
    const words = (count: number) =>
      Array.from({ length: count }, (_, at) => `word${at}`).join(" ");
    const wordy = {
      ...SAMPLE_PROCESS,
      steps: SAMPLE_PROCESS.steps.map((step) =>
        step.decision
          ? {
              ...step,
              decision: {
                question: step.decision.question,
                branches: Array.from({ length: 4 }, (_, at) => ({
                  when: `Case ${at + 1}`,
                  // biome-ignore lint/suspicious/noThenProperty: "then" names the branch's outcome in the Process, and this object is never awaited.
                  then: words(40),
                })),
              },
            }
          : step,
      ),
    };
    const laid = layoutDeck(plan, wordy, rules);
    const pages = laid.slides.filter(
      (slide) => slide.kind === "decision" && slide.stepId === "s5",
    );
    expect(pages.length).toBeGreaterThan(1);
    const grid = deckGrid(rules);
    const cards = pages.flatMap((slide) =>
      texts(slide).filter((element) => element.role === "body"),
    );
    expect(cards).toHaveLength(4);
    for (const card of cards) {
      expect(measureText(card).height).toBeLessThanOrEqual(card.h);
      expect(card.y + card.h).toBeLessThanOrEqual(grid.contentBottom);
      expect(plainText(card)).toContain(words(40));
    }
    // The question is repeated on every slide of the decision.
    for (const page of pages)
      expect(texts(page).some((element) => element.role === "callout")).toBe(
        true,
      );
  });

  it("cuts Process words taller than an empty slide at a word boundary, with an ellipsis", () => {
    const long = Array.from({ length: 200 }, (_, at) => `caution${at}`).join(
      " ",
    );
    const warned = {
      ...SAMPLE_PROCESS,
      steps: SAMPLE_PROCESS.steps.map((step) => ({ ...step, warning: long })),
    };
    const laid = layoutDeck(plan, warned, rules);
    const callout = laid.slides
      .flatMap((slide) => slide.elements)
      .find((element) => element.role === "callout") as TextElement;
    const shown = plainText(callout);
    expect(shown.endsWith(ELLIPSIS_MARK)).toBe(true);
    expect(shown).toMatch(/caution\d+…$/);
    expect(measureText(callout).height).toBeLessThanOrEqual(callout.h);
  });

  it("moves everything in when the margin Rule asks for more", () => {
    const wide = ruleSet(
      resolveRules({ "layout.safe-area": { params: { margin: 96 } } }),
    );
    expect(deckGrid(rules).margin).toBe(64);
    expect(deckGrid(wide).margin).toBe(96);
    const laid = layoutDeck(plan, SAMPLE_PROCESS, wide);
    const title = laid.slides[1].elements.find(
      (element) => element.role === "title",
    ) as SlideElement;
    expect(title.x).toBe(96);
  });
});

describe("measureText", () => {
  const base = {
    fontSize: 20,
    font: "body" as const,
    lineHeight: 1.3,
    padding: 0,
    w: 400,
  };
  const words = (count: number) =>
    Array.from({ length: count }, () => "word").join(" ");

  it("takes more lines for more words and for a narrower box", () => {
    const short = measureText({
      ...base,
      paragraphs: [{ runs: [{ text: words(3) }] }],
    });
    const long = measureText({
      ...base,
      paragraphs: [{ runs: [{ text: words(40) }] }],
    });
    const narrow = measureText({
      ...base,
      w: 200,
      paragraphs: [{ runs: [{ text: words(40) }] }],
    });
    expect(short.lines).toBe(1);
    expect(long.lines).toBeGreaterThan(short.lines);
    expect(narrow.lines).toBeGreaterThan(long.lines);
  });

  it("counts padding, paragraph gaps, bullets and bold", () => {
    const text = words(14);
    const plain = measureText({ ...base, paragraphs: [{ runs: [{ text }] }] });
    const padded = measureText({
      ...base,
      padding: 20,
      paragraphs: [{ runs: [{ text }] }],
    });
    expect(padded.height).toBeGreaterThan(plain.height);
    const gapped = measureText({
      ...base,
      paragraphs: [
        { runs: [{ text: "a" }] },
        { runs: [{ text: "b" }], gapBefore: 30 },
      ],
    });
    expect(gapped.height).toBe(Math.ceil(((2 * (20 * 4)) / 3) * 1.3 + 30));
    const wide = "W".repeat(30);
    const regular = measureText({
      ...base,
      paragraphs: [{ runs: [{ text: wide }] }],
    });
    const bold = measureText({
      ...base,
      paragraphs: [{ runs: [{ text: wide, bold: true }] }],
    });
    const bulleted = measureText({
      ...base,
      paragraphs: [{ runs: [{ text: words(13) }], bullet: true }],
    });
    const unbulleted = measureText({
      ...base,
      paragraphs: [{ runs: [{ text: words(13) }] }],
    });
    expect(bold.lines).toBeGreaterThanOrEqual(regular.lines);
    expect(bulleted.lines).toBeGreaterThanOrEqual(unbulleted.lines);
  });

  it("errs towards more lines than Arial would set", () => {
    // 40 "n" at 20 pt Arial are 40 x 0.556 x 26.67 = 593 px: they fit a 600 px box in
    // PowerPoint, but the estimate keeps a margin and calls it two lines.
    const text = [{ runs: [{ text: "n".repeat(40) }] }];
    expect(measureText({ ...base, w: 600, paragraphs: text }).lines).toBe(2);
    expect(measureText({ ...base, w: 640, paragraphs: text }).lines).toBe(1);
  });
});

describe("entranceSchedule", () => {
  const element = (
    id: string,
    order: number,
    trigger: "click" | "after" | "with",
    durationMs = 400,
    delayMs = 0,
  ): SlideElement => ({
    id,
    type: "shape",
    role: "body",
    shape: "rect",
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    fill: null,
    stroke: null,
    strokeWidth: 0,
    animation: { effect: "fade", trigger, order, durationMs, delayMs },
  });
  const slide = (elements: SlideElement[]): Slide => ({
    id: "s",
    planId: "p1",
    kind: "summary",
    stepId: null,
    background: "#ffffff",
    transition: { type: "fade", durationMs: 500 },
    elements,
    notes: "",
  });

  it("chains after-previous effects and runs with-previous ones alongside", () => {
    const schedule = entranceSchedule(
      slide([
        element("a", 1, "after"),
        element("b", 2, "with", 300),
        element("c", 3, "after", 400, 100),
      ]),
    );
    expect(
      schedule.map((item) => [
        item.elementId,
        item.group,
        item.step,
        item.startMs,
        item.endMs,
      ]),
    ).toEqual([
      ["a", 0, 0, 0, 400],
      ["b", 0, 0, 0, 300],
      ["c", 0, 1, 500, 900],
    ]);
  });

  it("opens a new group on every click", () => {
    const schedule = entranceSchedule(
      slide([
        element("a", 1, "click"),
        element("b", 2, "after"),
        element("c", 3, "click"),
      ]),
    );
    expect(schedule.map((item) => [item.group, item.startMs])).toEqual([
      [1, 0],
      [1, 400],
      [2, 0],
    ]);
  });
});
