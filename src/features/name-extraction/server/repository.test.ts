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

vi.mock("@/server/postgres", () => ({ db: () => fake.db }));

const repo = await import("./repository");

const RUN_ID = "0b6f6f3e-7c4a-4c1e-9f61-2b1a7d0c9e11";
const last = (): Call => fake.calls[fake.calls.length - 1];

beforeEach(() => {
  fake.calls.length = 0;
  fake.results.length = 0;
});

describe("a Run patch", () => {
  it("drops keys outside the allowlist, so no other column reaches the SQL", async () => {
    await repo.updateRun(RUN_ID, {
      status: "running",
      owner: "host:someone-else",
    } as never);
    expect(last().values[0]).toEqual({
      helper: { status: "running" },
      columns: [],
    });
  });

  it("ends only a Run still going and says whether this call ended it", async () => {
    fake.results.push([{ id: RUN_ID }]);
    expect(await repo.endRunIfGoing(RUN_ID, { status: "stopped" })).toBe(true);
    const call = last();
    expect(call.text).toContain("status in ('queued', 'running')");
    expect(call.text).toContain("returning id");

    fake.results.push([]);
    expect(await repo.endRunIfGoing(RUN_ID, { status: "stopped" })).toBe(false);
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
});
