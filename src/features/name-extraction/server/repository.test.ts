import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type Call = { text: string; values: unknown[] };

/**
 * A stand-in for the postgres.js pool: records each tagged-template query
 * (its text with `$n` placeholders and its values) and answers the next
 * canned result. `db(obj, ...cols)` and `db.json(v)` return markers, so a
 * test sees what reached a helper and which values went as JSON.
 */
const fake = vi.hoisted(() => {
  const calls: { text: string; values: unknown[] }[] = [];
  const results: unknown[][] = [];
  function db(first: unknown, ...rest: unknown[]) {
    if (Array.isArray(first) && "raw" in first) {
      const strings = first as unknown as TemplateStringsArray;
      calls.push({
        text: strings.reduce(
          (text, part, i) => (i === 0 ? part : `${text}$${i}${part}`),
          "",
        ),
        values: rest,
      });
      return Promise.resolve(results.shift() ?? []);
    }
    return { helper: first, columns: rest };
  }
  db.json = (value: unknown) => ({ json: value });
  return { calls, results, db };
});

vi.mock("./db", () => ({ sql: () => fake.db }));

const repo = await import("./repository");

const RUN_ID = "0b6f6f3e-7c4a-4c1e-9f61-2b1a7d0c9e11";
const last = (): Call => fake.calls[fake.calls.length - 1];

beforeEach(() => {
  fake.calls.length = 0;
  fake.results.length = 0;
});

describe("updateRun", () => {
  it("sets only the patched columns, jsonb as JSON and null as SQL null", async () => {
    await repo.updateRun(RUN_ID, {
      status: "running",
      names: [],
      score: null,
      error: undefined,
    });
    const call = last();
    expect(call.text).toContain("update name_extraction.runs set $1");
    expect(call.text).toContain("where id = $2");
    expect(call.values[0]).toEqual({
      helper: { status: "running", names: { json: [] }, score: null },
      columns: [],
    });
    expect(call.values[1]).toBe(RUN_ID);
  });

  it("drops keys outside the allowlist", async () => {
    await repo.updateRun(RUN_ID, {
      status: "running",
      owner: "host:someone-else",
    } as never);
    expect(last().values[0]).toEqual({
      helper: { status: "running" },
      columns: [],
    });
  });

  it("sends no query for an empty patch", async () => {
    await repo.updateRun(RUN_ID, {});
    expect(fake.calls).toHaveLength(0);
  });
});

describe("endRunIfGoing", () => {
  it("ends only a Run still going and says whether this call ended it", async () => {
    fake.results.push([{ id: RUN_ID }]);
    expect(await repo.endRunIfGoing(RUN_ID, { status: "stopped" })).toBe(true);
    const call = last();
    expect(call.text).toContain("status in ('queued', 'running')");
    expect(call.text).toContain("returning id");
    const set = (call.values[0] as { helper: Record<string, unknown> }).helper;
    expect(set.status).toBe("stopped");
    expect(typeof set.ended_at).toBe("string");

    fake.results.push([]);
    expect(await repo.endRunIfGoing(RUN_ID, { status: "stopped" })).toBe(false);
  });
});

describe("createRun", () => {
  const input = {
    owner: "e2e" as const,
    visitorHash: "v",
    title: "x".repeat(300),
    pages: 10,
    source: { kind: "corpus" as const, corpusId: "c1" },
    models: { analyst: "a", reader: "r" } as never,
    rulebookVersion: 0,
    rulebook: {} as never,
    limits: null,
  };

  it("calls create_run with named arguments and returns the id", async () => {
    fake.results.push([{ run_id: RUN_ID, refusal: null }]);
    expect(await repo.createRun(input)).toEqual({ runId: RUN_ID });
    const call = last();
    expect(call.text).toContain("from name_extraction.create_run(");
    expect(call.text).toContain("p_source => $5::jsonb");
    expect(call.values[2]).toHaveLength(200);
    expect(call.values[4]).toEqual({ json: input.source });
    expect(call.values.slice(8)).toEqual([null, null, null]);
  });

  it("returns the refusal", async () => {
    fake.results.push([{ run_id: null, refusal: "Too many." }]);
    expect(await repo.createRun(input)).toEqual({ refusal: "Too many." });
  });
});

describe("events", () => {
  it("reads after a cursor in seq order and keeps the payload", async () => {
    fake.results.push([
      {
        seq: 7,
        at: "2026-11-27T10:00:00.123456+00:00",
        type: "x",
        payload: { a: 1 },
      },
    ]);
    const events = await repo.eventsAfter(RUN_ID, 5, 10);
    const call = last();
    expect(call.text).toContain("seq > $2");
    expect(call.text).toContain("order by seq asc");
    expect(call.values).toEqual([RUN_ID, 5, 10]);
    expect(events).toEqual([
      { a: 1, type: "x", at: Date.parse("2026-11-27T10:00:00.123Z"), seq: 7 },
    ]);
  });

  it("inserts every event in one statement with its payload as JSON", async () => {
    await repo.insertEvents(RUN_ID, [
      { type: "start", at: 0 } as never,
      { type: "end", at: 1000, reason: "done" } as never,
    ]);
    const { helper, columns } = last().values[0] as {
      helper: Record<string, unknown>[];
      columns: string[];
    };
    expect(columns).toEqual(["run_id", "type", "at", "payload"]);
    expect(helper.map((row) => row.payload)).toEqual([
      { json: {} },
      { json: { reason: "done" } },
    ]);
    expect(helper[1].at).toBe(new Date(1000).toISOString());
  });

  it("writes nothing for no events", async () => {
    await repo.insertEvents(RUN_ID, []);
    expect(fake.calls).toHaveLength(0);
  });
});

describe("owner scoping", () => {
  it("scopes a Run and an Upload by id and Owner, and refuses a bad id", async () => {
    expect(await repo.ownedRun("e2e", "not-a-uuid")).toBeNull();
    expect(fake.calls).toHaveLength(0);

    await repo.ownedRun("e2e", RUN_ID);
    expect(last().text).toContain("where id = $1 and owner = $2");
    expect(last().values).toEqual([RUN_ID, "e2e"]);

    await repo.ownedUpload("e2e", RUN_ID);
    expect(last().text).toContain("name_extraction.uploads");
    expect(last().values).toEqual([RUN_ID, "e2e"]);
  });

  it("counts the Owner's uploads since a time", async () => {
    fake.results.push([{ count: 3 }]);
    const since = new Date("2026-11-26T00:00:00Z");
    expect(await repo.countUploadsSince("e2e", since)).toBe(3);
    expect(last().values).toEqual(["e2e", since.toISOString()]);
  });
});
