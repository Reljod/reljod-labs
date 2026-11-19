import { beforeEach, describe, expect, it, vi } from "vitest";
import extraFixtures from "../domain/guard.fixtures.extra.json";
import fixtures from "../domain/guard.fixtures.json";
import { defaultRulebook, settings } from "../domain/rules";

/*
 * The cap on Sandbox work is taken before the first paid step: parsing a
 * Query in the Sandbox is a Run, so a statement the Guard refuses still
 * uses one, and a Query that runs uses exactly one (conventions.md, "Take
 * the cap before the first paid step, not the main one").
 */

vi.mock("server-only", () => ({}));
vi.mock("./db", () => ({ sql: vi.fn(), isUuid: () => false }));
vi.mock("./catalog", () => ({ catalogFor: vi.fn() }));
vi.mock("./rules", () => ({ currentRulebook: vi.fn() }));
vi.mock("./trail", () => ({
  trail: vi.fn(async () => 1),
  trailStrict: vi.fn(async () => 1),
}));
vi.mock("./rate", () => ({ takeRate: vi.fn(async () => {}) }));
vi.mock("./sandbox/session", () => ({ runJob: vi.fn() }));

const { takeRate } = await import("./rate");
const { runJob } = await import("./sandbox/session");
const { catalogFor } = await import("./catalog");
const { currentRulebook } = await import("./rules");
const { guardAll, runQuery } = await import("./runs");
const { RuleRefusal } = await import("./errors");

type Case = { sql: string; ast: unknown };
const cases = { ...fixtures.cases, ...extraFixtures.cases } as Record<
  string,
  Case
>;

const caller = {
  owner: "e2e" as const,
  visitor: { hash: "v", trusted: false },
  actor: "client" as const,
};
const guardCatalog = {
  tables: {
    household_survey: [
      "household_id",
      "region_code",
      "monthly_income_mdc",
      "respondent_age",
      "household_size",
      "municipality",
    ],
    grid_load: ["ts", "region_code", "load_mw"],
  },
};
const context = {
  rulebookVersion: 0,
  rules: settings(defaultRulebook()),
  catalog: { tables: [], guard: guardCatalog, uploadTables: [] },
};

/** The Sandbox answers a parse with the trees DuckDB gave for these cases. */
function parsesAs(...names: string[]) {
  vi.mocked(runJob).mockImplementation(async (_owner, job) => {
    if (job.op === "serialize")
      return {
        answer: {
          asts: [
            ...names.map((name) => cases[name].ast),
            fixtures.template.ast,
          ],
        },
        ms: 5,
        sandboxCreated: false,
      };
    return {
      answer: {
        columns: [{ name: "n", type: "bigint" }],
        rows: [[1]],
        rowCount: 1,
        truncated: false,
        ms: 3,
      },
      ms: 4,
      sandboxCreated: false,
    };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(catalogFor).mockResolvedValue(context.catalog as never);
  vi.mocked(currentRulebook).mockResolvedValue({
    version: 0,
    rulebook: defaultRulebook(),
    changed: [],
    savedAt: null,
  });
});

describe("the Run is taken before the Sandbox parses", () => {
  it("a Query the Guard refuses still uses exactly one Run", async () => {
    parsesAs("row_level");
    await expect(
      guardAll(caller, context, [{ sql: cases.row_level.sql }], {}),
    ).rejects.toBeInstanceOf(RuleRefusal);
    expect(takeRate).toHaveBeenCalledTimes(1);
    expect(takeRate).toHaveBeenCalledWith(caller.visitor, "e2e", "run");
    // The parse ran (it is what was paid for); the Query did not.
    expect(runJob).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runJob).mock.calls[0][1].op).toBe("serialize");
  });

  it("no Sandbox work happens when the allowance is used up", async () => {
    parsesAs("plain_load");
    vi.mocked(takeRate).mockRejectedValueOnce(new Error("limit"));
    await expect(
      guardAll(caller, context, [{ sql: cases.plain_load.sql }], {
        from: "2025-01-01",
      }),
    ).rejects.toThrow("limit");
    expect(runJob).not.toHaveBeenCalled();
  });

  it("a fresh Query that runs uses exactly one Run, parse and query together", async () => {
    parsesAs("range_fn");
    const ran = await runQuery(caller, { sql: cases.range_fn.sql });
    expect(ran.result.rowCount).toBe(1);
    expect(takeRate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runJob).mock.calls.map((call) => call[1].op)).toEqual([
      "serialize",
      "query",
    ]);
  });
});
