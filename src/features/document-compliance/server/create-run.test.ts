import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  calls: [] as { name: string; args: Record<string, unknown> }[],
  answer: [] as { run_id: string | null; refusal: string | null }[],
}));

/* A stand-in for the postgres.js tagged template: it reads the function's
   name and each named argument (`p_x => $n`) off the statement. */
vi.mock("server-only", () => ({}));
vi.mock("./db", () => {
  const tag = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const args: Record<string, unknown> = {};
    values.forEach((value, i) => {
      const name = /(p_\w+) => $/.exec(strings[i] ?? "")?.[1];
      if (name) args[name] = value;
    });
    const name = /document_compliance\.(\w+)\(/.exec(strings.join(""))?.[1];
    db.calls.push({ name: name ?? "", args });
    return db.answer;
  };
  return { sql: () => Object.assign(tag, { json: (value: unknown) => value }) };
});

const { createRun } = await import("./repository");
const { RATE_LIMITS, rateLimitMessage } = await import("./rate-limit");

const input = {
  packSlug: "pack",
  rulebook: { id: "rb", version: "1", requirements: [], applied: [] },
  declaration: {},
  visitorHash: "visitor",
  owner: "host:11111111-2222-4333-8444-555555555555",
  model: "provider/model",
} as unknown as Parameters<typeof createRun>[0];

beforeEach(() => {
  db.calls = [];
  db.answer = [];
});

describe("createRun", () => {
  it("counts and inserts in one database call, passing the limits", async () => {
    db.answer = [{ run_id: "run-1", refusal: null }];
    const created = await createRun({ ...input, limits: RATE_LIMITS });
    expect(created).toEqual({ runId: "run-1" });
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]?.name).toBe("create_prescreen_run");
    expect(db.calls[0]?.args).toMatchObject({
      p_per_visitor_per_hour: RATE_LIMITS.perVisitorPerHour,
      p_per_day: RATE_LIMITS.perDay,
    });
  });

  it("passes no limits for a trusted visitor", async () => {
    db.answer = [{ run_id: "run-2", refusal: null }];
    await createRun({ ...input, limits: null });
    expect(db.calls[0]?.args).toMatchObject({
      p_per_visitor_per_hour: null,
      p_per_day: null,
    });
  });

  it("returns the refusal when a limit is reached", async () => {
    db.answer = [{ run_id: null, refusal: "visitor" }];
    const created = await createRun({ ...input, limits: RATE_LIMITS });
    expect(created).toEqual({ refusal: "visitor" });
    expect(rateLimitMessage("visitor")).toMatch(/in the last hour/);

    db.answer = [{ run_id: null, refusal: "day" }];
    expect(await createRun({ ...input, limits: RATE_LIMITS })).toEqual({
      refusal: "day",
    });
    expect(rateLimitMessage("day")).toMatch(/today's limit/);
  });
});
