import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Owner } from "@/features/access/domain/owner";
import type { BuildPlan } from "../domain/build-plan";

/**
 * The Ledger repository against a real Postgres with the ledger migrations
 * applied. Skipped unless DEMO_TEST_DATABASE_URL is set. The database is
 * shared, so every row here belongs to a random Owner and visitor, and only
 * those rows are deleted afterwards.
 */
const url = process.env.DEMO_TEST_DATABASE_URL;

vi.mock("server-only", () => ({}));

const OWNER = `host:${randomUUID()}` as Owner;
const OTHER = `host:${randomUUID()}` as Owner;
const VISITOR = `ledger-db-test-${randomUUID()}`;
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,6})?\+00:00$/;

const plan = (title: string): BuildPlan => ({
  verdict: "not_found",
  title,
  layout: "mixed",
  answer: `Answer for ${title}`,
  steps: [],
});

describe.skipIf(!url)("the Ledger repository, on Postgres", () => {
  let repo: typeof import("./repository");
  let sql: typeof import("./db").sql;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    repo = await import("./repository");
    ({ sql } = await import("./db"));
  });

  afterAll(async () => {
    if (!sql) return;
    await sql()`
      delete from ledger.ask_sessions where owner in (${OWNER}, ${OTHER})`;
    await sql().end();
  });

  const build = (askSessionId: string, question: string) =>
    repo.insertBuild({
      askSessionId,
      question,
      plan: plan(question),
      model: "test/model",
      visitorHash: VISITOR,
    });

  it("creates an Ask session that only its Owner can load", async () => {
    const id = await repo.createAskSession({
      visitorHash: VISITOR,
      owner: OWNER,
    });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await repo.loadAskSession(id, OWNER)).toEqual({ id, builds: [] });
    expect(await repo.loadAskSession(id, OTHER)).toBeNull();
    expect(await repo.loadAskSession(randomUUID(), OWNER)).toBeNull();
    expect(await repo.loadAskSession("not-a-uuid", OWNER)).toBeNull();
  });

  it("numbers Builds from 0 and loads them by position with ISO timestamps", async () => {
    const id = await repo.createAskSession({
      visitorHash: VISITOR,
      owner: OWNER,
    });
    const first = await build(id, "First?");
    const second = await build(id, "Second?");
    const third = await build(id, "Third?");
    expect([first.position, second.position, third.position]).toEqual([
      0, 1, 2,
    ]);
    expect(first.createdAt).toMatch(ISO);
    expect(first.plan).toEqual(plan("First?"));

    const view = await repo.loadAskSession(id, OWNER);
    expect(view?.builds.map((b) => b.question)).toEqual([
      "First?",
      "Second?",
      "Third?",
    ]);
    expect(view?.builds.map((b) => b.position)).toEqual([0, 1, 2]);
    // The embedded rows read exactly like the rows insert returned.
    expect(view?.builds).toEqual([first, second, third]);
    for (const b of view?.builds ?? []) expect(b.createdAt).toMatch(ISO);
  });

  it("two Builds racing for one session get 0 and 1, or one hits the unique constraint", async () => {
    const id = await repo.createAskSession({
      visitorHash: VISITOR,
      owner: OWNER,
    });
    const results = await Promise.allSettled([
      build(id, "A?"),
      build(id, "B?"),
    ]);
    const stored = results.flatMap((r) =>
      r.status === "fulfilled" ? [r.value] : [],
    );
    const failed = results.flatMap((r) =>
      r.status === "rejected" ? [r.reason] : [],
    );
    if (failed.length === 0) {
      expect(stored.map((b) => b.position).sort()).toEqual([0, 1]);
    } else {
      expect(stored).toHaveLength(1);
      expect(stored[0]?.position).toBe(0);
      expect(String(failed[0])).toMatch(
        /^Error: Could not store the Build: duplicate key value violates unique constraint/,
      );
    }
  });

  it("finds the Owner's newest answered session, and nobody else's", async () => {
    expect(await repo.latestAnsweredSessionId(OTHER)).toBeNull();
    const empty = await repo.createAskSession({
      visitorHash: VISITOR,
      owner: OTHER,
    });
    expect(await repo.latestAnsweredSessionId(OTHER)).toBeNull();

    const older = await repo.createAskSession({
      visitorHash: VISITOR,
      owner: OWNER,
    });
    await build(older, "Older?");
    const newer = await repo.createAskSession({
      visitorHash: VISITOR,
      owner: OWNER,
    });
    await build(newer, "Newer?");
    expect(await repo.latestAnsweredSessionId(OWNER)).toBe(newer);
    // Another Owner with only an empty session still has nothing to land on.
    expect(await repo.latestAnsweredSessionId(OTHER)).toBeNull();
    expect(empty).not.toBe(newer);
  });
});
