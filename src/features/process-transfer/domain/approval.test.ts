import { describe, expect, it } from "vitest";
import {
  decideApproval,
  exportRefusal,
  maxRounds,
  nextMove,
  processChecksUnder,
  roundPassed,
} from "./approval";
import type { Deck } from "./deck";
import {
  type CheckResult,
  type ReviewFinding,
  type RuleOverrides,
  resolveRules,
  ruleSet,
} from "./rules";
import type { DeckRound } from "./run";
import { SAMPLE_PROCESS } from "./test-fixtures";

const rules = (overrides: RuleOverrides = {}) =>
  ruleSet(resolveRules(overrides));

const check = (
  ruleId: string,
  passed: boolean,
  severity: "block" | "warn" = "block",
  failures: CheckResult["failures"] = [],
): CheckResult => ({
  ruleId,
  severity,
  passed,
  summary: passed ? "fine" : `${ruleId} failed`,
  failures,
});

const major: ReviewFinding = {
  target: "p3",
  severity: "major",
  issue: "Step 2 is missing the 50 MRD limit",
  fix: "Add it",
};
const minor: ReviewFinding = { ...major, severity: "minor" };

const deck = { title: "D", theme: {} as Deck["theme"], slides: [] } as Deck;
const deckWith = (ids: string[]): Deck => ({
  ...deck,
  slides: ids.map((id, index) => ({
    id: `s-${index}`,
    planId: id,
    kind: "step",
    stepId: null,
    background: "#fff",
    transition: { type: "fade", durationMs: 300 },
    elements: [],
    notes: "",
  })),
});

const round = (overrides: Partial<DeckRound>): DeckRound => ({
  round: 1,
  by: "draft",
  plan: { title: "D", slides: [] },
  deck,
  checks: [],
  findings: [],
  passed: true,
  ...overrides,
});

describe("roundPassed", () => {
  it("passes with only warnings and minor findings", () => {
    expect(
      roundPassed(
        [check("content.slide-count", false, "warn")],
        [minor],
        rules(),
      ),
    ).toBe(true);
  });

  it("fails on a blocking Check or a major finding", () => {
    expect(roundPassed([check("layout.text-fits", false)], [], rules())).toBe(
      false,
    );
    expect(roundPassed([], [major], rules())).toBe(false);
  });

  it("lets majors through when the reviewer only warns or is off", () => {
    expect(
      roundPassed(
        [],
        [major],
        rules({ "loop.reviewer": { severity: "warn" } }),
      ),
    ).toBe(true);
    expect(
      roundPassed([], [major], rules({ "loop.reviewer": { enabled: false } })),
    ).toBe(true);
  });
});

describe("nextMove", () => {
  const failing = [check("layout.text-fits", false)];

  it("approves a passed Round", () => {
    expect(
      nextMove({ round: 1, passed: true, checks: [], rules: rules() }),
    ).toBe("approve");
  });

  it("revises by model before the last Round, fits by rule into it", () => {
    expect(
      nextMove({ round: 1, passed: false, checks: failing, rules: rules() }),
    ).toBe("revise");
    expect(
      nextMove({ round: 2, passed: false, checks: failing, rules: rules() }),
    ).toBe("auto-fit");
    expect(
      nextMove({ round: 3, passed: false, checks: failing, rules: rules() }),
    ).toBe("hold");
  });

  it("revises by model into the last Round when only the reviewer objects", () => {
    expect(
      nextMove({ round: 2, passed: false, checks: [], rules: rules() }),
    ).toBe("revise");
  });

  it("revises when fitting by rule is off", () => {
    expect(
      nextMove({
        round: 2,
        passed: false,
        checks: failing,
        rules: rules({ "loop.auto-fit": { enabled: false } }),
      }),
    ).toBe("revise");
  });

  it("follows the Rounds Parameter", () => {
    const one = rules({ "loop.max-rounds": { params: { rounds: 1 } } });
    expect(maxRounds(one)).toBe(1);
    expect(
      nextMove({ round: 1, passed: false, checks: failing, rules: one }),
    ).toBe("hold");
    const two = rules({ "loop.max-rounds": { params: { rounds: 2 } } });
    expect(
      nextMove({ round: 1, passed: false, checks: failing, rules: two }),
    ).toBe("auto-fit");
  });
});

describe("decideApproval", () => {
  const at = "2026-11-17T10:00:00.000Z";

  it("approves a passed Round over a clean Process", () => {
    const approval = decideApproval({
      round: round({ round: 2, by: "revision" }),
      processChecks: [check("process.step-count", true)],
      rules: rules(),
      at,
    });
    expect(approval).toMatchObject({ status: "approved", round: 2, at });
  });

  it("holds and names the slide that still fails", () => {
    const approval = decideApproval({
      round: round({
        round: 3,
        deck: deckWith(["p1", "p2", "p3", "p4", "p5", "p6"]),
        checks: [
          check("layout.text-fits", false, "block", [
            { target: "p6", message: "Text does not fit its box" },
          ]),
        ],
        passed: false,
      }),
      processChecks: [],
      rules: rules(),
      at,
    });
    expect(approval.status).toBe("held");
    expect(approval.reason).toBe(
      'Round 3 still breaks "Text fits its box": text does not fit its box on slide 6.',
    );
  });

  it("holds a passing Deck when the Process has a blocking failure", () => {
    const approval = decideApproval({
      round: round({}),
      processChecks: [
        check("process.step-has-evidence", false, "block", [
          { target: "s4", message: "The step has no time in the Recording" },
        ]),
      ],
      rules: rules(),
      at,
    });
    expect(approval.status).toBe("held");
    expect(approval.reason).toContain("Every step points at the recording");
    expect(approval.reason).toContain("(s4)");
  });

  it("holds on a major finding while the reviewer blocks", () => {
    const approval = decideApproval({
      round: round({ findings: [major], deck: deckWith(["p1", "p2", "p3"]) }),
      processChecks: [],
      rules: rules(),
      at,
    });
    expect(approval.status).toBe("held");
    expect(approval.reason).toContain("on slide 3");
  });

  it("holds when there is no Deck", () => {
    expect(
      decideApproval({ round: null, processChecks: [], rules: rules(), at })
        .status,
    ).toBe("held");
  });
});

describe("decideApproval never approves a blocking failure", () => {
  const at = "2026-11-17T10:00:00.000Z";
  const deckFail = check("layout.text-fits", false);
  const processFail = check("process.step-has-evidence", false);
  const cases: {
    name: string;
    checks: CheckResult[];
    findings: ReviewFinding[];
    processChecks: CheckResult[];
    approved: boolean;
  }[] = [
    {
      name: "clean",
      checks: [],
      findings: [],
      processChecks: [],
      approved: true,
    },
    {
      name: "blocking Deck failure",
      checks: [deckFail],
      findings: [],
      processChecks: [],
      approved: false,
    },
    {
      name: "blocking Process failure",
      checks: [],
      findings: [],
      processChecks: [processFail],
      approved: false,
    },
    {
      name: "major finding",
      checks: [],
      findings: [major],
      processChecks: [],
      approved: false,
    },
    {
      name: "all three",
      checks: [deckFail],
      findings: [major],
      processChecks: [processFail],
      approved: false,
    },
    {
      name: "warnings and minor findings only",
      checks: [check("content.slide-count", false, "warn")],
      findings: [minor],
      processChecks: [check("process.step-length", false, "warn")],
      approved: true,
    },
  ];
  for (const item of cases) {
    it(item.name, () => {
      const approval = decideApproval({
        round: round({ checks: item.checks, findings: item.findings }),
        processChecks: item.processChecks,
        rules: rules(),
        at,
      });
      expect(approval.status === "approved").toBe(item.approved);
    });
  }
});

describe("decideApproval with no Deck gate", () => {
  const at = "2026-11-17T10:00:00.000Z";
  it("holds when no blocking Deck Check ran and the reviewer does not block", () => {
    for (const reviewer of [
      { enabled: false },
      { severity: "warn" as const },
    ]) {
      const approval = decideApproval({
        round: round({ checks: [check("content.slide-count", false, "warn")] }),
        processChecks: [],
        rules: rules({ "loop.reviewer": reviewer }),
        at,
      });
      expect(approval).toMatchObject({
        status: "held",
        reason:
          "No blocking Deck Rule was on, so nothing could approve this Deck.",
      });
    }
  });

  it("approves with one blocking Check that passed, reviewer off", () => {
    const approval = decideApproval({
      round: round({ checks: [check("layout.text-fits", true)] }),
      processChecks: [],
      rules: rules({ "loop.reviewer": { enabled: false } }),
      at,
    });
    expect(approval.status).toBe("approved");
  });

  it("approves on the blocking reviewer alone", () => {
    const approval = decideApproval({
      round: round({ checks: [] }),
      processChecks: [],
      rules: rules(),
      at,
    });
    expect(approval.status).toBe("approved");
  });
});

describe("processChecksUnder", () => {
  const at = "2026-11-17T10:00:00.000Z";
  const groundedPass: CheckResult = {
    ruleId: "process.grounded",
    severity: "block",
    passed: true,
    summary: "The reviewer found every step in the Recording",
    failures: [],
  };
  const unverb = {
    ...SAMPLE_PROCESS,
    steps: SAMPLE_PROCESS.steps.map((step, index) =>
      index === 0 ? { ...step, title: "The remittance list, filtered" } : step,
    ),
  };

  it("holds a Deck once a Process Rule the Run fails is raised to block", () => {
    const before = processChecksUnder({
      process: unverb,
      watch: null,
      grounding: groundedPass,
      rules: rules(),
    });
    const verb = before.find(
      (item) => item.ruleId === "process.step-starts-with-verb",
    );
    expect(verb).toMatchObject({ passed: false, severity: "warn" });

    const raised = rules({
      "process.step-starts-with-verb": { severity: "block" },
    });
    const after = processChecksUnder({
      process: unverb,
      watch: null,
      grounding: groundedPass,
      rules: raised,
    });
    const approval = decideApproval({
      round: round({}),
      processChecks: after,
      rules: raised,
      at,
    });
    expect(approval.status).toBe("held");
    expect(approval.reason).toContain("Steps read as instructions");
  });

  it("keeps the stored grounding with the Rule's current severity", () => {
    const failed = { ...groundedPass, passed: false };
    const checks = processChecksUnder({
      process: SAMPLE_PROCESS,
      watch: null,
      grounding: failed,
      rules: rules({ "process.grounded": { severity: "warn" } }),
    });
    expect(checks.at(-1)).toMatchObject({
      ruleId: "process.grounded",
      passed: false,
      severity: "warn",
    });
  });

  it("fails the grounding when nothing checked it under these Rules", () => {
    const checks = processChecksUnder({
      process: SAMPLE_PROCESS,
      watch: null,
      grounding: null,
      rules: rules(),
    });
    expect(checks.at(-1)).toMatchObject({
      ruleId: "process.grounded",
      passed: false,
      severity: "block",
      summary:
        "The steps were not checked against the Recording under these Rules",
    });
  });

  it("uses the stored grounding again once the Rule is back on", () => {
    const off = rules({ "process.grounded": { enabled: false } });
    const withOff = processChecksUnder({
      process: SAMPLE_PROCESS,
      watch: null,
      grounding: groundedPass,
      rules: off,
    });
    expect(withOff.some((item) => item.ruleId === "process.grounded")).toBe(
      false,
    );
    // The stored grounding is an input, not read back from the list above.
    const backOn = processChecksUnder({
      process: SAMPLE_PROCESS,
      watch: null,
      grounding: groundedPass,
      rules: rules(),
    });
    expect(backOn.at(-1)).toMatchObject({
      ruleId: "process.grounded",
      passed: true,
    });
  });

  it("leaves the grounding out when its Rule is off", () => {
    const checks = processChecksUnder({
      process: SAMPLE_PROCESS,
      watch: null,
      grounding: groundedPass,
      rules: rules({ "process.grounded": { enabled: false } }),
    });
    expect(checks.some((item) => item.ruleId === "process.grounded")).toBe(
      false,
    );
  });
});

describe("exportRefusal", () => {
  const table: [
    "docx" | "pptx",
    "approved" | "held" | null,
    boolean,
    boolean,
  ][] = [
    ["docx", null, true, true],
    ["docx", "held", true, true],
    ["docx", "approved", true, true],
    ["pptx", null, true, false],
    ["pptx", "held", true, false],
    ["pptx", "approved", true, true],
    ["docx", null, false, false],
    ["pptx", "approved", false, false],
  ];
  for (const [kind, approval, hasProcess, allowed] of table) {
    it(`${kind} with approval ${approval} and${hasProcess ? "" : " no"} Process`, () => {
      expect(exportRefusal(kind, { hasProcess, approval }) === null).toBe(
        allowed,
      );
    });
  }
  it("refuses anything but DOCX and PPTX", () => {
    expect(
      exportRefusal("exe", { hasProcess: true, approval: "approved" }),
    ).toBe("Pick a DOCX or a PPTX.");
  });
});
