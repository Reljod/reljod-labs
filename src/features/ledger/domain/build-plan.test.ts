import { describe, expect, it } from "vitest";
import {
  createStepValidator,
  cutBlock,
  finalizePlan,
  MAX_TOSSES,
  matchExcerpt,
  type PlanStep,
} from "./build-plan";
import { contentTree } from "./content-tree";
import { sourcePath } from "./source-paths";

const MAYA = 3;
const KYC_POINT = sourcePath.jobPoint(MAYA, 0);

const step = (overrides: Partial<PlanStep> = {}): PlanStep => ({
  action: "fetch",
  source: sourcePath.job(MAYA),
  excerpt: null,
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
    writeup: [{ text: "He spent three years at Maya.", cites: [1] }],
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
    const plan = finalizePlan({ ...raw, verdict: "not_found" });
    expect(plan.steps).toEqual([]);
    expect(plan.writeup).toEqual([]);
  });
});

describe("the Write-up", () => {
  const raw = {
    verdict: "answer" as const,
    title: "KYC",
    layout: "figures" as const,
    answer: "He cut KYC cost by 90%.",
  };

  it("renumbers citations to the fetches that were kept, skipping tosses", () => {
    const plan = finalizePlan({
      ...raw,
      steps: [
        step({ action: "toss", source: sourcePath.job(4) }),
        step({ source: "made.up" }),
        step(),
        step({ source: sourcePath.job(0) }),
      ],
      writeup: [
        { text: "  He worked at   Maya. ", cites: [2, 2] },
        { text: "Then he consulted.", cites: [3, 1] },
      ],
    });
    expect(plan.writeup).toEqual([
      { text: "He worked at Maya.", cites: [1] },
      { text: "Then he consulted.", cites: [2] },
    ]);
  });

  it("drops a sentence that only cites a piece the site never says", () => {
    const plan = finalizePlan({
      ...raw,
      steps: [
        step({ source: KYC_POINT, excerpt: "90% lower KYC operating cost" }),
        step({ source: KYC_POINT, excerpt: "99% lower fraud losses" }),
      ],
      writeup: [
        { text: "He cut KYC cost by 90%.", cites: [1] },
        { text: "He cut fraud losses by 99%.", cites: [2] },
      ],
    });
    expect(plan.writeup.map((sentence) => sentence.text)).toEqual([
      "He cut KYC cost by 90%.",
    ]);
  });

  it("falls back to the chat answer, citing every block, when nothing is usable", () => {
    const plan = finalizePlan({
      ...raw,
      steps: [step(), step({ source: sourcePath.job(0) })],
      writeup: [{ text: "Uncited.", cites: [] }],
    });
    expect(plan.writeup).toEqual([
      { text: "He cut KYC cost by 90%.", cites: [1, 2] },
    ]);
  });

  it("gives a stored plan from before the Write-up one from its answer", () => {
    const { writeup: _none, ...old } = {
      ...raw,
      steps: [step()],
      writeup: [],
    };
    expect(
      finalizePlan(old as Parameters<typeof finalizePlan>[0]).writeup,
    ).toEqual([{ text: "He cut KYC cost by 90%.", cites: [1] }]);
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
