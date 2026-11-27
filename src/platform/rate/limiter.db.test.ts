import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/*
 * Against a real Postgres: `LIMITER_DB_TEST=1` with `DATABASE_URL` (or
 * `DEMO_TEST_DATABASE_URL`). It writes a few `floorwalk.rate_hits` and
 * `prism.rate_hits` rows under a random visitor hash and deletes them after.
 * The e2e suite is a trusted visitor and never reaches this SQL.
 */
const url = process.env.DEMO_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const run = process.env.LIMITER_DB_TEST === "1" && Boolean(url);

describe.skipIf(!run)(
  "pgRateLimiter on Postgres",
  { timeout: 60_000 },
  async () => {
    if (url) vi.stubEnv("DATABASE_URL", url);
    const { createPool } = await import("@/server/postgres");
    const { pgRateLimiter } = await import("./limiter");
    const { LimitError } = await import("../errors");
    const pool = createPool(2);
    const who = { hash: `test-${randomUUID()}`, trusted: false };

    afterAll(async () => {
      await pool`delete from floorwalk.rate_hits where visitor_hash = ${who.hash}`;
      await pool`delete from prism.rate_hits where visitor_hash = ${who.hash}`;
      await pool.end();
    });

    it("refuses the hit past a visitor's cap and records nothing for it", async () => {
      const limiter = pgRateLimiter<"walk" | "ask">({
        table: "floorwalk.rate_hits",
        db: () => pool,
        caps: {
          walk: [
            { scope: "visitor", window: "hour", max: 2, message: "two walks" },
          ],
          ask: [],
        },
      });
      await limiter.take("walk", who);
      await limiter.take("walk", who);
      await expect(limiter.take("walk", who)).rejects.toBeInstanceOf(
        LimitError,
      );
      expect(await limiter.used(who, ["walk", "ask"])).toEqual({
        walk: 2,
        ask: 0,
      });
      // A kind with no caps is only recorded.
      await limiter.take("ask", who);
    });

    it("never lets two requests at once both take the last place", async () => {
      const limiter = pgRateLimiter<"upload">({
        table: "floorwalk.rate_hits",
        db: () => pool,
        caps: {
          upload: [{ scope: "visitor", window: "day", max: 1, message: "one" }],
        },
      });
      const results = await Promise.allSettled([
        limiter.take("upload", who),
        limiter.take("upload", who),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    });

    it("counts units, and a cap across kinds counts them together", async () => {
      const across = ["refract", "cascade"] as const;
      const limiter = pgRateLimiter<"refract" | "cascade">({
        table: "prism.rate_hits",
        units: true,
        owner: true,
        db: () => pool,
        caps: {
          refract: [
            {
              scope: "visitor",
              window: "day",
              max: 5,
              message: "five",
              across,
            },
          ],
          cascade: [
            {
              scope: "visitor",
              window: "day",
              max: 5,
              message: "five",
              across,
            },
          ],
        },
      });
      await limiter.take("refract", who, { units: 3, owner: "e2e" });
      await expect(
        limiter.take("cascade", who, { units: 3, owner: "e2e" }),
      ).rejects.toBeInstanceOf(LimitError);
      await limiter.take("cascade", who, { units: 2, owner: "e2e" });
    });
  },
);
