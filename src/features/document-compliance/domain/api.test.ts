import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { apiPath, isRunId, parseAuditQuery } from "./api";

const RUN = "0b6f7a52-3c1d-4e8f-9a0b-1c2d3e4f5a6b";

describe("parseAuditQuery", () => {
  it("reads an empty query as the whole trail", () => {
    expect(parseAuditQuery(new URLSearchParams())).toEqual({
      runId: null,
      action: null,
      before: null,
    });
  });

  it("reads a run, an action and a cursor", () => {
    expect(
      parseAuditQuery(
        new URLSearchParams({ runId: RUN, action: "rule.saved", before: "42" }),
      ),
    ).toEqual({ runId: RUN, action: "rule.saved", before: 42 });
  });

  it.each<Record<string, string>>([
    { runId: "not-a-uuid" },
    { runId: "1; drop table audit_events" },
    { action: "run.deleted" },
    { before: "0" },
    { before: "-3" },
    { before: "1.5" },
    { before: "abc" },
  ])("refuses %o", (query) => {
    expect(() => parseAuditQuery(new URLSearchParams(query))).toThrow(ZodError);
  });

  it("round-trips through the path it builds", () => {
    const filter = {
      runId: RUN,
      action: "run.reevaluated" as const,
      before: 7,
    };
    const url = new URL(apiPath.audit(filter), "https://example.test");
    expect(url.pathname).toBe("/api/document-compliance/audit");
    expect(parseAuditQuery(url.searchParams)).toEqual(filter);
    expect(apiPath.audit({ runId: null, action: null, before: null })).toBe(
      "/api/document-compliance/audit",
    );
  });
});

describe("isRunId", () => {
  it("accepts a uuid and nothing else", () => {
    expect(isRunId(RUN)).toBe(true);
    expect(isRunId(RUN.toUpperCase())).toBe(true);
    expect(isRunId(`${RUN}x`)).toBe(false);
    expect(isRunId("../rules")).toBe(false);
    expect(isRunId(42)).toBe(false);
  });
});
