import { describe, expect, it } from "vitest";
import type { Change } from "../legacy/types";
import {
  ALWAYS_ALLOWED,
  afterCommit,
  describeChange,
  fingerprint,
  type GuardLedger,
  guard,
  type Preview,
} from "./guard";
import { isValidContainer } from "./iso6346";
import { DEFAULT_RULEBOOK, type Rulebook } from "./rules";

const VALID = "MRDU4821131";
const INVALID = "MRDU4821130";

const fresh: GuardLedger = { records: 0, approved: [] };

function rules(edit: (rulebook: Rulebook) => void = () => {}): Rulebook {
  const rulebook = structuredClone(DEFAULT_RULEBOOK);
  edit(rulebook);
  return rulebook;
}

const preview = (changes: Change[], to = "HMC320", from = "HMC320") =>
  ({ from, to, changes }) as Preview;

const addLine = (container: string, lineNo = 1): Change => ({
  op: "add",
  record: "line",
  key: `0412N#${lineNo}`,
  after: { voyage: "0412N", lineNo, container, grossKg: 1000 },
});

const amendLine = (
  fields: string[],
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Change => ({
  op: "update",
  record: "line",
  key: "0377E#9",
  fields,
  before: { voyage: "0377E", lineNo: 9, container: VALID, ...before },
  after: { voyage: "0377E", lineNo: 9, container: VALID, ...after },
});

const releaseHold = (container = "TRSU3304186"): Change => ({
  op: "update",
  record: "hold",
  key: container,
  fields: ["status", "authority"],
  before: { container, status: "ACTIVE", authority: "" },
  after: { container, status: "RELEASED", authority: "RO-2611-0457" },
});

const placeHold = (container = "TRSU3304186"): Change => ({
  op: "add",
  record: "hold",
  key: container,
  after: { container, reason: "23", status: "ACTIVE" },
});

describe("guard", () => {
  it("allows a plain navigation", () => {
    expect(
      guard(DEFAULT_RULEBOOK, fresh, preview([], "HMV200", "HMM100")),
    ).toEqual({ kind: "allow" });
  });

  describe("screens.allowed", () => {
    it("refuses entering a Screen not on the list", () => {
      const decision = guard(
        DEFAULT_RULEBOOK,
        fresh,
        preview([], "HMT600", "HMM100"),
      );
      expect(decision).toMatchObject({
        kind: "refuse",
        ruleId: "screens.allowed",
      });
      expect(decision.kind === "refuse" && decision.reason).toContain("HMT600");
    });

    it("never refuses the ALWAYS_ALLOWED Screens, even off the list", () => {
      const rulebook = rules((r) => {
        r.screens.allowed = [];
      });
      for (const to of ALWAYS_ALLOWED)
        expect(guard(rulebook, fresh, preview([], to, "HMV200")), to).toEqual({
          kind: "allow",
        });
      expect(guard(rulebook, fresh, preview([], "HMV200", "HMM100")).kind).toBe(
        "refuse",
      );
    });

    it("does not fire when the Rule is disabled", () => {
      const rulebook = rules((r) => {
        r.screens.enabled = false;
      });
      expect(guard(rulebook, fresh, preview([], "HMA900", "HMM100"))).toEqual({
        kind: "allow",
      });
    });
  });

  describe("records.max", () => {
    const rulebook = rules((r) => {
      r.records.max = 3;
    });

    it("allows exactly at the limit", () => {
      expect(
        guard(
          rulebook,
          { records: 2, approved: [] },
          preview([addLine(VALID)]),
        ),
      ).toEqual({ kind: "allow" });
    });

    it("refuses one past the limit", () => {
      const decision = guard(
        rulebook,
        { records: 3, approved: [] },
        preview([addLine(VALID)]),
      );
      expect(decision).toMatchObject({ kind: "refuse", ruleId: "records.max" });
      expect(decision.kind === "refuse" && decision.reason).toBe(
        "This would be record 4 of the Run; the limit is 3.",
      );
    });

    it("counts every change of the Preview", () => {
      expect(
        guard(
          rulebook,
          { records: 2, approved: [] },
          preview([addLine(VALID, 1), addLine(VALID, 2)]),
        ).kind,
      ).toBe("refuse");
    });

    it("does not fire when disabled", () => {
      const off = rules((r) => {
        r.records.enabled = false;
        r.records.max = 1;
      });
      expect(
        guard(off, { records: 50, approved: [] }, preview([addLine(VALID)])),
      ).toEqual({ kind: "allow" });
    });
  });

  describe("fields.protected", () => {
    it("refuses an update of a protected field and names it", () => {
      const decision = guard(
        DEFAULT_RULEBOOK,
        fresh,
        preview([
          amendLine(["consignee"], { consignee: "C0412" }, { consignee: "C9" }),
        ]),
      );
      expect(decision).toMatchObject({
        kind: "refuse",
        ruleId: "fields.protected",
      });
      expect(decision.kind === "refuse" && decision.reason).toBe(
        'line.consignee is a protected field: it would change from "C0412" to "C9".',
      );
    });

    it("allows an unprotected field on the same record", () => {
      expect(
        guard(
          DEFAULT_RULEBOOK,
          fresh,
          preview([
            amendLine(["grossKg"], { grossKg: 12480 }, { grossKg: 12840 }),
          ]),
        ),
      ).toEqual({ kind: "allow" });
    });

    it("allows the same field on an add", () => {
      expect(guard(DEFAULT_RULEBOOK, fresh, preview([addLine(VALID)]))).toEqual(
        { kind: "allow" },
      );
    });

    it("does not fire when disabled", () => {
      const off = rules((r) => {
        r.protectedFields.enabled = false;
      });
      expect(
        guard(
          off,
          fresh,
          preview([
            amendLine(
              ["consignee"],
              { consignee: "C0412" },
              { consignee: "C9" },
            ),
          ]),
        ),
      ).toEqual({ kind: "allow" });
    });
  });

  describe("containers.check-digit", () => {
    it("uses containers that are and are not valid", () => {
      expect(isValidContainer(VALID)).toBe(true);
      expect(isValidContainer(INVALID)).toBe(false);
    });

    it("refuses an added line with an invalid container", () => {
      const decision = guard(
        DEFAULT_RULEBOOK,
        fresh,
        preview([addLine(INVALID)]),
      );
      expect(decision).toMatchObject({
        kind: "refuse",
        ruleId: "containers.check-digit",
      });
      expect(decision.kind === "refuse" && decision.reason).toContain(INVALID);
    });

    it("refuses an added line with a truncated container", () => {
      // "MRDU 482113 1" typed into an 11-wide field.
      expect(
        guard(DEFAULT_RULEBOOK, fresh, preview([addLine("MRDU 482113")])),
      ).toMatchObject({ kind: "refuse", ruleId: "containers.check-digit" });
      expect(
        guard(DEFAULT_RULEBOOK, fresh, preview([addLine("MRDU482113")])),
      ).toMatchObject({ kind: "refuse", ruleId: "containers.check-digit" });
    });

    it("passes a valid container", () => {
      expect(guard(DEFAULT_RULEBOOK, fresh, preview([addLine(VALID)]))).toEqual(
        { kind: "allow" },
      );
    });

    it("does not check an update that leaves the container alone", () => {
      const change = amendLine(["grossKg"], { grossKg: 1 }, { grossKg: 2 });
      change.before = { ...change.before, container: INVALID };
      change.after = { ...change.after, container: INVALID };
      expect(guard(DEFAULT_RULEBOOK, fresh, preview([change]))).toEqual({
        kind: "allow",
      });
    });

    it("checks an update that changes the container", () => {
      const off = rules((r) => {
        r.protectedFields.enabled = false;
      });
      expect(
        guard(
          off,
          fresh,
          preview([
            amendLine(
              ["container"],
              { container: VALID },
              { container: INVALID },
            ),
          ]),
        ),
      ).toMatchObject({ kind: "refuse", ruleId: "containers.check-digit" });
    });

    it("does not fire when disabled", () => {
      const off = rules((r) => {
        r.checkDigit.enabled = false;
      });
      expect(guard(off, fresh, preview([addLine(INVALID)]))).toEqual({
        kind: "allow",
      });
    });
  });

  describe("actions.guarded", () => {
    it("pauses a guarded Action with its fingerprint", () => {
      const change = releaseHold();
      const decision = guard(DEFAULT_RULEBOOK, fresh, preview([change]));
      expect(decision).toEqual({
        kind: "pause",
        ruleId: "actions.guarded",
        actionKind: "hold.release",
        change,
        fingerprint:
          "hold.release:TRSU3304186:authority=RO-2611-0457|status=RELEASED",
        reason: "Release a customs hold (hold on TRSU3304186) needs a person.",
      });
    });

    it("passes once approved, and afterCommit spends the Approval", () => {
      const change = releaseHold();
      const print = fingerprint(change);
      const approved: GuardLedger = { records: 0, approved: [print] };
      expect(guard(DEFAULT_RULEBOOK, approved, preview([change]))).toEqual({
        kind: "allow",
      });

      const after = afterCommit(DEFAULT_RULEBOOK, approved, [change]);
      expect(after).toEqual({ records: 1, approved: [] });
      expect(guard(DEFAULT_RULEBOOK, after, preview([change])).kind).toBe(
        "pause",
      );
    });

    it("an Approval for one hold does not pass another", () => {
      const ledger: GuardLedger = {
        records: 0,
        approved: [fingerprint(releaseHold("TRSU3304186"))],
      };
      expect(
        guard(DEFAULT_RULEBOOK, ledger, preview([releaseHold(VALID)])).kind,
      ).toBe("pause");
    });

    it("leaves an unguarded Action alone and does not fire when disabled", () => {
      expect(guard(DEFAULT_RULEBOOK, fresh, preview([placeHold()]))).toEqual({
        kind: "allow",
      });
      const off = rules((r) => {
        r.guarded.enabled = false;
      });
      expect(guard(off, fresh, preview([releaseHold()]))).toEqual({
        kind: "allow",
      });
    });

    it("refusal takes precedence over pause", () => {
      const doomed: Change = {
        op: "delete",
        record: "line",
        key: "0377E#12",
        before: { voyage: "0377E", lineNo: 12, container: VALID },
      };
      // line.delete is guarded, but the records limit is spent.
      const rulebook = rules((r) => {
        r.records.max = 1;
      });
      expect(
        guard(rulebook, { records: 1, approved: [] }, preview([doomed])),
      ).toMatchObject({ kind: "refuse", ruleId: "records.max" });
      // And a bad container in the same Preview as a guarded change.
      expect(
        guard(
          DEFAULT_RULEBOOK,
          fresh,
          preview([releaseHold(), addLine(INVALID)]),
        ),
      ).toMatchObject({ kind: "refuse", ruleId: "containers.check-digit" });
    });
  });
});

describe("afterCommit", () => {
  it("leaves the ledger as it is when nothing committed", () => {
    const ledger: GuardLedger = { records: 4, approved: ["x"] };
    expect(afterCommit(DEFAULT_RULEBOOK, ledger, [])).toBe(ledger);
  });

  it("counts every change and spends only one copy of an Approval", () => {
    const print = fingerprint(releaseHold());
    const after = afterCommit(
      DEFAULT_RULEBOOK,
      { records: 1, approved: [print, print] },
      [releaseHold(), addLine(VALID)],
    );
    expect(after).toEqual({ records: 3, approved: [print] });
  });
});

describe("fingerprint", () => {
  it("differs between two holds and between place and release", () => {
    expect(fingerprint(releaseHold("TRSU3304186"))).not.toBe(
      fingerprint(releaseHold(VALID)),
    );
    expect(fingerprint(placeHold())).not.toBe(fingerprint(releaseHold()));
    expect(fingerprint(placeHold())).toBe("hold.place:TRSU3304186");
  });
});

describe("describeChange", () => {
  it("says what a change is in plain words", () => {
    expect(describeChange(releaseHold(VALID))).toBe(
      "Release a customs hold (hold on MRDU4821131)",
    );
    expect(describeChange(addLine(VALID))).toBe(
      "Add a manifest line (manifest line 0412N#1)",
    );
    expect(
      describeChange({
        op: "add",
        record: "berth",
        key: "0398S",
        after: { berth: "B03" },
      }),
    ).toBe("Allocate a berth (berth booking for voyage 0398S)");
    expect(
      describeChange({
        op: "add",
        record: "vessel",
        key: "9412057",
        after: { imo: "9412057" },
      }),
    ).toBe("Register a vessel arrival (vessel 9412057)");
  });
});
