import { describe, expect, it } from "vitest";
import type { Process, Watch } from "./process";
import { checkProcess, groundedCheck, startsWithVerb } from "./process-checks";
import type { CheckResult, RuleOverrides } from "./rules";
import { RULES, resolveRules, ruleSet } from "./rules";
import { SAMPLE_PROCESS } from "./test-fixtures";

const watch = (durationSeconds = 600): Watch => ({
  title: "Month-end",
  durationSeconds,
  participants: [],
  observations: [],
});

const rulesWith = (overrides: RuleOverrides = {}) =>
  ruleSet(resolveRules(overrides));

const edit = (patch: (copy: Process) => void): Process => {
  const copy = structuredClone(SAMPLE_PROCESS);
  patch(copy);
  return copy;
};

const result = (results: CheckResult[], ruleId: string) => {
  const found = results.find((item) => item.ruleId === ruleId);
  if (!found) throw new Error(`no result for ${ruleId}`);
  return found;
};

const run = (process: Process, overrides?: RuleOverrides, w = watch()) =>
  checkProcess(process, w, rulesWith(overrides));

describe("checkProcess", () => {
  it("passes every Check on a good Process, in RULES order, without grounded", () => {
    const results = run(SAMPLE_PROCESS);
    const expected = RULES.filter(
      (item) => item.group === "process" && item.id !== "process.grounded",
    ).map((item) => item.id);
    expect(results.map((item) => item.ruleId)).toEqual(expected);
    for (const item of results) {
      expect(item.passed, `${item.ruleId}: ${item.summary}`).toBe(true);
      expect(item.failures).toEqual([]);
    }
    expect(result(results, "process.step-has-actor").summary).toBe(
      "All 9 steps name who does them",
    );
  });

  it("gives no result for a disabled Rule and carries an edited severity", () => {
    const results = run(SAMPLE_PROCESS, {
      "process.step-length": { enabled: false },
      "process.step-count": { severity: "warn" },
    });
    expect(results.some((item) => item.ruleId === "process.step-length")).toBe(
      false,
    );
    expect(result(results, "process.step-count").severity).toBe("warn");
  });

  it("fails without a purpose or a trigger", () => {
    const failed = result(
      run(
        edit((p) => {
          p.trigger = "  ";
        }),
      ),
      "process.purpose-and-trigger",
    );
    expect(failed.passed).toBe(false);
    expect(failed.summary).toBe("The Process has no trigger");
  });

  it("step count follows its Parameters", () => {
    expect(result(run(SAMPLE_PROCESS), "process.step-count").passed).toBe(true);
    const tight = result(
      run(SAMPLE_PROCESS, { "process.step-count": { params: { max: 8 } } }),
      "process.step-count",
    );
    expect(tight.passed).toBe(false);
    expect(tight.failures[0].message).toContain("at most 8");
    const few = result(
      run(
        edit((p) => {
          p.steps = p.steps.slice(0, 2);
        }),
      ),
      "process.step-count",
    );
    expect(few.passed).toBe(false);
  });

  it("names the step whose actor is not a listed role, tolerating case and 'the'", () => {
    const process = edit((p) => {
      p.steps[1].actor = "the pensions officers";
      p.steps[3].actor = "Compliance Analyst";
      p.steps[5].actor = "";
    });
    const failed = result(run(process), "process.step-has-actor");
    expect(failed.passed).toBe(false);
    expect(failed.failures.map((item) => item.target)).toEqual(["s4", "s6"]);
    expect(failed.summary).toBe("2 of 9 steps have no listed role");
  });

  it("flags titles that do not start with a verb or are too long", () => {
    const process = edit((p) => {
      p.steps[2].title = "Reconciliation of the remittances";
      p.steps[4].title =
        "Decide how to treat each variance found during the matching run";
    });
    const failed = result(run(process), "process.step-starts-with-verb");
    expect(failed.passed).toBe(false);
    expect(failed.severity).toBe("warn");
    expect(failed.failures.map((item) => item.target)).toEqual(["s3", "s5"]);
    expect(failed.failures[1].message).toContain("11 words (at most 8)");
    const relaxed = result(
      run(process, {
        "process.step-starts-with-verb": { params: { maxWords: 12 } },
      }),
      "process.step-starts-with-verb",
    );
    expect(relaxed.failures.map((item) => item.target)).toEqual(["s3"]);
  });

  it("needs a time inside the Recording for every step", () => {
    const process = edit((p) => {
      p.steps[6].at = Number.NaN;
      p.steps[8].at = 700;
    });
    const failed = result(run(process), "process.step-has-evidence");
    expect(failed.passed).toBe(false);
    expect(failed.failures.map((item) => item.target)).toEqual(["s7", "s9"]);
    expect(failed.summary).toBe("2 of 9 steps have no time in the Recording");
    // Without a known duration, only the missing time fails.
    const unknown = result(
      checkProcess(process, null, rulesWith()),
      "process.step-has-evidence",
    );
    expect(unknown.failures.map((item) => item.target)).toEqual(["s7"]);
    // Within the tolerance of the end is fine.
    const atEnd = result(
      run(
        edit((p) => {
          p.steps[8].at = 601;
        }),
        undefined,
        watch(600),
      ),
      "process.step-has-evidence",
    );
    expect(atEnd.passed).toBe(true);
  });

  it("fails when every step sits at 0", () => {
    const process = edit((p) => {
      for (const step of p.steps) step.at = 0;
    });
    const failed = result(run(process), "process.step-has-evidence");
    expect(failed.passed).toBe(false);
    expect(failed.failures).toHaveLength(6);
    expect(failed.summary).toContain("All 9 steps point at 0:00");
  });

  it("orders steps by the tolerance Parameter", () => {
    const process = edit((p) => {
      p.steps[4].at = 200;
    }); // s4 is at 214
    expect(result(run(process), "process.steps-in-order").passed).toBe(true);
    const strict = result(
      run(process, {
        "process.steps-in-order": { params: { toleranceSeconds: 10 } },
      }),
      "process.steps-in-order",
    );
    expect(strict.passed).toBe(false);
    expect(strict.failures[0].target).toBe("s5");
  });

  it("limits instruction words by its Parameter", () => {
    const process = edit((p) => {
      p.steps[0].action = Array(70).fill("word").join(" ");
    });
    const failed = result(run(process), "process.step-length");
    expect(failed.failures.map((item) => item.target)).toEqual(["s1"]);
    expect(
      result(
        run(process, { "process.step-length": { params: { maxWords: 80 } } }),
        "process.step-length",
      ).passed,
    ).toBe(true);
  });

  it("wants every system a step uses listed", () => {
    const process = edit((p) => {
      p.steps[1].system = "pensionpro (Reconciliation)";
      p.steps[2].system = "The PensionPro";
      p.steps[5].system = "SharePoint";
    });
    const failed = result(run(process), "process.systems-named");
    expect(failed.failures.map((item) => item.target)).toEqual(["s6"]);
  });

  it("wants decisions with enough complete branches", () => {
    const process = edit((p) => {
      const decision = p.steps[6].decision;
      if (decision) {
        // biome-ignore lint/suspicious/noThenProperty: "then" is a branch's outcome in the Process, never awaited.
        decision.branches[1] = { ...decision.branches[1], then: "" };
      }
    });
    const failed = result(run(process), "process.decisions-have-branches");
    expect(failed.passed).toBe(false);
    expect(failed.failures.map((item) => item.target)).toEqual(["s7"]);
    const three = result(
      run(SAMPLE_PROCESS, {
        "process.decisions-have-branches": { params: { minBranches: 3 } },
      }),
      "process.decisions-have-branches",
    );
    expect(three.failures.map((item) => item.target)).toEqual(["s5", "s7"]);
  });

  it("lists at most six failures but counts them all", () => {
    const process = edit((p) => {
      for (const step of p.steps) step.actor = "Nobody";
    });
    const failed = result(run(process), "process.step-has-actor");
    expect(failed.failures).toHaveLength(6);
    expect(failed.summary).toBe("9 of 9 steps have no listed role");
  });
});

describe("startsWithVerb", () => {
  it.each([
    "Open the remittance",
    "Log variances in the Case Log",
    "Re-run the matching",
    "Double-check the totals",
    "Triage the queue",
    "Process the refunds",
    "Email the Team Lead",
  ])("accepts %s", (title) => expect(startsWithVerb(title)).toBe(true));

  it.each([
    "The statement is downloaded",
    "Reconciliation of remittances",
    "Downloading the statement",
    "Downloaded the statement",
    "Opens the portal",
    "PensionPro import",
    "CSV export",
    "1. Open the portal",
    "Month-end close",
    "Approval by the Team Lead",
    "",
  ])("rejects %s", (title) => expect(startsWithVerb(title)).toBe(false));
});

describe("groundedCheck", () => {
  const rule = rulesWith().get("process.grounded");

  it("is null when the Rule is missing or disabled", () => {
    expect(groundedCheck([], undefined)).toBeNull();
    expect(
      groundedCheck(
        [],
        rulesWith({ "process.grounded": { enabled: false } }).get(
          "process.grounded",
        ),
      ),
    ).toBeNull();
  });

  it("passes with no findings", () => {
    const outcome = groundedCheck([], rule);
    expect(outcome?.passed).toBe(true);
    expect(outcome?.severity).toBe("block");
    expect(outcome?.summary).toBe(
      "The reviewer found every step in the Recording",
    );
  });

  it("passes on minor findings and mentions them", () => {
    const outcome = groundedCheck(
      [
        { target: "s2", severity: "minor", issue: "Menu path", fix: "Add it" },
        { target: null, severity: "minor", issue: "Typo", fix: "Fix it" },
      ],
      rule,
    );
    expect(outcome?.passed).toBe(true);
    expect(outcome?.summary).toContain("2 minor points");
    expect(outcome?.failures).toEqual([]);
  });

  it("fails on a major finding and names its step", () => {
    const outcome = groundedCheck(
      [
        {
          target: "s4",
          severity: "major",
          issue: "The call never shows a Team Lead approval",
          fix: "Remove the approval or mark it as an open question",
        },
        { target: "s2", severity: "minor", issue: "Menu path", fix: "Add it" },
      ],
      rule,
    );
    expect(outcome?.passed).toBe(false);
    expect(outcome?.summary).toBe(
      "The reviewer raised 1 major finding; 1 minor point to look at",
    );
    expect(outcome?.failures).toEqual([
      {
        target: "s4",
        message:
          "The call never shows a Team Lead approval. Fix: Remove the approval or mark it as an open question.",
      },
    ]);
  });
});
