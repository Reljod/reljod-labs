import { describe, expect, it } from "vitest";
import {
  AUDIT_ACTION_IDS,
  actorLabel,
  DETAIL_LIMITS,
  isAuditAction,
  redactDetail,
} from "./audit";

describe("AUDIT_ACTIONS", () => {
  it("names every action as thing.verb, the shape the database checks", () => {
    for (const action of AUDIT_ACTION_IDS) {
      expect(action).toMatch(/^[a-z_]+\.[a-z_]+$/);
    }
  });

  it("knows its own actions and no others", () => {
    expect(isAuditAction("rule.saved")).toBe(true);
    expect(isAuditAction("rule.deleted")).toBe(false);
    expect(isAuditAction(3)).toBe(false);
  });
});

describe("actorLabel", () => {
  it("names a Staff member, the Agent and the system", () => {
    expect(
      actorLabel({ kind: "staff", staff: { id: "1", name: "Keisha" } }),
    ).toBe("Keisha");
    expect(actorLabel({ kind: "agent" })).toBe("Agent");
    expect(actorLabel({ kind: "system" })).toBe("System");
  });
});

describe("redactDetail", () => {
  it("keeps short values as they are", () => {
    expect(redactDetail({ ruleId: "r1", version: 3, on: true })).toEqual({
      ruleId: "r1",
      version: 3,
      on: true,
    });
  });

  it("cuts a long string and says how much it left out", () => {
    const text = "x".repeat(DETAIL_LIMITS.stringChars + 50);
    const { args } = redactDetail({ args: { text } }) as {
      args: { text: string };
    };
    expect(args.text.startsWith("x".repeat(DETAIL_LIMITS.stringChars))).toBe(
      true,
    );
    expect(args.text.endsWith("(+50 chars)")).toBe(true);
  });

  it("trims long lists", () => {
    const { rows } = redactDetail({
      rows: Array.from({ length: 25 }, (_, index) => index),
    }) as { rows: unknown[] };
    expect(rows).toHaveLength(DETAIL_LIMITS.arrayItems + 1);
    expect(rows.at(-1)).toBe("… (+5 more)");
  });

  it("never keeps a value under a key that looks like a credential", () => {
    expect(
      redactDetail({
        headers: { Authorization: "Bearer abc", accept: "json" },
        apiKey: "sk-123",
        hook_token: "t",
      }),
    ).toEqual({
      headers: { Authorization: "[redacted]", accept: "json" },
      apiKey: "[redacted]",
      hook_token: "[redacted]",
    });
  });

  it("stops at a fixed depth and returns plain JSON", () => {
    const deep = { a: { b: { c: { d: { e: { f: 1 } } } } } };
    const result = redactDetail(deep);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(JSON.stringify(result)).toContain("[cut]");
    expect(redactDetail({ when: new Date(0), n: Number.NaN })).toEqual({
      when: "1970-01-01T00:00:00.000Z",
      n: null,
    });
    expect(redactDetail(null)).toEqual({});
  });
});
