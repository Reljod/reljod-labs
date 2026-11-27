import { beforeEach, describe, expect, it, vi } from "vitest";
import { LIMITS } from "../domain/guest-pass";

vi.mock("server-only", () => ({}));

const rpc = vi.fn();
/** Every `from(...)` chain resolves to the next queued answer. */
const answers: unknown[] = [];
const calls: { table: string; ops: [string, unknown[]][] }[] = [];

function chain(table: string) {
  const call = { table, ops: [] as [string, unknown[]][] };
  calls.push(call);
  const target: Record<string, unknown> = {};
  const proxy: unknown = new Proxy(target, {
    get(_, prop: string) {
      if (prop === "then") {
        const answer = answers.shift() ?? { data: null, error: null };
        return (resolve: (value: unknown) => void) => resolve(answer);
      }
      return (...args: unknown[]) => {
        call.ops.push([prop, args]);
        return proxy;
      };
    },
  });
  return proxy;
}

vi.mock("./supabase", () => ({
  supabase: () => ({ rpc, from: (table: string) => chain(table) }),
}));

const { takeAttempt, settleAttempt, endGuestSession } = await import(
  "./repository"
);

beforeEach(() => {
  rpc.mockReset();
  answers.length = 0;
  calls.length = 0;
});

describe("takeAttempt", () => {
  it("asks the database to count and insert in one step, with the global cap for codes", async () => {
    rpc.mockResolvedValue({ data: 41, error: null });
    expect(await takeAttempt("v", "code")).toBe(41);
    expect(rpc).toHaveBeenCalledWith("take_attempt", {
      p_visitor_hash: "v",
      p_kind: "code",
      p_window_minutes: LIMITS.attemptWindowMinutes,
      p_max_failed: LIMITS.failedAttempts,
      p_global_max_failed: LIMITS.globalFailedCodeAttempts,
    });
  });

  it("never puts the Host's sign-in under the global cap", async () => {
    rpc.mockResolvedValue({ data: 7, error: null });
    await takeAttempt("v", "sign_in");
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_global_max_failed: null });
  });

  it("is refused when the database says so", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await takeAttempt("v", "code")).toBeNull();
  });

  it("fails loudly on a database error", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "XX000", message: "down" },
    });
    await expect(takeAttempt("v", "code")).rejects.toThrow("down");
  });

  describe("before the migration is applied", () => {
    beforeEach(() => {
      rpc.mockResolvedValue({
        data: null,
        error: { code: "PGRST202", message: "missing" },
      });
    });

    it("refuses a visitor over the cap", async () => {
      answers.push({ count: LIMITS.failedAttempts, error: null });
      expect(await takeAttempt("v", "code")).toBeNull();
    });

    it("refuses a code when everyone together is over the global cap", async () => {
      answers.push(
        { count: 0, error: null },
        { count: LIMITS.globalFailedCodeAttempts, error: null },
      );
      expect(await takeAttempt("v", "code")).toBeNull();
    });

    it("records the try as failed and returns its id", async () => {
      answers.push(
        { count: 0, error: null },
        { count: 0, error: null },
        { data: { id: 9 }, error: null },
      );
      expect(await takeAttempt("v", "code")).toBe(9);
      const insert = calls[2].ops.find(([op]) => op === "insert");
      expect(insert?.[1][0]).toEqual({
        visitor_hash: "v",
        kind: "code",
        succeeded: false,
      });
    });
  });
});

describe("settleAttempt", () => {
  it("marks that one try succeeded", async () => {
    await settleAttempt(5);
    expect(calls[0].ops).toEqual([
      ["update", [{ succeeded: true }]],
      ["eq", ["id", 5]],
    ]);
  });
});

describe("endGuestSession", () => {
  it("deletes only that user's Guest session", async () => {
    await endGuestSession("u1");
    expect(calls[0].table).toBe("guest_sessions");
    expect(calls[0].ops).toEqual([
      ["delete", []],
      ["eq", ["user_id", "u1"]],
    ]);
  });
});
