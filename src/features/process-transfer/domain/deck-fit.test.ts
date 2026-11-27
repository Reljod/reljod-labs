import { describe, expect, it } from "vitest";
import { type DeckPlan, SLIDE_KINDS, type SlidePlan } from "./deck";
import { checkDeck, wordCount } from "./deck-checks";
import { fitPlan, planFromProcess } from "./deck-fit";
import { layoutDeck } from "./deck-layout";
import type { Process } from "./process";
import { blocking, resolveRules, ruleSet } from "./rules";
import {
  generateProcess,
  REAL_PROCESSES,
  SAMPLE_PROCESS,
} from "./test-fixtures";

const rules = ruleSet(resolveRules());

function blockers(plan: DeckPlan, process: Process = SAMPLE_PROCESS) {
  return blocking(
    checkDeck(layoutDeck(plan, process, rules), plan, process, rules),
  );
}

function describeFailures(
  plan: DeckPlan,
  process: Process = SAMPLE_PROCESS,
): string {
  return blockers(plan, process)
    .map(
      (item) =>
        `${item.ruleId}: ${item.failures.map((f) => `${f.target} ${f.message}`).join("; ")}`,
    )
    .join("\n");
}

const slide = (
  id: string,
  kind: SlidePlan["kind"],
  extra: Partial<SlidePlan> = {},
): SlidePlan => ({
  id,
  kind,
  title: "A slide",
  subtitle: null,
  bullets: [],
  stepId: null,
  notes: "Notes.",
  ...extra,
});

const LONG =
  "Open the remittance screen, check the employer number against the schedule, compare the totals line by line and write down every difference you find before posting anything at all";

/** Plans a model might write on a bad day. */
const ADVERSARIAL: Record<string, DeckPlan> = {
  empty: { title: "", slides: [] },
  overloaded: {
    title:
      "A deck title that is much too long to sit in a footer without wrapping onto a second line at all",
    slides: [
      slide("p1", "title", {
        title: LONG,
        subtitle: LONG,
        bullets: [LONG, LONG],
      }),
      slide("p2", "overview", {
        bullets: Array.from({ length: 9 }, () => LONG),
        subtitle: LONG,
      }),
      slide("p3", "roles", { bullets: Array.from({ length: 6 }, () => LONG) }),
      ...SAMPLE_PROCESS.steps.map((step, index) =>
        slide(`p${index + 4}`, "step", {
          stepId: step.id,
          title: LONG,
          bullets: Array.from({ length: 7 }, () => LONG),
          notes: "",
        }),
      ),
      slide("p13", "decision", {
        stepId: "s5",
        bullets: [LONG, LONG, LONG],
        title: LONG,
      }),
      slide("p14", "exceptions", {
        bullets: Array.from({ length: 7 }, () => LONG),
      }),
      slide("p15", "summary", {
        bullets: Array.from({ length: 9 }, () => LONG),
      }),
    ],
  },
  misordered: {
    title: "Misordered",
    slides: [
      slide("p1", "summary", { bullets: ["Wrap up"] }),
      slide("p2", "step", { stepId: "s9", bullets: ["Last step first"] }),
      slide("p3", "step", { stepId: "s1", bullets: ["First step"] }),
      slide("p4", "title", { title: "The title, late" }),
      slide("p5", "step", { stepId: "s3" }),
      slide("p6", "step", { stepId: "s2" }),
      slide("p7", "overview"),
    ],
  },
  missingSteps: {
    title: "Missing steps",
    slides: [
      slide("p1", "title"),
      slide("p2", "step", { stepId: "s2", bullets: ["Only step two"] }),
      slide("p3", "decision", { stepId: "s7" }),
      slide("p4", "step", {
        stepId: "s99",
        bullets: ["A step that does not exist"],
      }),
      slide("p5", "questions", { bullets: SAMPLE_PROCESS.openQuestions }),
    ],
  },
  duplicateIds: {
    title: "Duplicates",
    slides: [
      slide("p1", "title"),
      slide("p1", "overview", { bullets: ["a", "b"] }),
      slide("", "summary", { bullets: ["x"] }),
      slide("p1", "summary", { bullets: ["y"] }),
    ],
  },
  hugeWords: {
    title: "Huge words",
    slides: [
      slide("p1", "title", {
        title: "Supercalifragilisticexpialidocious".repeat(4),
      }),
      slide("p2", "summary", {
        bullets: [
          "x".repeat(400),
          "Pneumonoultramicroscopicsilicovolcanoconiosis ".repeat(6),
        ],
      }),
      slide("p3", "exceptions", {
        bullets: [`${"Situation ".repeat(10)}: ${"handling ".repeat(20)}`],
      }),
    ],
  },
};

/** A small, seeded generator, so the fuzzed plans are the same on every run. */
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function fuzzed(seed: number): DeckPlan {
  const next = random(seed);
  const pick = <T>(items: readonly T[]) =>
    items[Math.floor(next() * items.length)];
  const words = [
    "post",
    "the",
    "remittance",
    "and",
    "check",
    "schedule,",
    "employer",
    "variance",
    "Team",
    "Lead",
    "suspense.",
    "W".repeat(12),
  ];
  const phrase = (max: number) =>
    Array.from({ length: 1 + Math.floor(next() * max) }, () =>
      pick(words),
    ).join(" ");
  const count = Math.floor(next() * 30);
  return {
    title: phrase(20),
    slides: Array.from({ length: count }, (_, index) =>
      slide(next() < 0.1 ? "p1" : `p${index + 1}`, pick(SLIDE_KINDS), {
        title: phrase(16),
        subtitle: next() < 0.3 ? phrase(30) : null,
        bullets: Array.from({ length: Math.floor(next() * 9) }, () =>
          phrase(35),
        ),
        stepId:
          next() < 0.8
            ? pick([...SAMPLE_PROCESS.steps.map((step) => step.id), "s42"])
            : null,
        notes: next() < 0.3 ? "" : phrase(10),
      }),
    ),
  };
}

describe("planFromProcess", () => {
  const plan = planFromProcess(SAMPLE_PROCESS, rules);

  it("passes every blocking Check under the default Rules", () => {
    expect(describeFailures(plan)).toBe("");
  });

  it("opens with the title, covers every step in order with a decision slide for each decision, and closes with questions", () => {
    expect(plan.slides[0].kind).toBe("title");
    expect(plan.slides.at(-1)?.kind).toBe("questions");
    expect(plan.slides.map((item) => item.kind)).toEqual(
      expect.arrayContaining(["overview", "roles", "exceptions", "summary"]),
    );
    const shown = plan.slides
      .filter((item) => item.kind === "step")
      .map((item) => item.stepId);
    expect([...new Set(shown)]).toEqual(
      SAMPLE_PROCESS.steps.map((step) => step.id),
    );
    expect(
      plan.slides
        .filter((item) => item.kind === "decision")
        .map((item) => item.stepId),
    ).toEqual(["s5", "s7"]);
    expect(plan.slides.every((item) => item.notes.length > 0)).toBe(true);
  });

  it("splits a long instruction where its clauses join instead of cutting it short", () => {
    const first = plan.slides.find((item) => item.stepId === "s1");
    expect(first?.bullets.slice(0, 2)).toEqual([
      "Sign in to the Treasury Portal",
      "Download the month-end statement for the pensions collection account as CSV",
    ]);
  });
});

describe("fitPlan", () => {
  for (const [name, plan] of Object.entries(ADVERSARIAL)) {
    it(`leaves no blocking failure: ${name}`, () => {
      const fitted = fitPlan(plan, SAMPLE_PROCESS, rules);
      expect(describeFailures(fitted)).toBe("");
      const ids = fitted.slides.map((item) => item.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.every(Boolean)).toBe(true);
    });
  }

  it("leaves no blocking failure on 40 fuzzed plans", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const fitted = fitPlan(fuzzed(seed), SAMPLE_PROCESS, rules);
      expect(describeFailures(fitted), `seed ${seed}`).toBe("");
      expect(
        new Set(fitted.slides.map((item) => item.id)).size,
        `seed ${seed}`,
      ).toBe(fitted.slides.length);
    }
  });

  it("moves surplus bullets to a continuation slide rather than losing them", () => {
    const plan: DeckPlan = {
      title: "Continuation",
      slides: [
        slide("p1", "title"),
        ...SAMPLE_PROCESS.steps.map((step, index) =>
          slide(`p${index + 2}`, "step", {
            stepId: step.id,
            bullets: ["Do it"],
          }),
        ),
        slide("p20", "summary", {
          title: "What to remember",
          bullets: ["One", "Two", "Three", "Four", "Five", "Six"],
        }),
      ],
    };
    const fitted = fitPlan(plan, SAMPLE_PROCESS, rules);
    const summaries = fitted.slides.filter((item) => item.kind === "summary");
    expect(summaries.map((item) => item.title)).toEqual([
      "What to remember",
      "What to remember (continued)",
    ]);
    expect(summaries.flatMap((item) => item.bullets)).toEqual([
      "One",
      "Two",
      "Three",
      "Four",
      "Five",
      "Six",
    ]);
    expect(summaries[1].id).toBe("p20-2");
  });

  it("puts steps back in order, adds what is missing and points nothing at unknown steps", () => {
    const fitted = fitPlan(ADVERSARIAL.misordered, SAMPLE_PROCESS, rules);
    expect(fitted.slides[0].kind).toBe("title");
    expect(["summary", "questions"]).toContain(fitted.slides.at(-1)?.kind);
    const shown = fitted.slides
      .filter((item) => item.kind === "step" && item.stepId)
      .map((item) => item.stepId);
    expect([...new Set(shown)]).toEqual(
      SAMPLE_PROCESS.steps.map((step) => step.id),
    );
    const unknown = fitPlan(ADVERSARIAL.missingSteps, SAMPLE_PROCESS, rules);
    expect(unknown.slides.some((item) => item.stepId === "s99")).toBe(false);
  });

  it("keeps a plan that already passes as it is", () => {
    const plan = planFromProcess(SAMPLE_PROCESS, rules);
    expect(fitPlan(plan, SAMPLE_PROCESS, rules)).toEqual(plan);
  });

  it("follows the Rules it is given", () => {
    const tight = ruleSet(
      resolveRules({
        "content.max-bullets": { params: { max: 2 } },
        "content.bullet-length": { params: { maxWords: 8 } },
      }),
    );
    const fitted = fitPlan(ADVERSARIAL.overloaded, SAMPLE_PROCESS, tight);
    for (const item of fitted.slides) {
      expect(item.bullets.length).toBeLessThanOrEqual(2);
      for (const bullet of item.bullets)
        expect(wordCount(bullet)).toBeLessThanOrEqual(8);
    }
    const results = checkDeck(
      layoutDeck(fitted, SAMPLE_PROCESS, tight),
      fitted,
      SAMPLE_PROCESS,
      tight,
    );
    expect(blocking(results)).toEqual([]);
  });
});

/** The Processes the guarantee is held to: the sample, three real ones and 30 generated at and beyond real scale. */
const PROCESSES: [string, Process][] = [
  ["sample", SAMPLE_PROCESS],
  ...REAL_PROCESSES.map((process): [string, Process] => [
    `real: ${process.title}`,
    process,
  ]),
  ...Array.from({ length: 30 }, (_, index): [string, Process] => [
    `generated seed ${index + 1}`,
    generateProcess(index + 1),
  ]),
];

describe("the guarantee, at the scale of real Processes", () => {
  it("the generator reaches past real scale", () => {
    const generated = PROCESSES.slice(4).map(([, process]) => process);
    const most = (count: (process: Process) => number) =>
      Math.max(...generated.map(count));
    const words = (text: string | null) => (text ? wordCount(text) : 0);
    expect(most((process) => process.steps.length)).toBeGreaterThanOrEqual(11);
    expect(most((process) => process.roles.length)).toBeGreaterThanOrEqual(7);
    expect(most((process) => process.systems.length)).toBeGreaterThanOrEqual(6);
    expect(
      most((process) =>
        Math.max(...process.roles.map((role) => words(role.responsibility))),
      ),
    ).toBeGreaterThanOrEqual(28);
    expect(
      most((process) =>
        Math.max(...process.steps.map((step) => words(step.warning))),
      ),
    ).toBeGreaterThanOrEqual(40);
    expect(
      most((process) =>
        Math.max(
          0,
          ...process.steps.map((step) => step.decision?.branches.length ?? 0),
        ),
      ),
    ).toBe(4);
  });

  for (const [name, process] of PROCESSES) {
    it(`planFromProcess passes every blocking Check: ${name}`, () => {
      const plan = planFromProcess(process, rules);
      expect(describeFailures(plan, process)).toBe("");
    });

    it(`fitPlan of adversarial plans passes every blocking Check: ${name}`, () => {
      const plans = [
        ...Object.values(ADVERSARIAL),
        fuzzed(name.length * 7 + 3),
      ];
      for (const plan of plans) {
        const fitted = fitPlan(plan, process, rules);
        expect(describeFailures(fitted, process), `${plan.title}`).toBe("");
        expect(new Set(fitted.slides.map((item) => item.id)).size).toBe(
          fitted.slides.length,
        );
      }
    });
  }

  it("a plan inside every content Rule lays out without a layout failure, for every Process", () => {
    for (const [name, process] of PROCESSES) {
      // Four bullets of fourteen words on every slide that takes bullets.
      const bullet =
        "Check the employer number against the schedule and note any difference before posting";
      const plan: DeckPlan = {
        title: process.title.slice(0, 48),
        slides: [
          slide("p1", "title"),
          slide("p2", "overview", {
            bullets: [bullet, bullet, bullet, bullet],
          }),
          slide("p3", "roles"),
          ...process.steps.flatMap((step, index) => [
            slide(`p${index + 4}`, "step", {
              stepId: step.id,
              bullets: [bullet, bullet, bullet, bullet],
            }),
            ...(step.decision
              ? [slide(`d${index + 4}`, "decision", { stepId: step.id })]
              : []),
          ]),
          slide("e", "exceptions", {
            bullets: [bullet, bullet, bullet, bullet],
          }),
          slide("z", "summary", { bullets: [bullet, bullet, bullet, bullet] }),
        ],
      };
      expect(describeFailures(plan, process), name).toBe("");
    }
  });
});
