import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Visitor } from "@/platform/request/visitor";
import { LIMITS } from "../domain/limits";

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
  trusted: false,
});

describe.skipIf(!url)("Ledger's rate limit, on Postgres", () => {
  let rate: typeof import("./rate-limit").buildRate;
  let sql: typeof import("@/server/postgres").db;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    ({ buildRate: rate } = await import("./rate-limit"));
    ({ db: sql } = await import("@/server/postgres"));
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

  it("lets a visitor take the hourly allowance, then refuses for the visitor", async () => {
    const visitor = fresh();
    for (let i = 0; i < LIMITS.buildsPerVisitorPerHour; i++) {
      expect(await rate.take(visitor)).toBeNull();
    }
    expect(await hits(visitor)).toBe(LIMITS.buildsPerVisitorPerHour);
    expect(await rate.take(visitor)).toBe("visitor");
    expect(await rate.peek(visitor)).toBe("visitor");
    // A refusal records nothing.
    expect(await hits(visitor)).toBe(LIMITS.buildsPerVisitorPerHour);
    // Another visitor is not held up by this one.
    expect(await rate.peek(fresh())).toBeNull();
  });

  it("peeks without recording a hit", async () => {
    const visitor = fresh();
    expect(await rate.peek(visitor)).toBeNull();
    expect(await rate.peek(visitor)).toBeNull();
    expect(await hits(visitor)).toBe(0);
    expect(await rate.take(visitor)).toBeNull();
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

  it("never touches the database for the e2e suite", async () => {
    const trusted = { ...fresh(), trusted: true };
    expect(await rate.take(trusted)).toBeNull();
    expect(await hits(trusted)).toBe(0);
  });
});
