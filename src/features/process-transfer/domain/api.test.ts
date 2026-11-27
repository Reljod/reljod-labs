import { describe, expect, it } from "vitest";
import { auditSearchSchema, parseRunId } from "./api";

const ID = "6f1d3c2a-5b4e-4f7a-9c8d-1e2f3a4b5c6d";

describe("parseRunId", () => {
  it("takes a UUID and refuses anything else", () => {
    expect(parseRunId(ID)).toBe(ID);
    for (const value of ["", "1", `${ID}x`, "../desk", null, undefined, 42]) {
      expect(parseRunId(value)).toBeNull();
    }
  });
});

describe("auditSearchSchema", () => {
  it("takes a cursor and a Run", () => {
    expect(auditSearchSchema.parse({ before: "120", run: ID })).toEqual({
      before: 120,
      runId: ID,
    });
  });

  it("refuses a malformed cursor or Run", () => {
    const malformed: Record<string, string>[] = [
      { before: "abc" },
      { before: "-1" },
      { before: "1.5" },
      { before: "9007199254740993" },
      { run: "not-a-run" },
    ];
    for (const query of malformed) {
      expect(() => auditSearchSchema.parse(query)).toThrow();
    }
  });
});
