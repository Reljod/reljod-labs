import { describe, expect, it } from "vitest";
import {
  createStepValidator,
  cutBlock,
  finalizePlan,
  MAX_TOSSES,
  matchExcerpt,
  type PlanStep,
  sentenceJoins,
} from "./build-plan";
import { contentTree } from "./content-tree";
import { sourcePath } from "./source-paths";

const MAYA = 3;
const KYC_POINT = sourcePath.jobPoint(MAYA, 0);

const step = (overrides: Partial<PlanStep> = {}): PlanStep => ({
  action: "fetch",
  source: sourcePath.job(MAYA),
  excerpt: null,
  join: "He worked as",
  pace: "trot",
  line: "Got it!",
  ...overrides,
});

describe("matchExcerpt", () => {
  const text =
    "Partnered with data science to replace a costly third-party KYC vendor with an in-house AI solution: 90% lower KYC operating cost, +7 pts approval rate, +8 pts automation rate.";

  it("returns the site's own words for an exact excerpt", () => {
    expect(matchExcerpt(text, "90% lower KYC operating cost")).toBe(
      "90% lower KYC operating cost",
    );
  });

  it("tolerates spacing, trailing punctuation and dash or quote styles", () => {
    expect(matchExcerpt(text, "  +8 pts   automation rate. ")).toBe(
      "+8 pts automation rate",
    );
    expect(matchExcerpt("Jul 2026 – Present", "Jul 2026 - Present")).toBe(
      "Jul 2026 – Present",
    );
  });

  it("rejects changed words and fragments too short to mean anything", () => {
    expect(matchExcerpt(text, "95% lower KYC operating cost")).toBeNull();
    expect(matchExcerpt(text, "KYC")).toBeNull();
  });
});

describe("createStepValidator", () => {
  it("keeps a real source and drops an invented one", () => {
    const validate = createStepValidator();
    expect(validate(step())?.source).toBe(sourcePath.job(MAYA));
    expect(validate(step({ source: "experience.99" }))).toBeNull();
  });

  it("keeps a verbatim excerpt and drops one the site never says", () => {
    const validate = createStepValidator();
    expect(
      validate(
        step({ source: KYC_POINT, excerpt: "90% lower KYC operating cost" }),
      )?.excerpt,
    ).toBe("90% lower KYC operating cost");
    expect(
      validate(
        step({ source: KYC_POINT, excerpt: "99% lower KYC operating cost" }),
      ),
    ).toBeNull();
  });

  it("ignores an excerpt on a piece that is only taken whole", () => {
    const validate = createStepValidator();
    expect(
      validate(step({ excerpt: "Senior Software Engineer" }))?.excerpt,
    ).toBeNull();
  });

  it("drops repeats and tosses past the limit", () => {
    const validate = createStepValidator();
    expect(validate(step())).not.toBeNull();
    expect(validate(step())).toBeNull();
    for (let index = 0; index < MAX_TOSSES; index++) {
      expect(
        validate(step({ action: "toss", source: sourcePath.highlight(index) })),
      ).not.toBeNull();
    }
    expect(
      validate(step({ action: "toss", source: sourcePath.highlight(3) })),
    ).toBeNull();
  });

  it("drops a piece inside one already placed, and one around it", () => {
    const validate = createStepValidator();
    expect(validate(step({ source: sourcePath.project(1) }))).not.toBeNull();
    expect(validate(step({ source: sourcePath.projectOutcome(1) }))).toBeNull();
    expect(
      validate(step({ source: KYC_POINT, excerpt: "+7 pts approval rate" })),
    ).not.toBeNull();
    expect(
      validate(step({ source: KYC_POINT, excerpt: "+8 pts automation rate" })),
    ).not.toBeNull();
    expect(validate(step({ source: sourcePath.job(MAYA) }))).toBeNull();
  });

  it("treats an excerpt of the whole sentence as the whole piece", () => {
    const node = contentTree.get(KYC_POINT);
    if (!node || node.block.kind !== "quote")
      throw new Error("missing KYC point");
    const sentence = node.block.text.replace(/\.$/, "");
    expect(
      validate1(step({ source: KYC_POINT, excerpt: sentence }))?.excerpt,
    ).toBeNull();
  });

  it("trims long lines", () => {
    const line = validate1(step({ line: "word ".repeat(40) }))?.line ?? "";
    expect(line.length).toBeLessThanOrEqual(60);
    expect(line.endsWith("…")).toBe(true);
  });
});

function validate1(planStep: PlanStep) {
  return createStepValidator()(planStep);
}

describe("finalizePlan", () => {
  const raw = {
    verdict: "answer" as const,
    title: "Where Reljod has worked",
    layout: "timeline" as const,
    answer: "Six roles.",
    steps: [step()],
  };

  it("keeps an answer that places at least one block", () => {
    expect(finalizePlan(raw).verdict).toBe("answer");
  });

  it("turns a plan with nothing valid to fetch into Not found", () => {
    const plan = finalizePlan({
      ...raw,
      steps: [
        step({ source: "made.up" }),
        step({ action: "toss", source: sourcePath.highlight(0) }),
      ],
    });
    expect(plan.verdict).toBe("not_found");
    expect(plan.steps).toEqual([]);
  });

  it("drops every step when the model says not_found", () => {
    expect(finalizePlan({ ...raw, verdict: "not_found" }).steps).toEqual([]);
  });
});

describe("cutBlock", () => {
  it("cuts a quote down to its excerpt", () => {
    const node = contentTree.get(KYC_POINT);
    if (!node) throw new Error("missing KYC point");
    expect(cutBlock(node, "data science to replace a costly")).toMatchObject({
      kind: "quote",
      text: "data science to replace a costly",
      context: "Senior Software Engineer · Maya Philippines, Inc.",
    });
  });

  it("reads an excerpt that opens with a number as a figure", () => {
    const node = contentTree.get(KYC_POINT);
    if (!node) throw new Error("missing KYC point");
    expect(cutBlock(node, "+7 pts approval rate")).toEqual({
      kind: "figure",
      figure: "+7 pts",
      label: "approval rate",
      context: "Senior Software Engineer · Maya Philippines, Inc.",
    });
    expect(cutBlock(node, "90% lower KYC operating cost")).toMatchObject({
      figure: "90%",
      label: "lower KYC operating cost",
    });
  });

  it("takes a whole piece as it is", () => {
    const node = contentTree.get(sourcePath.job(MAYA));
    if (!node) throw new Error("missing job");
    expect(cutBlock(node, null)).toBe(node.block);
  });
});

describe("Joins", () => {
  it("keeps a fetch's linking words, tidied", () => {
    const validate = createStepValidator();
    expect(validate(step({ join: "  after   that " }))?.join).toBe(
      "after that",
    );
  });

  it("drops a Join that carries a number or runs too long, and any on a toss", () => {
    const validate = createStepValidator();
    expect(validate(step({ join: "after 3 years as" }))?.join).toBe("");
    expect(
      validate(
        step({
          source: sourcePath.job(0),
          join: "and this is a very long run of words that is no longer a join at all",
        }),
      )?.join,
    ).toBe("");
    expect(
      validate(step({ source: sourcePath.job(4), action: "toss" }))?.join,
    ).toBe("");
  });

  it("reads a stored plan from before Joins as empty Joins", () => {
    const { join: _, ...old } = step();
    const plan = finalizePlan({
      verdict: "answer",
      title: "Old",
      layout: "timeline",
      answer: "Old answer.",
      steps: [old as PlanStep],
    });
    expect(plan.steps[0].join).toBe("");
  });

  it("falls back to list words where a Join is missing", () => {
    expect(sentenceJoins(["", "", ""])).toEqual(["", ",", "and"]);
    expect(sentenceJoins(["Reljod is now", "", "and before that"])).toEqual([
      "Reljod is now",
      ",",
      "and before that",
    ]);
    expect(sentenceJoins(["", ""])).toEqual(["", "and"]);
  });
});
