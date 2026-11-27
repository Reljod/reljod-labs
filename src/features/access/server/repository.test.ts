import { beforeEach, describe, expect, it, vi } from "vitest";
import { LIMITS } from "../domain/guest-pass";

type Query = { text: string; values: unknown[] };

const state = vi.hoisted(() => ({
  queries: [] as Query[],
  /** Each statement takes the next answer: rows, or an error it throws. */
  replies: [] as (unknown[] | Error)[],
}));

/* A stand-in for the postgres.js tagged template: it records each statement
   (fragments flattened into it, parameters as $?) and answers in turn. */
vi.mock("server-only", () => ({}));
vi.mock("./supabase", () => ({ supabase: vi.fn() }));
vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  const isFragment = (value: unknown): value is Query =>
    Boolean(value && typeof value === "object" && "fragment" in value);
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = strings[0] ?? "";
    const flat: unknown[] = [];
    values.forEach((value, i) => {
      if (isFragment(value)) {
        text += value.text;
        flat.push(...value.values);
      } else {
        text += "$?";
        flat.push(value);
      }
      text += strings[i + 1] ?? "";
    });
    const query = { text: text.replace(/\s+/g, " ").trim(), values: flat };
    return {
      fragment: true,
      ...query,
      // biome-ignore lint/suspicious/noThenProperty: a postgres.js query is a thenable
      then(resolve: (rows: unknown[]) => void, reject: (e: unknown) => void) {
        state.queries.push(query);
        const reply = state.replies.shift() ?? [];
        if (reply instanceof Error) reject(reply);
        else resolve(reply);
      },
    };
  };
  return { ...actual, sql: () => tag };
});

const { takeAttempt, settleAttempt, endGuestSession, codeLooksGood } =
  await import("./repository");

function pgError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

beforeEach(() => {
  state.queries = [];
  state.replies = [];
});

describe("takeAttempt", () => {
  it("asks the database to count and insert in one step, with the global cap for codes", async () => {
    state.replies.push([{ id: 41 }]);
    expect(await takeAttempt("v", "code")).toBe(41);
    expect(state.queries).toHaveLength(1);
    expect(state.queries[0]?.text).toContain("access.take_attempt(");
    expect(state.queries[0]?.values).toEqual([
      "v",
      "code",
      LIMITS.attemptWindowMinutes,
      LIMITS.failedAttempts,
      LIMITS.globalFailedCodeAttempts,
    ]);
  });

  it("never puts the Host's sign-in under the global cap", async () => {
    state.replies.push([{ id: 7 }]);
    await takeAttempt("v", "sign_in");
    expect(state.queries[0]?.values.at(-1)).toBeNull();
  });

  it("is refused when the database says so", async () => {
    state.replies.push([{ id: null }]);
    expect(await takeAttempt("v", "code")).toBeNull();
  });

  it("fails loudly on a database error", async () => {
    state.replies.push(pgError("XX000", "down"));
    await expect(takeAttempt("v", "code")).rejects.toThrow("down");
  });

  describe("before the migration is applied", () => {
    beforeEach(() => {
      state.replies.push(pgError("42883", "function does not exist"));
    });

    it("refuses a visitor over the cap", async () => {
      state.replies.push([{ mine: LIMITS.failedAttempts, everyone: 0 }]);
      expect(await takeAttempt("v", "code")).toBeNull();
    });

    it("refuses a code when everyone together is over the global cap", async () => {
      state.replies.push([
        { mine: 0, everyone: LIMITS.globalFailedCodeAttempts },
      ]);
      expect(await takeAttempt("v", "code")).toBeNull();
    });

    it("never refuses the Host on the global count", async () => {
      state.replies.push(
        [{ mine: 0, everyone: LIMITS.globalFailedCodeAttempts }],
        [{ id: 3 }],
      );
      expect(await takeAttempt("v", "sign_in")).toBe(3);
    });

    it("records the try as failed and returns its id", async () => {
      state.replies.push([{ mine: 0, everyone: 0 }], [{ id: 9 }]);
      expect(await takeAttempt("v", "code")).toBe(9);
      const insert = state.queries[2];
      expect(insert?.text).toContain("insert into access.attempts");
      expect(insert?.values).toEqual(["v", "code"]);
      expect(insert?.text).toContain("false");
    });
  });
});

describe("settleAttempt", () => {
  it("marks that one try succeeded", async () => {
    await settleAttempt(5);
    expect(state.queries[0]?.text).toBe(
      "update access.attempts set succeeded = true where id = $?",
    );
    expect(state.queries[0]?.values).toEqual([5]);
  });
});

describe("endGuestSession", () => {
  it("deletes only that user's Guest session", async () => {
    await endGuestSession("u1");
    expect(state.queries[0]?.text).toBe(
      "delete from access.guest_sessions where user_id = $?::uuid",
    );
    expect(state.queries[0]?.values).toEqual(["u1"]);
  });
});

describe("codeLooksGood", () => {
  const live = {
    id: "p1",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    max_devices: 2,
    revoked_at: null,
    deleted_at: null,
  };

  it("refuses an unknown, revoked, deleted or ended code without counting", async () => {
    for (const pass of [
      undefined,
      { ...live, revoked_at: "2026-11-27T00:00:00+00:00" },
      { ...live, deleted_at: "2026-11-27T00:00:00+00:00" },
      { ...live, expires_at: "2020-01-01T00:00:00+00:00" },
    ]) {
      state.queries = [];
      state.replies.push(pass ? [pass] : []);
      expect(await codeLooksGood("h", null)).toBe(false);
      expect(state.queries).toHaveLength(1);
    }
  });

  it("counts the other devices on the pass against its cap", async () => {
    state.replies.push([live], [{ count: 1 }]);
    expect(await codeLooksGood("h", "u1")).toBe(true);
    expect(state.queries[1]?.text).toContain("and user_id <> $?::uuid");
    expect(state.queries[1]?.values).toEqual(["p1", "u1"]);

    state.queries = [];
    state.replies.push([live], [{ count: 2 }]);
    expect(await codeLooksGood("h", null)).toBe(false);
    expect(state.queries[1]?.text).not.toContain("user_id");
  });
});
