import { describe, expect, it } from "vitest";
import type { Deck, DeckPlan, Slide, SlidePlan } from "./deck";
import { checkDeck, contrastRatio } from "./deck-checks";
import { planFromProcess } from "./deck-fit";
import { layoutDeck } from "./deck-layout";
import {
  blocking,
  type CheckResult,
  RULES,
  type RuleOverrides,
  resolveRules,
  ruleSet,
} from "./rules";
import { SAMPLE_PROCESS } from "./test-fixtures";

const defaults = ruleSet(resolveRules());
const goodPlan = planFromProcess(SAMPLE_PROCESS, defaults);
const goodDeck = layoutDeck(goodPlan, SAMPLE_PROCESS, defaults);

const DECK_RULES = RULES.filter((rule) =>
  ["layout", "content", "motion"].includes(rule.group),
);

function run(
  options: { plan?: DeckPlan; deck?: Deck; overrides?: RuleOverrides } = {},
): CheckResult[] {
  const rules = ruleSet(resolveRules(options.overrides));
  const plan = options.plan ?? goodPlan;
  const deck = options.deck ?? layoutDeck(plan, SAMPLE_PROCESS, rules);
  return checkDeck(deck, plan, SAMPLE_PROCESS, rules);
}

function result(results: CheckResult[], ruleId: string): CheckResult {
  const found = results.find((item) => item.ruleId === ruleId);
  if (!found) throw new Error(`No result for ${ruleId}`);
  return found;
}

/** A copy of the good Deck with one slide changed. */
function editDeck(planId: string, edit: (slide: Slide) => void): Deck {
  const copy = structuredClone(goodDeck);
  const slide = copy.slides.find((item) => item.planId === planId);
  if (!slide) throw new Error(planId);
  edit(slide);
  return copy;
}

/** A copy of the good plan with one slide changed. */
function editPlan(planId: string, edit: (slide: SlidePlan) => void): DeckPlan {
  const copy = structuredClone(goodPlan);
  const slide = copy.slides.find((item) => item.id === planId);
  if (!slide) throw new Error(planId);
  edit(slide);
  return copy;
}

const stepSlide = (stepId: string) =>
  goodPlan.slides.find(
    (slide) => slide.kind === "step" && slide.stepId === stepId,
  )?.id as string;

function expectFails(
  results: CheckResult[],
  ruleId: string,
  target: string | null,
) {
  const found = result(results, ruleId);
  expect(found.passed, `${ruleId}: ${found.summary}`).toBe(false);
  expect(found.failures.map((failure) => failure.target)).toContain(target);
  return found;
}

describe("checkDeck on the rule-written deck", () => {
  const results = run();

  it("gives one result per enabled deck Rule, in RULES order", () => {
    expect(results.map((item) => item.ruleId)).toEqual(
      DECK_RULES.map((rule) => rule.id),
    );
  });

  it("passes every Check", () => {
    for (const item of results)
      expect(item.passed, `${item.ruleId}: ${item.summary}`).toBe(true);
    expect(blocking(results)).toEqual([]);
  });

  it("says what passed in plain words", () => {
    expect(result(results, "layout.safe-area").summary).toBe(
      `All ${goodDeck.slides.length} slides keep a 48 px margin`,
    );
    expect(result(results, "content.every-step-covered").summary).toBe(
      "All 9 steps have a slide, in order",
    );
  });

  it("carries each Rule's current severity", () => {
    const changed = run({
      overrides: { "layout.aligned": { severity: "warn" } },
    });
    expect(result(changed, "layout.aligned").severity).toBe("warn");
    expect(result(changed, "content.slide-count").severity).toBe("warn");
  });

  it("gives no result for a disabled Rule", () => {
    const changed = run({
      overrides: {
        "layout.contrast": { enabled: false },
        "motion.budget": { enabled: false },
      },
    });
    expect(changed.map((item) => item.ruleId)).not.toContain("layout.contrast");
    expect(changed.map((item) => item.ruleId)).not.toContain("motion.budget");
    expect(changed).toHaveLength(DECK_RULES.length - 2);
  });
});

describe("each Check can fail and names the slide", () => {
  const warned = stepSlide("s4");
  const first = stepSlide("s1");

  it("layout.safe-area", () => {
    const deck = editDeck(first, (slide) => {
      const body = slide.elements.find((element) => element.role === "body");
      if (body) body.x = 20;
    });
    const found = expectFails(run({ deck }), "layout.safe-area", first);
    expect(found.failures[0].message).toBe(
      "Body text comes 28 px inside the 48 px margin",
    );
    expect(found.summary).toBe(
      `1 of ${goodDeck.slides.length} slides has something closer than 48 px to the edge`,
    );
  });

  it("layout.safe-area ignores decorations", () => {
    // The title slide's band runs to the edges on purpose.
    expect(result(run(), "layout.safe-area").passed).toBe(true);
    const deck = editDeck(first, (slide) => {
      const decoration = slide.elements.find(
        (element) => element.role === "decoration",
      );
      if (decoration) decoration.x = 0;
    });
    expect(result(run({ deck }), "layout.safe-area").passed).toBe(true);
  });

  it("layout.no-overlap", () => {
    const deck = editDeck(first, (slide) => {
      const image = slide.elements.find(
        (element) => element.role === "screenshot",
      );
      const body = slide.elements.find((element) => element.role === "body");
      if (image && body) image.x = body.x + 40;
    });
    const found = expectFails(run({ deck }), "layout.no-overlap", first);
    expect(found.failures[0].message).toMatch(/overlap by \d+ px/);
  });

  it("layout.no-overlap follows its gap, and the layout keeps it", () => {
    // The layout spaces everything by the Rule's gap, so its own decks pass at any gap.
    for (const gap of [12, 14, 24, 48]) {
      const results = run({
        overrides: { "layout.no-overlap": { params: { gap } } },
      });
      expect(result(results, "layout.no-overlap").passed, `gap ${gap}`).toBe(
        true,
      );
    }
    // The caption sits 12 px under the screenshot in the default deck: a
    // stricter gap applied to that same deck fails it.
    const strict = ruleSet(
      resolveRules({ "layout.no-overlap": { params: { gap: 14 } } }),
    );
    const found = checkDeck(goodDeck, goodPlan, SAMPLE_PROCESS, strict).find(
      (item) => item.ruleId === "layout.no-overlap",
    );
    expect(found?.passed).toBe(false);
    expect(found?.failures[0].message).toMatch(/12 px apart; they need 14/);
  });

  it("layout.text-fits", () => {
    const plan = editPlan(first, (slide) => {
      slide.title =
        "A title that goes on and on and on, far past anything that two lines of a slide title could ever hold, and then keeps going for good measure";
    });
    const found = expectFails(run({ plan }), "layout.text-fits", first);
    expect(found.failures[0].message).toBe(
      "The title needs 3 lines, the box holds 2",
    );
    expect(found.summary).toBe(
      `1 of ${goodDeck.slides.length} slides has text that does not fit`,
    );
  });

  it("layout.min-font-size follows its Parameters", () => {
    const strict = run({
      overrides: { "layout.min-font-size": { params: { body: 22 } } },
    });
    const found = expectFails(strict, "layout.min-font-size", first);
    expect(
      found.failures.find((failure) => failure.target === first)?.message,
    ).toBe("Body text is 20 pt; the minimum is 22 pt");
    const titles = run({
      overrides: { "layout.min-font-size": { params: { title: 40 } } },
    });
    expect(result(titles, "layout.min-font-size").failures[0].message).toMatch(
      /^The title is (32|44) pt/,
    );
  });

  it("layout.aligned follows its Parameters", () => {
    // Step slides line up on three left edges: the number, the text and the screenshot.
    const strict = run({
      overrides: { "layout.aligned": { params: { maxEdges: 2 } } },
    });
    const found = expectFails(strict, "layout.aligned", first);
    expect(found.failures[0].message).toMatch(
      /^Elements start at 3 different left edges \(64, 162, 750 px\); at most 2$/,
    );
    const deck = editDeck(first, (slide) => {
      const body = slide.elements.filter((element) => element.role === "body");
      body[1].x += 5;
    });
    expectFails(run({ deck }), "layout.aligned", first);
  });

  it("layout.title-position", () => {
    const deck = editDeck(warned, (slide) => {
      const title = slide.elements.find((element) => element.role === "title");
      if (title) title.y += 20;
    });
    const found = expectFails(run({ deck }), "layout.title-position", warned);
    expect(found.failures[0].message).toMatch(
      /^The title sits at 162, 118 px; other step slides have it at 162, 98 px$/,
    );
  });

  it("layout.contrast measures the actual colours and follows its ratio", () => {
    // The warning callout (seal red on morning haze) is about 4.6:1.
    expect(contrastRatio("#b23a2b", "#d6e4f5")).toBeGreaterThan(4.5);
    expect(contrastRatio("#b23a2b", "#d6e4f5")).toBeLessThan(5);
    const strict = run({
      overrides: { "layout.contrast": { params: { ratio: 5 } } },
    });
    const found = expectFails(strict, "layout.contrast", warned);
    expect(
      found.failures.find((failure) => failure.target === warned)?.message,
    ).toMatch(/^The callout has a contrast of 4\.6:1; it needs 5:1$/);
    const deck = editDeck(first, (slide) => {
      slide.background = "#3a3f4b";
    });
    expectFails(run({ deck }), "layout.contrast", first);
  });

  it("content.max-bullets follows its Parameter", () => {
    const plan = editPlan("p16", (slide) => {
      slide.bullets = ["One", "Two", "Three", "Four", "Five", "Six"];
    });
    const found = expectFails(run({ plan }), "content.max-bullets", "p16");
    expect(found.failures[0].message).toBe("Has 6 bullets; at most 4");
    expect(
      result(
        run({
          plan,
          overrides: { "content.max-bullets": { params: { max: 6 } } },
        }),
        "content.max-bullets",
      ).passed,
    ).toBe(true);
  });

  it("content.bullet-length", () => {
    const plan = editPlan(first, (slide) => {
      slide.bullets[0] = Array.from(
        { length: 20 },
        (_, index) => `w${index}`,
      ).join(" ");
    });
    expect(
      expectFails(run({ plan }), "content.bullet-length", first).failures[0]
        .message,
    ).toBe("A bullet has 20 words; at most 14");
  });

  it("content.title-length", () => {
    const plan = editPlan(first, (slide) => {
      slide.title = "Download the treasury statement for the pensions account";
    });
    expect(
      expectFails(run({ plan }), "content.title-length", first).failures[0]
        .message,
    ).toBe("The title has 56 characters; at most 48");
  });

  it("content.every-step-covered finds missing, misordered and unknown steps", () => {
    const missing = structuredClone(goodPlan);
    missing.slides = missing.slides.filter((slide) => slide.stepId !== "s4");
    const found = expectFails(
      run({ plan: missing }),
      "content.every-step-covered",
      "s4",
    );
    expect(found.summary).toBe("1 of 9 steps has no slide");

    const swapped = structuredClone(goodPlan);
    const a = swapped.slides.findIndex((slide) => slide.id === stepSlide("s2"));
    const b = swapped.slides.findIndex((slide) => slide.id === stepSlide("s3"));
    [swapped.slides[a], swapped.slides[b]] = [
      swapped.slides[b],
      swapped.slides[a],
    ];
    const order = expectFails(
      run({ plan: swapped }),
      "content.every-step-covered",
      stepSlide("s2"),
    );
    expect(order.failures[0].message).toBe("Shows step s2 after step s3");

    const unknown = editPlan(first, (slide) => {
      slide.stepId = "s99";
    });
    expectFails(run({ plan: unknown }), "content.every-step-covered", first);
  });

  it("content.opens-and-closes", () => {
    const plan = structuredClone(goodPlan);
    plan.slides = plan.slides.slice(1, -2);
    const found = run({ plan });
    expectFails(found, "content.opens-and-closes", "p2");
    expect(result(found, "content.opens-and-closes").failures).toHaveLength(2);
  });

  it("content.slide-count follows its Parameter", () => {
    const found = expectFails(
      run({ overrides: { "content.slide-count": { params: { max: 10 } } } }),
      "content.slide-count",
      null,
    );
    expect(found.summary).toBe(
      `${goodDeck.slides.length} slides, ${goodDeck.slides.length - 10} more than 10`,
    );
    expect(found.severity).toBe("warn");
  });

  it("content.speaker-notes", () => {
    const deck = editDeck("p3", (slide) => {
      slide.notes = "  ";
    });
    expect(
      expectFails(run({ deck }), "content.speaker-notes", "p3").summary,
    ).toBe(`1 of ${goodDeck.slides.length} slides has no speaker notes`);
  });

  it("motion.transition-on-every-slide finds a missing transition and mixed styles", () => {
    const bare = editDeck("p3", (slide) => {
      slide.transition = { type: "none", durationMs: 0 };
    });
    expectFails(run({ deck: bare }), "motion.transition-on-every-slide", "p3");
    const mixed = editDeck("p3", (slide) => {
      slide.transition = { type: "push", durationMs: 500 };
    });
    const found = expectFails(
      run({ deck: mixed }),
      "motion.transition-on-every-slide",
      null,
    );
    expect(found.summary).toBe("The deck mixes 2 transition styles");
  });

  it("motion.entrances finds a still point, a gap in the orders and reading order", () => {
    const still = editDeck(first, (slide) => {
      const body = slide.elements.find((element) => element.role === "body");
      if (body) body.animation = null;
    });
    expectFails(run({ deck: still }), "motion.entrances", first);

    const reversed = editDeck(first, (slide) => {
      const body = slide.elements.filter((element) => element.role === "body");
      const [a, b] = [body[0].animation, body[1].animation];
      if (a && b) [a.order, b.order] = [b.order, a.order];
    });
    expect(
      expectFails(run({ deck: reversed }), "motion.entrances", first)
        .failures[0].message,
    ).toBe("Body text arrives after body text but is read before it");

    const together = editDeck(first, (slide) => {
      const body = slide.elements.filter((element) => element.role === "body");
      if (body[1].animation) body[1].animation.trigger = "with";
    });
    expectFails(run({ deck: together }), "motion.entrances", first);
  });

  it("motion.budget follows its Parameter", () => {
    // The layout moves points to a further slide to stay in budget, but a
    // step's screenshot, caption and warning arrive together on its first slide.
    expect(
      result(
        run({ overrides: { "motion.budget": { params: { max: 3 } } } }),
        "motion.budget",
      ).passed,
    ).toBe(true);
    const found = expectFails(
      run({ overrides: { "motion.budget": { params: { max: 2 } } } }),
      "motion.budget",
      first,
    );
    expect(
      found.failures.find((failure) => failure.target === first)?.message,
    ).toBe("3 animated elements; at most 2");
    const busy = editDeck(first, (slide) => {
      for (const element of slide.elements) {
        if (element.role === "label" && !element.animation) {
          element.animation = {
            effect: "fade",
            trigger: "after",
            order: 99,
            durationMs: 400,
            delayMs: 0,
          };
        }
      }
    });
    expectFails(
      run({
        deck: busy,
        overrides: { "motion.budget": { params: { max: 5 } } },
      }),
      "motion.budget",
      first,
    );
  });

  it("motion.timing follows its Parameters", () => {
    expectFails(
      run({ overrides: { "motion.timing": { params: { max: 400 } } } }),
      "motion.timing",
      first,
    );
    const slow = editDeck(warned, (slide) => {
      const callout = slide.elements.find(
        (element) => element.role === "callout",
      );
      if (callout?.animation) callout.animation.durationMs = 1200;
    });
    expect(
      expectFails(run({ deck: slow }), "motion.timing", warned).failures[0]
        .message,
    ).toBe("The callout takes 1200 ms to arrive; between 250 and 700 ms");
  });

  it("lists at most six failures", () => {
    const plan = structuredClone(goodPlan);
    for (const slide of plan.slides)
      slide.title = `${slide.title} and then a great many more words to break the limit`;
    const found = result(run({ plan }), "content.title-length");
    expect(found.passed).toBe(false);
    expect(found.failures).toHaveLength(6);
    expect(found.summary).toBe(
      `${plan.slides.length} of ${plan.slides.length} slides have a title longer than 48 characters`,
    );
  });
});
