import { describe, expect, it } from "vitest";
import type { Change } from "../legacy/types";
import {
  ACTION_KINDS,
  actionKindOf,
  DEFAULT_RULEBOOK,
  RULE_LIMITS,
  RULES,
  type Rulebook,
  rulebookSchema,
  ruleEnabled,
  SCREEN_CODES,
} from "./rules";

function rules(edit: (rulebook: Rulebook) => void = () => {}): Rulebook {
  const rulebook = structuredClone(DEFAULT_RULEBOOK);
  edit(rulebook);
  return rulebook;
}

const parses = (value: unknown) => rulebookSchema.safeParse(value).success;

describe("rulebookSchema", () => {
  it("parses the Default", () => {
    expect(rulebookSchema.parse(DEFAULT_RULEBOOK)).toEqual(DEFAULT_RULEBOOK);
  });

  it("keeps the two dangerous Screens out of the Default", () => {
    expect(DEFAULT_RULEBOOK.screens.allowed).not.toContain("HMT600");
    expect(DEFAULT_RULEBOOK.screens.allowed).not.toContain("HMA900");
    expect(DEFAULT_RULEBOOK.screens.allowed).toHaveLength(
      SCREEN_CODES.length - 2,
    );
  });

  it("refuses a records max of 0 or over the limit, and takes the bounds", () => {
    const withMax = (max: number) =>
      parses({ ...DEFAULT_RULEBOOK, records: { enabled: true, max } });
    expect(withMax(0)).toBe(false);
    expect(withMax(RULE_LIMITS.maxRecords + 1)).toBe(false);
    expect(withMax(1.5)).toBe(false);
    expect(withMax(1)).toBe(true);
    expect(withMax(RULE_LIMITS.maxRecords)).toBe(true);
  });

  it("refuses an unknown Screen code, field or action", () => {
    const bad = structuredClone(DEFAULT_RULEBOOK) as unknown as {
      screens: { allowed: string[] };
      protectedFields: { fields: string[] };
      guarded: { actions: string[] };
    };
    expect(
      parses({
        ...bad,
        screens: { enabled: true, allowed: [...bad.screens.allowed, "HMZ999"] },
      }),
    ).toBe(false);
    expect(
      parses({
        ...bad,
        protectedFields: { enabled: true, fields: ["vessel.callSign"] },
      }),
    ).toBe(false);
    expect(
      parses({
        ...bad,
        guarded: { enabled: true, actions: ["vessel.delete"] },
      }),
    ).toBe(false);
  });

  it("refuses a Rule with no switch", () => {
    const { signOff: _, ...rest } = DEFAULT_RULEBOOK;
    expect(parses(rest)).toBe(false);
    expect(parses({ ...DEFAULT_RULEBOOK, scope: {} })).toBe(false);
  });
});

describe("actionKindOf", () => {
  const change = (
    record: Change["record"],
    op: Change["op"],
    after?: Record<string, unknown>,
  ): Change => ({ record, op, key: "K", after });

  it("names every op on every record", () => {
    expect(actionKindOf(change("vessel", "add"))).toBe("vessel.register");
    expect(actionKindOf(change("vessel", "update"))).toBe("vessel.amend");
    expect(actionKindOf(change("line", "add"))).toBe("line.add");
    expect(actionKindOf(change("line", "update"))).toBe("line.amend");
    expect(actionKindOf(change("line", "delete"))).toBe("line.delete");
    expect(actionKindOf(change("hold", "add"))).toBe("hold.place");
    expect(actionKindOf(change("hold", "delete"))).toBe("hold.release");
    expect(actionKindOf(change("berth", "add"))).toBe("berth.allocate");
    expect(actionKindOf(change("berth", "update"))).toBe("berth.amend");
    expect(actionKindOf(change("berth", "delete"))).toBe("berth.cancel");
  });

  it("calls a hold update to RELEASED a release, and back to ACTIVE a place", () => {
    expect(actionKindOf(change("hold", "update", { status: "RELEASED" }))).toBe(
      "hold.release",
    );
    expect(actionKindOf(change("hold", "update", { status: "ACTIVE" }))).toBe(
      "hold.place",
    );
  });

  it("only ever returns a known kind", () => {
    for (const record of ["vessel", "line", "hold", "berth"] as const)
      for (const op of ["add", "update", "delete"] as const)
        expect(ACTION_KINDS).toContain(actionKindOf(change(record, op)));
  });
});

describe("RULES", () => {
  it("each points at a Rulebook key, with unique ids", () => {
    for (const rule of RULES) expect(DEFAULT_RULEBOOK).toHaveProperty(rule.key);
    expect(new Set(RULES.map((rule) => rule.id)).size).toBe(RULES.length);
    expect(new Set(RULES.map((rule) => rule.key)).size).toBe(RULES.length);
    expect(RULES).toHaveLength(Object.keys(DEFAULT_RULEBOOK).length);
  });
});

describe("ruleEnabled", () => {
  it("reads the switch of the Rule's key", () => {
    for (const rule of RULES)
      expect(ruleEnabled(DEFAULT_RULEBOOK, rule.id)).toBe(true);
    const off = rules((r) => {
      r.checkDigit.enabled = false;
    });
    expect(ruleEnabled(off, "containers.check-digit")).toBe(false);
    expect(ruleEnabled(off, "records.max")).toBe(true);
  });
});
