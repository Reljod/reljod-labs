import { describe, expect, it } from "vitest";
import { apiPath, auditSearch, parseAuditQuery, parseRunId } from "./api";

const ID = "6f1d3c2a-5b4e-4f7a-9c8d-1e2f3a4b5c6d";

describe("parseRunId", () => {
  it("takes a UUID", () => {
    expect(parseRunId(ID)).toBe(ID);
  });

  it("refuses anything else", () => {
    for (const value of ["", "1", `${ID}x`, "../desk", null, undefined, 42]) {
      expect(parseRunId(value)).toBeNull();
    }
  });
});

describe("parseAuditQuery", () => {
  it("takes no filter", () => {
    expect(parseAuditQuery(new URLSearchParams())).toEqual({});
  });

  it("takes a cursor and a Run", () => {
    expect(
      parseAuditQuery(new URLSearchParams({ before: "120", run: ID })),
    ).toEqual({ before: 120, runId: ID });
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
      expect(() => parseAuditQuery(new URLSearchParams(query))).toThrow();
    }
  });

  it("round-trips through auditSearch", () => {
    for (const query of [
      {},
      { before: 7 },
      { runId: ID },
      { before: 3, runId: ID },
    ]) {
      expect(parseAuditQuery(new URLSearchParams(auditSearch(query)))).toEqual(
        query,
      );
    }
  });
});

describe("apiPath", () => {
  it("encodes ids into the path", () => {
    expect(apiPath.run("a/b")).toBe("/api/process-transfer/runs/a%2Fb");
    expect(apiPath.runEvents(ID, 4)).toBe(
      `/api/process-transfer/runs/${ID}/events?from=4`,
    );
    expect(apiPath.audit({ runId: ID })).toBe(
      `/api/process-transfer/audit?run=${ID}`,
    );
  });
});
