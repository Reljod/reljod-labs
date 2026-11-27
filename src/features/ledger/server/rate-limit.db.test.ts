import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { LIMITS, limitMessage } from "../domain/limits";
import type { Visitor } from "./visitor";

/**
 * Ledger's rate limit against the real `ledger.take_rate_hit`. Skipped unless
 * DEMO_TEST_DATABASE_URL is set. The database is shared, so each case uses
 * its own random visitor hash, deletes only that visitor's hits, and never
 * relies on the site-wide day count beyond assuming it is under its cap.
 */
const url = process.env.DEMO_TEST_DATABASE_URL;

vi.mock("server-only", () => ({}));

const PREFIX = `ledger-rate-db-test-${randomUUID()}`;
const fresh = (): Visitor => ({
  hash: `${PREFIX}-${randomUUID()}`,
  limited: true,
  stubbed: false,
  forceLimit: false,
});

describe.skipIf(!url)("Ledger's rate limit, on Postgres", () => {
  let rate: typeof import("./rate-limit");
  let sql: typeof import("./db").sql;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    rate = await import("./rate-limit");
    ({ sql } = await import("./db"));
  });

  afterAll(async () => {
    if (!sql) return;
    await sql()`
      delete from ledger.rate_hits where visitor_hash like ${`${PREFIX}-%`}`;
    await sql().end();
  });

  const hits = async (visitor: Visitor) => {
    const [row] = await sql()<{ n: number }[]>`
      select count(*)::int as n from ledger.rate_hits
      where visitor_hash = ${visitor.hash}`;
    return row?.n ?? 0;
  };

  it("lets a visitor take the hourly allowance, then refuses with the visitor message", async () => {
    const visitor = fresh();
    for (let i = 0; i < LIMITS.buildsPerVisitorPerHour; i++) {
      expect(await rate.takeBuildRate(visitor)).toBeNull();
    }
    expect(await hits(visitor)).toBe(LIMITS.buildsPerVisitorPerHour);
    expect(await rate.takeBuildRate(visitor)).toBe(limitMessage("visitor"));
    expect(await rate.rateLimitMessage(visitor)).toBe(limitMessage("visitor"));
    // A refusal records nothing.
    expect(await hits(visitor)).toBe(LIMITS.buildsPerVisitorPerHour);
    // Another visitor is not held up by this one.
    expect(await rate.rateLimitMessage(fresh())).toBeNull();
  });

  it("peeks without recording a hit", async () => {
    const visitor = fresh();
    expect(await rate.rateLimitMessage(visitor)).toBeNull();
    expect(await rate.rateLimitMessage(visitor)).toBeNull();
    expect(await hits(visitor)).toBe(0);
    expect(await rate.takeBuildRate(visitor)).toBeNull();
    expect(await hits(visitor)).toBe(1);
  });

  it("parallel takes cannot all claim the last place", async () => {
    const visitor = fresh();
    const take = (p_take: boolean) => sql()<{ refusal: string | null }[]>`
      select ledger.take_rate_hit(
        p_visitor_hash => ${visitor.hash}::text,
        p_per_hour => 3::integer,
        p_per_day => 2000000000::integer,
        p_take => ${p_take}::boolean
      ) as refusal`;
    const results = await Promise.all(
      Array.from({ length: 6 }, () => take(true)),
    );
    const refusals = results.map(([row]) => row?.refusal ?? null);
    expect(refusals.filter((r) => r === null)).toHaveLength(3);
    expect(refusals.filter((r) => r === "visitor")).toHaveLength(3);
    expect(await hits(visitor)).toBe(3);
    const [peek] = await take(false);
    expect(peek?.refusal).toBe("visitor");
    expect(await hits(visitor)).toBe(3);
  });

  it("never touches the database for an unlimited or force-limited visitor", async () => {
    const unlimited = { ...fresh(), limited: false };
    expect(await rate.takeBuildRate(unlimited)).toBeNull();
    expect(await hits(unlimited)).toBe(0);
    const forced = { ...fresh(), forceLimit: true };
    expect(await rate.takeBuildRate(forced)).toBe(limitMessage("visitor"));
    expect(await hits(forced)).toBe(0);
  });
});
