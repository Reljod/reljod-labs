import { beforeEach, describe, expect, it, vi } from "vitest";

type Query = { text: string; values: unknown[] };

const state = vi.hoisted(() => ({
  queries: [] as Query[],
  replies: [] as (unknown[] | Error)[],
}));

/* A stand-in for the postgres.js tagged template: it records each statement
   (fragments flattened into their parent) and answers from `state.replies`. */
vi.mock("server-only", () => ({}));
vi.mock("./db", () => {
  const fragment = (strings: TemplateStringsArray, values: unknown[]) => {
    let text = strings[0] ?? "";
    const flat: unknown[] = [];
    values.forEach((value, i) => {
      if (value && typeof value === "object" && "fragment" in value) {
        const inner = value as unknown as { text: string; values: unknown[] };
        text += inner.text;
        flat.push(...inner.values);
      } else {
        flat.push(value);
        text += "$?";
      }
      text += strings[i + 1] ?? "";
    });
    return { text: text.replace(/\s+/g, " ").trim(), values: flat };
  };
  const db = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = fragment(strings, values);
    return {
      fragment: true,
      ...query,
      // biome-ignore lint/suspicious/noThenProperty: a postgres.js query is a thenable
      then(resolve: (rows: unknown[]) => void, reject: (e: unknown) => void) {
        let n = 0;
        state.queries.push({
          text: query.text.replace(/\$\?/g, () => `$${++n}`),
          values: query.values,
        });
        const reply = state.replies.shift() ?? [];
        if (reply instanceof Error) reject(reply);
        else resolve(reply);
      },
    };
  };
  db.json = (value: unknown) => ({ json: value });
  return { sql: () => db };
});

const repo = await import("./repository");

const SESSION = "11111111-1111-4111-8111-111111111111";
const PLAN = {
  verdict: "not_found" as const,
  title: "Nothing here",
  layout: "mixed" as const,
  answer: "No.",
  steps: [],
};

beforeEach(() => {
  state.queries = [];
  state.replies = [];
});

describe("loadAskSession", () => {
  it("never queries for an id that is not a uuid", async () => {
    expect(await repo.loadAskSession("nope", "host:a")).toBeNull();
    expect(state.queries).toEqual([]);
  });

  it("scopes the session to its Owner and orders its Builds by position", async () => {
    state.replies.push([]);
    expect(await repo.loadAskSession(SESSION, "host:a")).toBeNull();
    const [query] = state.queries;
    expect(query?.text).toContain("s.owner = $2");
    expect(query?.text).toContain("order by b.position");
    expect(query?.values).toEqual([SESSION, "host:a"]);
  });

  it("returns the Builds in the stored shape", async () => {
    state.replies.push([
      {
        id: SESSION,
        builds: [
          {
            id: "b1",
            position: 0,
            question: "Where?",
            build_plan: PLAN,
            created_at: "2026-11-27T10:00:00.123456+00:00",
          },
        ],
      },
    ]);
    const view = await repo.loadAskSession(SESSION, "host:a");
    expect(view?.id).toBe(SESSION);
    expect(view?.builds[0]).toMatchObject({
      id: "b1",
      position: 0,
      question: "Where?",
      createdAt: "2026-11-27T10:00:00.123456+00:00",
    });
  });

  it("names what failed", async () => {
    state.replies.push(new Error("boom"));
    await expect(repo.loadAskSession(SESSION, "host:a")).rejects.toThrow(
      `Could not load Ask session ${SESSION}: boom`,
    );
  });
});

describe("latestAnsweredSessionId", () => {
  it("is scoped to the Owner and null when there is none", async () => {
    expect(await repo.latestAnsweredSessionId("guest:p")).toBeNull();
    expect(state.queries[0]?.text).toContain("where s.owner = $1");
    expect(state.queries[0]?.text).toContain(
      "order by b.created_at desc limit 1",
    );
    expect(state.queries[0]?.values).toEqual(["guest:p"]);
  });
});

describe("insertBuild", () => {
  it("takes the next position from the session's count and stores the plan as jsonb", async () => {
    state.replies.push([
      {
        id: "b2",
        position: 1,
        question: "Q",
        build_plan: PLAN,
        created_at: "2026-11-27T10:00:00+00:00",
      },
    ]);
    const build = await repo.insertBuild({
      askSessionId: SESSION,
      question: "Q",
      plan: PLAN,
      model: "m",
      visitorHash: "v",
    });
    expect(build.position).toBe(1);
    const [query] = state.queries;
    expect(query?.text).toContain("count(*)::int");
    expect(query?.values).toEqual([
      SESSION,
      "Q",
      { json: PLAN },
      "m",
      "v",
      SESSION,
    ]);
  });
});
