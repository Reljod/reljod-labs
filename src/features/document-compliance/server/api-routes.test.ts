import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  owner: "guest:pass-a" as string | null,
  calls: [] as { fn: string; owner: string; args: unknown[] }[],
  fail: false,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/features/access/server/gate", () => {
  class AccessDeniedError extends Error {}
  return {
    AccessDeniedError,
    denied: () =>
      new Response("denied", {
        status: 401,
        headers: { "cache-control": "no-store" },
      }),
    requireOwner: async () => {
      if (!state.owner) throw new AccessDeniedError();
      return { access: {}, owner: state.owner };
    },
  };
});

const record =
  (fn: string, answer: (...args: unknown[]) => unknown) =>
  async (owner: string, ...args: unknown[]) => {
    state.calls.push({ fn, owner, args });
    if (state.fail) throw new Error("connection refused at db.internal:5432");
    return answer(...args);
  };

vi.mock("./repository", () => ({
  listOwnerRuns: record("listOwnerRuns", () => [{ id: "r1" }]),
  // loadRun takes (runId, owner); a run that is not the Owner's reads as missing.
  loadRun: async (runId: string, owner: string) => {
    state.calls.push({ fn: "loadRun", owner, args: [runId] });
    return null;
  },
}));
vi.mock("./rules", () => ({
  listRules: record("listRules", () => []),
  listRuleVersions: record("listRuleVersions", () => []),
}));
vi.mock("./audit", () => ({
  listAuditEvents: record("listAuditEvents", () => ({
    events: [],
    before: null,
  })),
}));

const { GET: getRuns } = await import(
  "@/app/api/document-compliance/runs/route"
);
const { GET: getRun } = await import(
  "@/app/api/document-compliance/runs/[runId]/route"
);
const { GET: getRules } = await import(
  "@/app/api/document-compliance/rules/route"
);
const { GET: getVersions } = await import(
  "@/app/api/document-compliance/rules/[ruleId]/versions/route"
);
const { GET: getAudit } = await import(
  "@/app/api/document-compliance/audit/route"
);

const RUN = "0b6f7a52-3c1d-4e8f-9a0b-1c2d3e4f5a6b";
const params = <T>(value: T) => ({ params: Promise.resolve(value) });
const request = (path: string) => new Request(`https://labs.test${path}`);

beforeEach(() => {
  state.owner = "guest:pass-a";
  state.calls = [];
  state.fail = false;
});

describe("document compliance read routes", () => {
  it("refuse a visitor without Access before reading anything", async () => {
    state.owner = null;
    const responses = await Promise.all([
      getRuns(),
      getRules(),
      getRun(request("/"), params({ runId: RUN })),
      getVersions(
        request("/"),
        params({ ruleId: "identity-document-not-expired" }),
      ),
      getAudit(request("/api/document-compliance/audit")),
    ]);
    expect(responses.map((response) => response.status)).toEqual([
      401, 401, 401, 401, 401,
    ]);
    expect(state.calls).toEqual([]);
  });

  it("scope every read to the Owner and are never shared-cached", async () => {
    const response = await getRuns();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual([{ id: "r1" }]);
    await getRules();
    await getAudit(request(`/api/document-compliance/audit?runId=${RUN}`));
    expect(state.calls.map(({ fn, owner }) => [fn, owner])).toEqual([
      ["listOwnerRuns", "guest:pass-a"],
      ["listRules", "guest:pass-a"],
      ["listAuditEvents", "guest:pass-a"],
    ]);
    expect(state.calls[2]?.args).toEqual([
      { runId: RUN, action: null, before: null },
    ]);
  });

  it("answer 404 for a run that is not the Owner's, and for a bad id without a query", async () => {
    const missing = await getRun(request("/"), params({ runId: RUN }));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "No such run." });
    const bad = await getRun(request("/"), params({ runId: "../rules" }));
    expect(bad.status).toBe(404);
    expect(state.calls).toEqual([
      { fn: "loadRun", owner: "guest:pass-a", args: [RUN] },
    ]);
  });

  it("answer 404 for an unknown Rule", async () => {
    const response = await getVersions(
      request("/"),
      params({ ruleId: "no-such-rule" }),
    );
    expect(response.status).toBe(404);
    expect(state.calls).toEqual([]);
  });

  it("refuse a malformed Audit filter with 400", async () => {
    const response = await getAudit(
      request("/api/document-compliance/audit?action=run.deleted"),
    );
    expect(response.status).toBe(400);
    expect(state.calls).toEqual([]);
  });

  it("hide a server error behind a plain sentence", async () => {
    state.fail = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await getRuns();
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain("db.internal");
    expect(body.error).toMatch(/went wrong/);
  });
});
