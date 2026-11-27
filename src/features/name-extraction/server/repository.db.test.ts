import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Owner } from "@/features/access/domain/owner";
import { DEFAULT_MODELS, DEFAULT_RULEBOOK } from "../domain/contract";

vi.mock("server-only", () => ({}));

/**
 * The repository against a real Postgres with the `name_extraction`
 * migration applied. Skipped unless DEMO_TEST_DATABASE_URL is set. The
 * database is shared, so every row belongs to a random Owner of this run and
 * nothing is truncated or dropped.
 */
const url = process.env.DEMO_TEST_DATABASE_URL;

const OWNER = `host:${randomUUID()}` as Owner;
const OTHER = `host:${randomUUID()}` as Owner;
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?\+00:00$/;

describe.skipIf(!url)("Sieve's repository, on Postgres", () => {
  let repo: typeof import("./repository");
  let db: typeof import("./db");

  const newRun = (owner: Owner = OWNER, limits = null as never) =>
    repo.createRun({
      owner,
      visitorHash: `visitor-${owner}`,
      title: "A long title ".repeat(30),
      pages: 12,
      source: { kind: "corpus", corpusId: "train-01" },
      models: DEFAULT_MODELS,
      rulebookVersion: 0,
      rulebook: DEFAULT_RULEBOOK,
      limits,
    });

  const runId = async (owner: Owner = OWNER) => {
    const made = await newRun(owner);
    if (!("runId" in made)) throw new Error(made.refusal);
    return made.runId;
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    repo = await import("./repository");
    db = await import("./db");
  });

  afterAll(async () => {
    await db?.sql().end();
  });

  it("creates a Run through create_run and reads it back as the Data API did", async () => {
    const id = await runId();
    const row = await repo.ownedRun(OWNER, id);
    expect(row).not.toBeNull();
    expect(row?.owner).toBe(OWNER);
    expect(row?.title).toHaveLength(200);
    expect(row?.pages).toBe(12);
    expect(row?.status).toBe("queued");
    expect(row?.source).toEqual({ kind: "corpus", corpusId: "train-01" });
    expect(row?.models).toEqual(DEFAULT_MODELS);
    expect(row?.rulebook).toEqual(DEFAULT_RULEBOOK);
    expect(row?.names).toEqual([]);
    expect(row?.score).toBeNull();
    expect(row?.started_at).toMatch(ISO);
    expect(row?.ended_at).toBeNull();
    expect(Number(row?.cost_usd)).toBe(0);
    expect(repo.toSummary(row as never).models).toEqual(DEFAULT_MODELS);

    expect(await repo.getRunRow(id)).toEqual(row);
    expect(await repo.runStatus(id)).toBe("queued");
    expect(await repo.getRunRow("not-a-uuid")).toBeNull();
  });

  it("refuses a Run over the Owner's limits", async () => {
    const owner = `host:${randomUUID()}` as Owner;
    const limits = {
      perOwnerPerDay: 10,
      perVisitorPerHour: 10,
      activePerOwner: 1,
    };
    const first = await newRun(owner, limits as never);
    expect(first).toHaveProperty("runId");
    const second = await newRun(owner, limits as never);
    expect(second).toEqual({
      refusal: "You already have 1 run going. Stop one or let it finish first.",
    });
  });

  it("scopes Runs to their Owner", async () => {
    const mine = await runId();
    const theirs = await runId(OTHER);
    expect(await repo.ownedRun(OTHER, mine)).toBeNull();
    expect(await repo.ownedRun(OWNER, theirs)).toBeNull();
    const listed = await repo.runsOf(OWNER);
    expect(listed.map((run) => run.id)).toContain(mine);
    expect(listed.every((run) => run.owner === OWNER)).toBe(true);
    const starts = listed.map((run) => Date.parse(run.started_at));
    expect([...starts].sort((a, b) => b - a)).toEqual(starts);
    expect(await repo.runsOf(OWNER, 1)).toHaveLength(1);
  });

  it("patches a Run with jsonb kept as JSON and null kept null", async () => {
    const id = await runId();
    const names = [{ name: "Ana Vel", type: "person", pages: [1, 2] }];
    const score = { recall: 0.9, precision: 0.8 };
    await repo.updateRun(id, {
      status: "running",
      workflow_run_id: "wf-1",
      names: names as never,
      score: score as never,
      cost_usd: 0.0125,
    });
    let row = await repo.getRunRow(id);
    expect(row?.status).toBe("running");
    expect(row?.workflow_run_id).toBe("wf-1");
    expect(row?.names).toEqual(names);
    expect(Array.isArray(row?.names)).toBe(true);
    expect(row?.score).toEqual(score);
    expect(row?.cost_usd).toBe("0.012500");

    await repo.updateRun(id, { score: null, error: null });
    row = await repo.getRunRow(id);
    expect(row?.score).toBeNull();
    expect(row?.names).toEqual(names);

    const [raw] = await db.sql()<
      { score_type: string | null; names_type: string }[]
    >`
      select jsonb_typeof(score) as score_type, jsonb_typeof(names) as names_type
      from name_extraction.runs where id = ${id}
    `;
    expect(raw).toEqual({ score_type: null, names_type: "array" });
  });

  it("ends a Run once, and only while it is going", async () => {
    const id = await runId();
    expect(
      await repo.endRunIfGoing(id, {
        status: "completed",
        gate_passed: true,
        stopped_by: "turns",
        names: [] as never,
        score: { recall: 1 } as never,
      }),
    ).toBe(true);
    expect(await repo.endRunIfGoing(id, { status: "stopped" })).toBe(false);
    const row = await repo.getRunRow(id);
    expect(row?.status).toBe("completed");
    expect(row?.gate_passed).toBe(true);
    expect(row?.stopped_by).toBe("turns");
    expect(row?.score).toEqual({ recall: 1 });
    expect(row?.ended_at).toMatch(ISO);
    expect(repo.isOver(row?.status as never)).toBe(true);
  });

  it("appends events in array order and reads them after a cursor", async () => {
    const id = await runId();
    await repo.insertEvents(id, [
      { type: "start", at: 1_000 } as never,
      { type: "note", text: "one" } as never,
      { type: "names", names: [{ name: "A" }] } as never,
      { type: "note", text: "two" } as never,
      { type: "names", names: [{ name: "B" }] } as never,
    ]);
    await repo.insertEvents(id, []);
    const all = await repo.eventsAfter(id, 0);
    expect(all.map((event) => event.type)).toEqual([
      "start",
      "note",
      "names",
      "note",
      "names",
    ]);
    const seqs = all.map((event) => event.seq);
    expect(seqs.every((seq) => typeof seq === "number")).toBe(true);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    expect(all[0].at).toBe(1_000);
    expect(all[1]).toMatchObject({ type: "note", text: "one" });

    const after = await repo.eventsAfter(id, seqs[1], 2);
    expect(after.map((event) => event.seq)).toEqual([seqs[2], seqs[3]]);

    expect(await repo.latestNames(id)).toEqual([{ name: "B" }]);
    expect(await repo.latestNames(await runId())).toBeNull();
    // Another Run's events are not this Run's.
    expect(await repo.eventsAfter(await runId(), 0)).toEqual([]);
  });

  it("pages every event past 1000", async () => {
    const id = await runId();
    const events = Array.from({ length: 1_203 }, (_, i) => ({
      type: "note",
      i,
    }));
    await repo.insertEvents(id, events as never);
    const all = await repo.allEvents(id);
    expect(all).toHaveLength(1_203);
    expect(all.map((event) => (event as unknown as { i: number }).i)).toEqual(
      events.map((event) => event.i),
    );
    expect(await repo.allEvents(id, 1_000)).toHaveLength(1_000);
  });

  it("records model calls and sums a Run's spend", async () => {
    const id = await runId();
    expect(await repo.runSpend(id)).toBe(0);
    const call = {
      runId: id,
      model: "openai/gpt-6.1-terra",
      inputTokens: 1000.4,
      outputTokens: -5,
      cachedInputTokens: 10,
      latencyMs: 120.6,
    };
    await repo.recordModelCall({
      ...call,
      purpose: "analyst",
      costUsd: 0.0123,
    });
    await repo.recordModelCall({ ...call, purpose: "reader", costUsd: 0.0002 });
    expect(await repo.runSpend(id)).toBeCloseTo(0.0125, 6);
    const rows = await db.sql()<
      { input_tokens: number; output_tokens: number; latency_ms: number }[]
    >`
      select input_tokens, output_tokens, latency_ms from name_extraction.model_calls
      where run_id = ${id} order by id
    `;
    expect(rows[0]).toEqual({
      input_tokens: 1000,
      output_tokens: 0,
      latency_ms: 121,
    });
  });

  it("saves Rulebook versions through save_rulebook, per Owner", async () => {
    const owner = `host:${randomUUID()}` as Owner;
    expect(await repo.currentRulebook(owner)).toEqual(repo.DEFAULT_VERSION);
    const edited = { ...DEFAULT_RULEBOOK, reviewBelow: 0.7 };
    expect(await repo.insertRulebook(owner, edited, "first", null)).toEqual({
      version: 1,
    });
    expect(await repo.insertRulebook(owner, DEFAULT_RULEBOOK, null, 5)).toEqual(
      { version: 2 },
    );
    expect(await repo.insertRulebook(owner, edited, null, 2)).toEqual({
      refusal:
        "That's 2 Rulebook saves today, the demo's daily limit. Try again tomorrow.",
    });

    const current = await repo.currentRulebook(owner);
    expect(current.version).toBe(2);
    expect(current.rulebook).toEqual(DEFAULT_RULEBOOK);
    expect(current.note).toBeNull();
    expect(current.createdAt).toMatch(ISO);

    const versions = await repo.rulebookVersions(owner);
    expect(versions.map((v) => v.version)).toEqual([2, 1, 0]);
    expect(versions[1]).toMatchObject({ rulebook: edited, note: "first" });
    expect(
      (await repo.rulebookVersions(owner, 1)).map((v) => v.version),
    ).toEqual([2, 0]);
    expect(await repo.rulebookVersions(OTHER)).toEqual([repo.DEFAULT_VERSION]);
  });

  it("stores Uploads per Owner and counts them since a time", async () => {
    const owner = `host:${randomUUID()}` as Owner;
    const before = new Date(Date.now() - 60_000);
    const id = randomUUID();
    await repo.insertUpload({
      id,
      owner,
      title: "Statement",
      pages: 3,
      storagePath: `uploads/test/${id}.json`,
    });
    const row = await repo.ownedUpload(owner, id);
    expect(row).toMatchObject({ id, owner, title: "Statement", pages: 3 });
    expect(row?.created_at).toMatch(ISO);
    expect(await repo.getUpload(id)).toEqual(row);
    expect(await repo.ownedUpload(OTHER, id)).toBeNull();
    expect(await repo.ownedUpload(owner, "nope")).toBeNull();

    expect(await repo.countUploadsSince(owner, before)).toBe(1);
    expect(
      await repo.countUploadsSince(owner, new Date(Date.now() + 60_000)),
    ).toBe(0);
    expect(await repo.countUploadsSince(OTHER, before)).toBe(0);
  });
});
