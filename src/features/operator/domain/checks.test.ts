import { describe, expect, it } from "vitest";
import { cloneBooks, diffBooks } from "../legacy/books";
import { Session } from "../legacy/test-kit";
import type { Books, Change, ScreenCode } from "../legacy/types";
import {
  type EvaluateInput,
  evaluate,
  type Finding,
  matchExpectations,
  progressOf,
  satisfies,
} from "./checks";
import { fingerprint } from "./guard";
import { parseManifest } from "./manifest";
import { actionKindOf, DEFAULT_RULEBOOK, type Rulebook } from "./rules";
import type { Expectation } from "./task";
import { ownFixture } from "./task-cards";
import { SAMPLE_TASKS, sampleTask } from "./tasks";

// Fixtures -----------------------------------------------------------------------------

const lineAfter = {
  voyage: "0412N",
  lineNo: 1,
  container: "MRDU4821131",
  grossKg: 18250,
};

const addLine: Change = {
  op: "add",
  record: "line",
  key: "0412N#1",
  after: lineAfter,
};

const amend: Change = {
  op: "update",
  record: "line",
  key: "0377E#9",
  fields: ["grossKg"],
  before: { voyage: "0377E", lineNo: 9, grossKg: 12480 },
  after: { voyage: "0377E", lineNo: 9, grossKg: 12840 },
};

const remove: Change = {
  op: "delete",
  record: "line",
  key: "0377E#12",
  before: { voyage: "0377E", lineNo: 12, container: "MRDU4821131" },
};

const wantAmend: Expectation = {
  label: "Line 9 weight",
  op: "update",
  record: "line",
  where: { voyage: "0377E", lineNo: 9 },
  values: { grossKg: 12840 },
};

const wantDelete: Expectation = {
  label: "Line 12 gone",
  op: "delete",
  record: "line",
  where: { voyage: "0377E", lineNo: 12 },
};

const wantAdd: Expectation = {
  label: "Line keyed",
  op: "add",
  record: "line",
  where: { voyage: "0412N", container: "MRDU4821131" },
  values: { grossKg: 18250 },
};

function rules(edit: (rulebook: Rulebook) => void = () => {}): Rulebook {
  const rulebook = structuredClone(DEFAULT_RULEBOOK);
  edit(rulebook);
  return rulebook;
}

const guardedPrints = (rulebook: Rulebook, changes: Change[]) =>
  changes
    .filter((change) => rulebook.guarded.actions.includes(actionKindOf(change)))
    .map(fingerprint);

/** Plays a sample Task's Script and returns the evaluate input of a correct Run. */
function played(taskId: string): EvaluateInput {
  const task = sampleTask(taskId);
  if (!task) throw new Error(`no sample Task ${taskId}`);
  const session = new Session(task.fixture);
  const screens: ScreenCode[] = [session.state.screen];
  for (const turn of task.script) {
    session.act(...turn.actions);
    screens.push(session.state.screen);
  }
  const changes = diffBooks(task.fixture.books, session.state.books);
  const manifest = task.manifest ? parseManifest(task.manifest.text) : null;
  return {
    rulebook: DEFAULT_RULEBOOK,
    expected: task.expected,
    manifest: manifest
      ? { voyage: manifest.voyage, lines: manifest.lines }
      : null,
    changes,
    after: session.state.books,
    signedOn: session.state.signedOn,
    screens,
    approved: guardedPrints(DEFAULT_RULEBOOK, changes),
    byHand: false,
  };
}

/**
 * DEFECT (checks.ts:97, `rowProblems`): Task 1 asks the Operator to shorten a
 * goods text longer than the 24-wide field "in its own words" (tasks.ts:106,
 * :148, and its Expectation leaves `goods` out for that line), and its Script
 * keys "AGRICULTURAL MACH PARTS". manifest.matches instead demands the first
 * 24 characters of the Manifest ("MACHINE PARTS, AGRICULTU"), so the sample's
 * own correct Run is judged incorrect. Tests that are about another check use
 * this: it makes the Manifest's long goods start with what was keyed, so the
 * truncated comparison holds.
 */
function aligned(input: EvaluateInput): EvaluateInput {
  if (!input.manifest) return input;
  const lines = input.manifest.lines.map((row) => {
    if (row.goods.length <= 24) return row;
    const keyed = input.after.lines.find(
      (line) => line.container === row.container,
    )?.goods;
    return { ...row, goods: `${keyed} (SHORTENED BY THE CLERK)` };
  });
  return { ...input, manifest: { ...input.manifest, lines } };
}

const ofId = (findings: Finding[], id: Finding["id"]) =>
  findings.filter((finding) => finding.id === id);

const failsOf = (findings: Finding[]) =>
  findings.filter((finding) => finding.level === "fail").map((f) => f.id);

// satisfies ----------------------------------------------------------------------------

describe("satisfies", () => {
  it("refuses a different op or record", () => {
    expect(satisfies({ ...wantAdd, op: "update" }, addLine)).toBe(false);
    expect(satisfies({ ...wantAdd, record: "hold" }, addLine)).toBe(false);
  });

  it("reads where from the record after an add or update", () => {
    expect(satisfies(wantAdd, addLine)).toBe(true);
    expect(
      satisfies({ ...wantAdd, where: { container: "OTHER" } }, addLine),
    ).toBe(false);
    expect(satisfies(wantAmend, amend)).toBe(true);
    expect(
      satisfies({ ...wantAmend, where: { voyage: "0377E", lineNo: 8 } }, amend),
    ).toBe(false);
  });

  it("reads where from the record before a delete", () => {
    expect(satisfies(wantDelete, remove)).toBe(true);
    expect(
      satisfies(
        { ...wantDelete, where: { voyage: "0377E", lineNo: 11 } },
        remove,
      ),
    ).toBe(false);
  });

  it("checks values", () => {
    expect(satisfies({ ...wantAdd, values: { grossKg: 18251 } }, addLine)).toBe(
      false,
    );
    expect(satisfies({ ...wantAmend, values: { grossKg: 1 } }, amend)).toBe(
      false,
    );
  });

  it("does not take an update that touched an extra field", () => {
    const wider: Change = {
      ...amend,
      fields: ["grossKg", "goods"],
      after: { ...amend.after, goods: "SOMETHING ELSE" },
    };
    expect(satisfies(wantAmend, wider)).toBe(false);
  });
});

describe("matchExpectations", () => {
  it("uses each Change once", () => {
    const twice = [wantAdd, { ...wantAdd, label: "again" }];
    const result = matchExpectations(twice, [addLine]);
    expect(result.matched).toEqual([addLine, null]);
    expect(result.extra).toEqual([]);
  });

  it("returns the Changes nobody asked for", () => {
    const result = matchExpectations([wantAmend], [remove, amend]);
    expect(result.matched).toEqual([amend]);
    expect(result.extra).toEqual([remove]);
  });
});

describe("progressOf", () => {
  it("is the live checklist", () => {
    expect(progressOf([wantAmend, wantDelete], [])).toEqual([false, false]);
    expect(progressOf([wantAmend, wantDelete], [remove])).toEqual([
      false,
      true,
    ]);
    expect(progressOf([wantAmend, wantDelete], [remove, amend])).toEqual([
      true,
      true,
    ]);
  });
});

// evaluate -----------------------------------------------------------------------------

describe("evaluate on the sample Scripts", () => {
  for (const task of SAMPLE_TASKS) {
    const test = it;
    test(`${task.id}: a correct Run is correct`, () => {
      const result = evaluate(played(task.id));
      expect(failsOf(result.findings)).toEqual([]);
      expect(result.verdict).toBe("correct");
      expect(ofId(result.findings, "task.outcome")).toHaveLength(
        task.expected.length,
      );
      expect(
        result.findings.filter((f) => f.level === "warn" || f.level === "info"),
      ).toEqual([]);
    });
  }

  it("arrival-corvina: every Manifest row matches", () => {
    const result = evaluate(played("arrival-corvina"));
    expect(ofId(result.findings, "manifest.matches")).toEqual([
      {
        id: "manifest.matches",
        level: "pass",
        title: "All 6 Manifest rows are in the Books, field for field",
      },
    ]);
  });

  it("arrival-corvina: correct once the long goods line is set aside", () => {
    const result = evaluate(aligned(played("arrival-corvina")));
    expect(failsOf(result.findings)).toEqual([]);
    expect(result.verdict).toBe("correct");
  });
});

describe("evaluate: each check can fail", () => {
  it("a guarded change with no Approval is incorrect", () => {
    const input = played("release-and-berth");
    const result = evaluate({ ...input, approved: [] });
    expect(result.verdict).toBe("incorrect");
    expect(ofId(result.findings, "actions.guarded")).toEqual([
      {
        id: "actions.guarded",
        level: "fail",
        title:
          "Release a customs hold (hold on TRSU3304186): committed without a person's approval",
      },
    ]);
  });

  it("an Approval is spent once: two identical guarded changes need two", () => {
    const input = played("release-and-berth");
    const [release] = input.changes.filter(
      (change) => actionKindOf(change) === "hold.release",
    );
    const result = evaluate({
      ...input,
      expected: null,
      changes: [release, release],
      approved: [fingerprint(release)],
    });
    expect(
      ofId(result.findings, "actions.guarded").map((f) => f.level),
    ).toEqual(["pass", "fail"]);
  });

  it("by hand, a guarded change is info, not a fail", () => {
    const input = played("manifest-correction");
    const result = evaluate({ ...input, approved: [], byHand: true });
    expect(result.verdict).toBe("correct");
    const guarded = ofId(result.findings, "actions.guarded");
    expect(guarded).toHaveLength(1);
    expect(guarded[0].level).toBe("info");
    expect(guarded[0].title).toContain("done by a person at the keyboard");
  });

  it("left signed on is a warn that does not make it incorrect", () => {
    const result = evaluate({
      ...aligned(played("arrival-corvina")),
      signedOn: true,
    });
    expect(ofId(result.findings, "session.sign-off")).toEqual([
      {
        id: "session.sign-off",
        level: "warn",
        title: "The session was left signed on",
      },
    ]);
    expect(result.verdict).toBe("correct");
  });

  it("an extra unrelated change fails changes.in-scope", () => {
    const input = played("manifest-correction");
    const extra: Change = {
      op: "update",
      record: "line",
      key: "0377E#3",
      fields: ["goods"],
      before: { voyage: "0377E", lineNo: 3, goods: "A" },
      after: { voyage: "0377E", lineNo: 3, goods: "B" },
    };
    const result = evaluate({ ...input, changes: [...input.changes, extra] });
    expect(result.verdict).toBe("incorrect");
    expect(ofId(result.findings, "changes.in-scope")).toEqual([
      {
        id: "changes.in-scope",
        level: "fail",
        title: "Not asked for: Amend a manifest line (manifest line 0377E#3)",
        detail: "Fields changed: goods.",
      },
    ]);
  });

  it("a missing Expectation fails task.outcome", () => {
    const input = played("release-and-berth");
    const changes = input.changes.filter((change) => change.record !== "berth");
    const result = evaluate({ ...input, changes });
    expect(result.verdict).toBe("incorrect");
    expect(
      ofId(result.findings, "task.outcome").filter((f) => f.level === "fail"),
    ).toHaveLength(1);
  });

  describe("manifest.matches", () => {
    it("fails on a wrong weight", () => {
      const input = aligned(played("arrival-corvina"));
      const lines = input.manifest?.lines.map((row, index) =>
        index === 0 ? { ...row, grossKg: row.grossKg + 1 } : row,
      );
      const result = evaluate({
        ...input,
        manifest: { voyage: input.manifest?.voyage, lines: lines ?? [] },
      });
      const [finding] = ofId(result.findings, "manifest.matches");
      expect(finding.level).toBe("fail");
      expect(finding.title).toBe("1 of 6 Manifest rows are missing or differ");
      expect(finding.detail).toContain("grossKg");
      expect(result.verdict).toBe("incorrect");
    });

    it("fails on a container missing from the Books", () => {
      const input = aligned(played("arrival-corvina"));
      const gone = input.manifest?.lines[1].container as string;
      const after: Books = cloneBooks(input.after);
      after.lines = after.lines.filter((line) => line.container !== gone);
      const [finding] = ofId(
        evaluate({ ...input, after }).findings,
        "manifest.matches",
      );
      expect(finding.level).toBe("fail");
      expect(finding.detail).toBe(`${gone}: not in the Books`);
    });

    it("compares goods longer than 24 characters truncated", () => {
      const input = aligned(played("arrival-corvina"));
      const long = input.manifest?.lines.find((row) => row.goods.length > 24);
      expect(long?.goods.length).toBeGreaterThan(24);
      // Longer than the field, and equal to the Books only in its first 24.
      expect(ofId(evaluate(input).findings, "manifest.matches")[0].level).toBe(
        "pass",
      );
      // The same row, but different past the 24th character: still equal.
      const past = input.manifest?.lines.map((row) =>
        row === long ? { ...row, goods: `${row.goods.slice(0, 24)}ZZZ` } : row,
      );
      expect(
        ofId(
          evaluate({
            ...input,
            manifest: { voyage: input.manifest?.voyage, lines: past ?? [] },
          }).findings,
          "manifest.matches",
        )[0].level,
      ).toBe("pass");
      // A difference inside the first 24 characters still fails.
      const lines = input.manifest?.lines.map((row) =>
        row === long ? { ...row, goods: `X${row.goods}` } : row,
      );
      const result = evaluate({
        ...input,
        manifest: { voyage: input.manifest?.voyage, lines: lines ?? [] },
      });
      expect(ofId(result.findings, "manifest.matches")[0].level).toBe("fail");
    });

    it("gives no Finding when disabled", () => {
      const input = aligned(played("arrival-corvina"));
      const result = evaluate({
        ...input,
        rulebook: rules((r) => {
          r.manifest.enabled = false;
        }),
        manifest: { voyage: input.manifest?.voyage, lines: [] },
      });
      expect(ofId(result.findings, "manifest.matches")).toEqual([]);
    });
  });

  it("an invalid container in the Books fails containers.check-digit", () => {
    const input = aligned(played("arrival-corvina"));
    const changes = input.changes.map((change) =>
      change.key === "0412N#2"
        ? { ...change, after: { ...change.after, container: "MRDU5077260" } }
        : change,
    );
    const result = evaluate({ ...input, changes });
    const [finding] = ofId(result.findings, "containers.check-digit");
    expect(finding).toMatchObject({
      level: "fail",
      title: "1 container number in the Books fail the check digit",
      detail: "MRDU5077260",
    });
    expect(result.verdict).toBe("incorrect");
  });

  it("a protected-field update fails fields.protected", () => {
    const input = played("manifest-correction");
    const sneaky: Change = {
      op: "update",
      record: "line",
      key: "0377E#9",
      fields: ["consignee"],
      before: { voyage: "0377E", lineNo: 9, consignee: "C0100" },
      after: { voyage: "0377E", lineNo: 9, consignee: "C0999" },
    };
    const result = evaluate({
      ...input,
      expected: null,
      changes: [sneaky],
    });
    expect(ofId(result.findings, "fields.protected")).toEqual([
      {
        id: "fields.protected",
        level: "fail",
        title: "Protected field changed: line.consignee",
        detail: "Amend a manifest line (manifest line 0377E#9)",
      },
    ]);
    expect(result.verdict).toBe("incorrect");
  });

  it("over records.max fails", () => {
    const input = aligned(played("arrival-corvina"));
    const result = evaluate({
      ...input,
      rulebook: rules((r) => {
        r.records.max = input.changes.length - 1;
      }),
    });
    expect(ofId(result.findings, "records.max")).toEqual([
      {
        id: "records.max",
        level: "fail",
        title: `${input.changes.length} records changed; the limit is ${input.changes.length - 1}`,
      },
    ]);
    // Exactly at the limit is fine.
    expect(
      ofId(
        evaluate({
          ...input,
          rulebook: rules((r) => {
            r.records.max = input.changes.length;
          }),
        }).findings,
        "records.max",
      ),
    ).toEqual([]);
  });

  it("a forbidden Screen fails screens.allowed", () => {
    const input = played("release-and-berth");
    const result = evaluate({
      ...input,
      screens: [...input.screens, "HMA900", "HMA900"],
    });
    expect(ofId(result.findings, "screens.allowed")).toEqual([
      {
        id: "screens.allowed",
        level: "fail",
        title: "Entered a Screen that is not allowed: HMA900",
      },
    ]);
    expect(result.verdict).toBe("incorrect");
  });
});

describe("evaluate: the Verdict without a comparison", () => {
  const own = (rulebook: Rulebook = DEFAULT_RULEBOOK): EvaluateInput => {
    const before = ownFixture().books;
    const after = cloneBooks(before);
    after.berths = after.berths.filter((b) => b.voyage !== "0398S");
    after.berths.push({
      berth: "B05",
      voyage: "0398S",
      from: "2026-11-24T15:00",
      to: "2026-11-26T09:00",
    });
    const changes = diffBooks(before, after);
    return {
      rulebook,
      expected: null,
      manifest: null,
      changes,
      after,
      signedOn: false,
      screens: ["HMS000", "HMM100", "HMB500"],
      approved: [],
      byHand: false,
    };
  };

  it("an own Task with no Manifest and nothing failing is unverified", () => {
    const input = own();
    expect(input.changes.length).toBeGreaterThan(0);
    const result = evaluate(input);
    expect(failsOf(result.findings)).toEqual([]);
    expect(result.verdict).toBe("unverified");
    // No Expectations: changes.in-scope has nothing to say.
    expect(ofId(result.findings, "changes.in-scope")).toEqual([]);
  });

  it("with the manifest Rule disabled and no Expectations, a Manifest does not make it correct", () => {
    const input = aligned(played("arrival-corvina"));
    const result = evaluate({
      ...input,
      expected: null,
      rulebook: rules((r) => {
        r.manifest.enabled = false;
      }),
    });
    expect(failsOf(result.findings)).toEqual([]);
    expect(result.verdict).toBe("unverified");
  });

  it("an own Task with a Manifest is compared", () => {
    const input = aligned(played("arrival-corvina"));
    expect(evaluate({ ...input, expected: null }).verdict).toBe("correct");
  });

  it("a failing Rule still makes an own Task incorrect", () => {
    expect(evaluate({ ...own(), screens: ["HMS000", "HMT600"] }).verdict).toBe(
      "incorrect",
    );
  });
});

describe("evaluate: a disabled Rule gives no Finding", () => {
  const cases: [keyof Rulebook, Finding["id"]][] = [
    ["screens", "screens.allowed"],
    ["records", "records.max"],
    ["protectedFields", "fields.protected"],
    ["guarded", "actions.guarded"],
    ["checkDigit", "containers.check-digit"],
    ["signOff", "session.sign-off"],
    ["scope", "changes.in-scope"],
    ["manifest", "manifest.matches"],
  ];

  // Every Rule fires on this input while enabled.
  const failing = (): EvaluateInput => {
    const input = aligned(played("arrival-corvina"));
    const protectedUpdate: Change = {
      op: "update",
      record: "line",
      key: "0377E#9",
      fields: ["consignee"],
      before: { voyage: "0377E", lineNo: 9, consignee: "C0100" },
      after: { voyage: "0377E", lineNo: 9, consignee: "C0999" },
    };
    const release: Change = {
      op: "delete",
      record: "hold",
      key: "TRSU3304186",
      before: { container: "TRSU3304186", status: "ACTIVE" },
    };
    return {
      ...input,
      changes: [...input.changes, protectedUpdate, release],
      screens: [...input.screens, "HMT600"],
      signedOn: true,
      approved: [],
    };
  };

  for (const [key, id] of cases) {
    it(`${key} off: no ${id}`, () => {
      const base = failing();
      const rulebook = rules((r) => {
        r.records.max = 1;
      });
      expect(
        ofId(evaluate({ ...base, rulebook }).findings, id).length,
      ).toBeGreaterThan(0);
      rulebook[key].enabled = false;
      expect(ofId(evaluate({ ...base, rulebook }).findings, id)).toEqual([]);
    });
  }
});
