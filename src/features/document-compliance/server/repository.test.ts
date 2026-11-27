import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A stand-in for the postgres.js pool: it records each statement's text (with
 * `$n` placeholders, fragments inlined) and its parameters, and answers with
 * whatever `state.respond` returns for it. Nothing reaches a database.
 */
type Statement = { text: string; values: unknown[] };

const state = vi.hoisted(() => ({
  statements: [] as Statement[],
  respond: (_statement: Statement): unknown[] | Error => [],
}));

vi.mock("server-only", () => ({}));
vi.mock("./supabase", () => ({ packPageUrls: async () => new Map() }));
vi.mock("./db", () => {
  type Fragment = Statement & { fragment: true };
  const isFragment = (value: unknown): value is Fragment =>
    typeof value === "object" &&
    value !== null &&
    (value as { fragment?: unknown }).fragment === true;

  function build(strings: TemplateStringsArray, args: unknown[]): Statement {
    let text = strings[0] ?? "";
    const values: unknown[] = [];
    args.forEach((arg, index) => {
      if (isFragment(arg)) {
        text += arg.text.replace(
          /\$(\d+)/g,
          (_, n) => `$${Number(n) + values.length}`,
        );
        values.push(...arg.values);
      } else {
        values.push(arg);
        text += `$${values.length}`;
      }
      text += strings[index + 1] ?? "";
    });
    return { text: text.replace(/\s+/g, " ").trim(), values };
  }

  function db(first: unknown, ...rest: unknown[]) {
    if (Array.isArray(first) && "raw" in first) {
      const statement = build(first as unknown as TemplateStringsArray, rest);
      return {
        ...statement,
        fragment: true,
        // biome-ignore lint/suspicious/noThenProperty: it stands in for a postgres.js query, which is awaited.
        then(
          resolve: (rows: unknown[]) => unknown,
          reject: (e: unknown) => unknown,
        ) {
          state.statements.push(statement);
          const answer = state.respond(statement);
          return (
            answer instanceof Error
              ? Promise.reject(answer)
              : Promise.resolve(answer)
          ).then(resolve, reject);
        },
      };
    }
    // An identifier or row helper: kept as one parameter, for the test to read.
    return { text: "$1", values: [first], fragment: true };
  }
  db.json = (value: unknown) => ({ json: value });
  db.begin = async (fn: (tx: typeof db) => unknown) => fn(db);
  return { sql: () => db };
});

const { listOwnerRuns, loadRun } = await import("./repository");

const RUN_ID = "00000000-0000-4000-8000-000000000001";

const runRow = {
  id: RUN_ID,
  pack_slug: "no-such-pack",
  rulebook_id: "kyc",
  rulebook_version: "1",
  client_declaration: {},
  rules_applied: null,
  status: "completed",
  model: "openai/test",
  error: null,
  workflow_run_id: null,
  visitor_hash: "v",
  owner: "guest:a",
  created_at: "2026-11-27T10:00:00.123456+00:00",
  completed_at: "2026-11-27T10:01:00+00:00",
};

const missingTable = () =>
  Object.assign(new Error('relation "x" does not exist'), { code: "42P01" });

beforeEach(() => {
  state.statements = [];
  state.respond = () => [];
});

describe("loadRun", () => {
  it("reads the run scoped to its Owner and stops when it is not theirs", async () => {
    expect(await loadRun(RUN_ID, "guest:b")).toBeNull();
    expect(state.statements).toHaveLength(1);
    const [statement] = state.statements;
    expect(statement?.text).toContain(
      "from document_compliance.prescreen_runs",
    );
    expect(statement?.text).toContain("where id = $1 and owner = $2");
    expect(statement?.values).toEqual([RUN_ID, "guest:b"]);
  });

  it("reads every child row through the run, and reads no re-evaluations before the migration", async () => {
    state.respond = ({ text }) => {
      if (text.includes("from document_compliance.prescreen_runs")) {
        return [runRow];
      }
      if (
        text.includes("from document_compliance.evaluations") ||
        text.includes("from document_compliance.finding_reviews")
      ) {
        return missingTable();
      }
      return [];
    };
    const view = await loadRun(RUN_ID, "guest:a");
    expect(view?.id).toBe(RUN_ID);
    expect(view?.evaluations.map((item) => item.number)).toEqual([1]);
    expect(view?.reviews).toEqual([]);
    const children = state.statements.slice(1);
    expect(children).toHaveLength(8);
    for (const statement of children) {
      expect(statement.values).toEqual([RUN_ID]);
    }
  });

  it("throws an error that is not a missing table", async () => {
    state.respond = ({ text }) =>
      text.includes("from document_compliance.prescreen_runs")
        ? [runRow]
        : text.includes("from document_compliance.finding_reviews")
          ? Object.assign(new Error("permission denied"), { code: "42501" })
          : [];
    await expect(loadRun(RUN_ID, "guest:a")).rejects.toThrow(
      "permission denied",
    );
  });
});

describe("listOwnerRuns", () => {
  it("lists only the Owner's runs and reads nothing more when there are none", async () => {
    expect(await listOwnerRuns("host:a", 5)).toEqual([]);
    expect(state.statements).toHaveLength(1);
    expect(state.statements[0]?.text).toContain("where owner = $1");
    expect(state.statements[0]?.values).toEqual(["host:a", 5]);
  });

  it("totals each run's Documents and counts its Findings", async () => {
    state.respond = ({ text }) => {
      if (text.includes("from document_compliance.prescreen_runs")) {
        return [runRow];
      }
      if (text.includes("from document_compliance.documents")) {
        return [
          {
            run_id: RUN_ID,
            model: "openai/test",
            provider: "openai",
            input_tokens: 100,
            output_tokens: 20,
            reasoning_tokens: null,
            cached_input_tokens: null,
            // numeric comes back from postgres.js as a string
            cost_usd: "0.012500",
            parse_ms: 10,
            read_ms: 200,
          },
        ];
      }
      if (text.includes("from document_compliance.findings")) {
        return [
          { run_id: RUN_ID, outcome: "pass" },
          { run_id: RUN_ID, outcome: "fail" },
          { run_id: RUN_ID, outcome: "pass" },
        ];
      }
      return [];
    };
    const [run] = await listOwnerRuns("guest:a");
    expect(run?.costUsd).toBeCloseTo(0.0125);
    expect(run?.tokens).toBe(120);
    expect(run?.counts).toEqual({ pass: 2, fail: 1, needs_review: 0 });
    const reads = state.statements.slice(1);
    expect(reads.every((statement) => statement.text.includes("any($"))).toBe(
      true,
    );
  });
});
