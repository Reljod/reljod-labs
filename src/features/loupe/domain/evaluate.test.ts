import { describe, expect, it } from "vitest";
import type { Box, Hypothesis, Measurement } from "./contract";
import {
  decide,
  doneGate,
  effectiveValue,
  evaluate,
  iou,
  testedByExaminer,
  touches,
  trips,
} from "./evaluate";
import {
  DEFAULT_RULEBOOK,
  diffRulebooks,
  parseRulebook,
  type Rulebook,
  withRule,
} from "./rules";
import { scoreExamination, tampersOfEdits } from "./score";

const BOX: Box = [0.6, 0.4, 0.8, 0.45];

function m(
  patch: Partial<Measurement> & Pick<Measurement, "metric" | "value">,
): Measurement {
  return {
    id: "s1",
    page: 1,
    box: BOX,
    detail: "measured",
    facts: {},
    layer: null,
    layerKind: null,
    finder: "sweep",
    check: "ela",
    runId: "sweep",
    ...patch,
  };
}

const run = (
  measurements: Measurement[],
  rulebook: Rulebook = DEFAULT_RULEBOOK,
) => {
  const findings = evaluate({ measurements, kind: "payslip", rulebook });
  return { findings, verdict: decide(findings, rulebook) };
};

describe("boxes", () => {
  it("measures overlap", () => {
    expect(iou(BOX, BOX)).toBe(1);
    expect(iou(BOX, [0, 0, 0.1, 0.1])).toBe(0);
    expect(touches(BOX, [0.79, 0.44, 0.9, 0.5])).toBe(true);
    expect(touches(BOX, [0, 0, 0.1, 0.1])).toBe(false);
  });
});

describe("a Rule can fail", () => {
  it("makes no Finding under the threshold and one at it", () => {
    const threshold = DEFAULT_RULEBOOK.rules["image.ela_ratio"].threshold;
    expect(
      run([m({ metric: "image.ela_ratio", value: threshold - 0.01 })]).findings,
    ).toEqual([]);
    const at = run([m({ metric: "image.ela_ratio", value: threshold })]);
    expect(at.findings).toHaveLength(1);
    expect(at.findings[0].weight).toBe("supporting");
    expect(at.findings[0].confidence).toBe(0.5);
    expect(at.verdict.verdict).toBe("suspicious");
  });

  it("ignores a Rule that is off or not for this Document kind", () => {
    const item = m({
      metric: "arith.balance_break",
      value: 500,
      check: "arithmetic",
    });
    // The balance Rule is for statements, not payslips.
    expect(trips(item, "payslip", DEFAULT_RULEBOOK).tripped).toBe(false);
    expect(trips(item, "bank_statement", DEFAULT_RULEBOOK).tripped).toBe(true);
    const off = withRule(DEFAULT_RULEBOOK, "arith.balance_break", {
      enabled: false,
    });
    expect(trips(item, "bank_statement", off).tripped).toBe(false);
  });
});

describe("the Verdict is the Rulebook's", () => {
  it("is Genuine with nothing, or with context only", () => {
    expect(run([]).verdict.verdict).toBe("genuine");
    const gap = run([
      m({
        metric: "pdf.modified_gap_hours",
        value: 300,
        box: null,
        page: 0,
        check: "pdf_structure",
      }),
    ]);
    expect(gap.findings[0].weight).toBe("context");
    expect(gap.verdict.verdict).toBe("genuine");
  });

  it("is Tampered on one decisive Finding", () => {
    const result = run([
      m({ metric: "arith.sum_mismatch", value: 2400, check: "arithmetic" }),
    ]);
    expect(result.verdict.verdict).toBe("tampered");
    expect(result.verdict.decisive).toBe(1);
    expect(result.findings[0].confidence).toBe(0.95);
  });

  it("is Tampered at the Policy's count of supporting Findings, Suspicious below it", () => {
    const two = [
      m({ id: "s1", metric: "image.ela_ratio", value: 6 }),
      m({ id: "s2", metric: "image.noise_ratio", value: 6, check: "noise" }),
    ];
    expect(run(two).verdict.verdict).toBe("tampered");
    const strict: Rulebook = {
      ...DEFAULT_RULEBOOK,
      policy: { ...DEFAULT_RULEBOOK.policy, tamperedAtSupporting: 3 },
    };
    expect(run(two, strict).verdict.verdict).toBe("suspicious");
  });

  it("folds Measurements of one Metric on one place into one Finding", () => {
    const result = run([
      m({ id: "s1", metric: "image.ela_ratio", value: 4 }),
      m({ id: "m1", metric: "image.ela_ratio", value: 7, finder: "examiner" }),
    ]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].id).toBe("m1");
    expect(result.findings[0].foundBy.sort()).toEqual(["examiner", "sweep"]);
    expect(result.verdict.verdict).toBe("suspicious");
  });
});

describe("what is benign", () => {
  it("treats a pixel effect across the page as a re-save", () => {
    const whole = run([
      m({ metric: "image.ela_ratio", value: 9, box: [0, 0, 1, 0.9] }),
    ]);
    expect(whole.findings[0].weight).toBe("context");
    expect(whole.verdict.verdict).toBe("genuine");
  });

  it("decides the producer from the Rulebook's lists, not the Toolkit's", () => {
    const by = (producer: string, value: number) =>
      m({
        metric: "pdf.editor_producer",
        value,
        page: 0,
        box: null,
        check: "pdf_structure",
        facts: { producer },
      });
    expect(
      effectiveValue(by("Meridia PDF Editor 4.2", 0), DEFAULT_RULEBOOK),
    ).toBe(1);
    expect(
      effectiveValue(by("Meridia Office Print to PDF", 1), DEFAULT_RULEBOOK),
    ).toBe(0);
    expect(effectiveValue(by("Tidewater Payroll 9", 1), DEFAULT_RULEBOOK)).toBe(
      0,
    );
    const own: Rulebook = {
      ...DEFAULT_RULEBOOK,
      policy: { ...DEFAULT_RULEBOOK.policy, editors: ["Tidewater Payroll"] },
    };
    expect(effectiveValue(by("Tidewater Payroll 9", 0), own)).toBe(1);
  });
});

describe("the Examiner's own code", () => {
  const own = m({
    id: "m1",
    metric: "arith.sum_mismatch",
    value: 100,
    finder: "examiner",
    check: null,
  });

  it("counts as supporting at most unless the Policy says otherwise", () => {
    expect(run([own]).findings[0].weight).toBe("supporting");
    expect(run([own]).verdict.verdict).toBe("suspicious");
    const allowed: Rulebook = {
      ...DEFAULT_RULEBOOK,
      policy: { ...DEFAULT_RULEBOOK.policy, ownCodeDecisive: true },
    };
    expect(run([own], allowed).verdict.verdict).toBe("tampered");
  });

  it("links a supported Hypothesis to its Finding", () => {
    const hypothesis: Hypothesis = {
      id: "h1",
      page: 1,
      box: BOX,
      claim: "Net pay sits low",
      status: "supported",
      measurementIds: ["m1"],
      explanation: "The lines sum to less than the printed total.",
      confidence: 0.8,
    };
    const [finding] = evaluate({
      measurements: [own],
      hypotheses: [hypothesis],
      kind: "payslip",
      rulebook: DEFAULT_RULEBOOK,
    });
    expect(finding.hypothesisId).toBe("h1");
    expect(finding.note).toContain("lines sum");
  });

  it("must test a decisive Finding's place before reviewing it", () => {
    const [finding] = run([
      m({ metric: "arith.sum_mismatch", value: 50, check: "arithmetic" }),
    ]).findings;
    expect(testedByExaminer(finding, [])).toBe(false);
    expect(
      testedByExaminer(finding, [
        m({
          id: "m2",
          metric: "image.noise_ratio",
          value: 1,
          finder: "examiner",
          box: [0, 0, 0.1, 0.1],
        }),
      ]),
    ).toBe(false);
    expect(
      testedByExaminer(finding, [
        m({
          id: "m3",
          metric: "image.noise_ratio",
          value: 1,
          finder: "examiner",
        }),
      ]),
    ).toBe(true);
  });
});

describe("the Done gate", () => {
  const sweepFinding = run([
    m({ metric: "arith.sum_mismatch", value: 50, check: "arithmetic" }),
  ]).findings;

  it("stays shut until pages are looked at, Findings reviewed and Hypotheses settled", () => {
    const open = doneGate({
      pagesTotal: 2,
      pagesLooked: [1],
      findings: sweepFinding,
      hypotheses: [],
    });
    expect(open).toMatchObject({
      pagesLooked: 1,
      findingsOpen: 1,
      passed: false,
    });
    const reviewed = evaluate({
      measurements: [
        m({ metric: "arith.sum_mismatch", value: 50, check: "arithmetic" }),
      ],
      reviews: { s1: { stance: "agree", note: "It does not add up." } },
      kind: "payslip",
      rulebook: DEFAULT_RULEBOOK,
    });
    expect(
      doneGate({
        pagesTotal: 2,
        pagesLooked: [1, 2, 2, 9],
        findings: reviewed,
        hypotheses: [],
      }).passed,
    ).toBe(true);
    const pending: Hypothesis = {
      id: "h1",
      page: 1,
      box: null,
      claim: "Something",
      status: "open",
      measurementIds: [],
      explanation: null,
      confidence: null,
    };
    expect(
      doneGate({
        pagesTotal: 2,
        pagesLooked: [1, 2],
        findings: reviewed,
        hypotheses: [pending],
      }).passed,
    ).toBe(false);
  });
});

describe("the Rulebook is checked where it is saved", () => {
  it("refuses a threshold outside its bounds, an unknown Weight and an upside-down Policy", () => {
    expect(parseRulebook(DEFAULT_RULEBOOK).ok).toBe(true);
    expect(
      parseRulebook(
        withRule(DEFAULT_RULEBOOK, "image.ela_ratio", { threshold: 0.5 }),
      ).ok,
    ).toBe(false);
    expect(
      parseRulebook(
        withRule(DEFAULT_RULEBOOK, "image.ela_ratio", {
          weight: "certain" as never,
        }),
      ).ok,
    ).toBe(false);
    expect(
      parseRulebook({
        ...DEFAULT_RULEBOOK,
        policy: {
          ...DEFAULT_RULEBOOK.policy,
          suspiciousAtSupporting: 5,
          tamperedAtSupporting: 2,
        },
      }).ok,
    ).toBe(false);
    expect(parseRulebook({ rules: {}, policy: {} }).ok).toBe(false);
  });

  it("says what changed between versions", () => {
    expect(diffRulebooks(DEFAULT_RULEBOOK, DEFAULT_RULEBOOK)).toEqual([]);
    const next = withRule(DEFAULT_RULEBOOK, "image.noise_ratio", {
      threshold: 4,
      weight: "decisive",
    });
    expect(diffRulebooks(DEFAULT_RULEBOOK, next)).toEqual([
      "Noise against the page: threshold 2.36 → 4",
      "Noise against the page: supporting → decisive",
    ]);
  });
});

describe("scoring against what was really done", () => {
  const tamper = { type: "pasted_patch" as const, page: 1, box: BOX };

  it("counts a Finding on the Tamper as a catch and one elsewhere as false", () => {
    const { findings, verdict } = run([
      m({ id: "s1", metric: "image.noise_ratio", value: 6, check: "noise" }),
      m({
        id: "s2",
        metric: "image.ela_ratio",
        value: 6,
        box: [0.1, 0.1, 0.2, 0.15],
      }),
    ]);
    const score = scoreExamination({
      tampers: [tamper],
      findings,
      verdict: verdict.verdict,
    });
    expect(score).toMatchObject({
      truth: "tampered",
      correct: true,
      caught: 1,
      falseFindings: 1,
    });
  });

  it("calls any counted Finding on a genuine Document false, and a clean one right", () => {
    const flagged = run([
      m({ metric: "image.noise_ratio", value: 6, check: "noise" }),
    ]);
    expect(
      scoreExamination({
        tampers: [],
        findings: flagged.findings,
        verdict: flagged.verdict.verdict,
      }),
    ).toMatchObject({ truth: "genuine", correct: false, falseFindings: 1 });
    expect(
      scoreExamination({ tampers: [], findings: [], verdict: "genuine" })
        .correct,
    ).toBe(true);
  });

  it("lets an arithmetic Finding answer for a changed amount lines away", () => {
    const { findings, verdict } = run([
      m({
        metric: "arith.sum_mismatch",
        value: 100,
        check: "arithmetic",
        box: [0.6, 0.8, 0.8, 0.85],
      }),
    ]);
    const amount = { ...tamper, type: "text_edit" as const, to: "7,380.00" };
    const name = {
      ...tamper,
      type: "payee_change" as const,
      to: "Edda Marchetti",
    };
    expect(
      scoreExamination({
        tampers: [amount],
        findings,
        verdict: verdict.verdict,
      }).caught,
    ).toBe(1);
    expect(
      scoreExamination({ tampers: [name], findings, verdict: verdict.verdict })
        .caught,
    ).toBe(0);
  });

  it("turns a Forgery's Edits into Tampers", () => {
    expect(
      tampersOfEdits([{ kind: "text", page: 1, box: BOX, to: "9,000.00" }]),
    ).toEqual([
      {
        type: "browser_edit",
        page: 1,
        box: BOX,
        field: "text",
        to: "9,000.00",
      },
    ]);
  });
});
