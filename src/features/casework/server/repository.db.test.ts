import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Owner } from "@/features/access/domain/owner";

vi.mock("server-only", () => ({}));

/**
 * The Casework repository against a real Postgres with the casework
 * migrations applied. Skipped unless DEMO_TEST_DATABASE_URL is set. The
 * database is shared, so every row here belongs to this run's own Owner,
 * visitor hash and Case file, and only those rows are removed afterwards.
 */
const url = process.env.DEMO_TEST_DATABASE_URL;

const RUN = randomUUID().slice(0, 8);
const OWNER = `host:${randomUUID()}` as Owner;
const OTHER = `host:${randomUUID()}` as Owner;
const VISITOR = `casework-db-test-${RUN}`;
const SLUG = `casework-db-test-${RUN}`;
const PURPOSE = `casework-db-test-${RUN}`;

/** `2026-11-27T10:00:00.123456+00:00`, as the Data API printed it. */
const ISO_TZ = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?[+-]\d\d:\d\d$/;

type Repository = typeof import("./repository");

describe.skipIf(!url)("the Casework repository, on Postgres", () => {
  let repo: Repository;
  let db: ReturnType<typeof import("./db").sql>;
  let mcp: typeof import("./mcp") | undefined;
  const since = new Date(Date.now() - 1000);
  let session = "";
  let otherSession = "";
  let seedDocument = "";
  let seedSpare = "";

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    repo = await import("./repository");
    db = (await import("./db")).sql();
    mcp = await import("./mcp").catch(() => undefined);

    // This run's own Case file, with one labelled Document of a wanted Kind and one spare.
    await db`
      insert into casework.case_files (slug, scenario, title, summary, as_of, expected, split, position)
      values (${SLUG}, 'pension_withdrawal', 'Test case', 'A test', '2026-03-14',
        ${db.json({ decision: "approve" })}, 'train', 9999)`;
    const [seeded, spare] = await db<{ id: string }[]>`
      insert into casework.documents
        (case_file_slug, name, media_type, source_format, storage_path, page_paths, label_kind, label)
      values
        (${SLUG}, ${`aaa-${RUN} statement.pdf`}, 'application/pdf', 'pdf_digital',
          ${`cabinet/${SLUG}/a.pdf`}, ${["p1.jpg", "p2.jpg"]}::text[], 'bank_statement',
          ${db.json({ holder: "A. Test", balance: 12 })}),
        (${SLUG}, ${`aab-${RUN} payslip.pdf`}, 'application/pdf', 'pdf_digital',
          ${`cabinet/${SLUG}/b.pdf`}, '{}', 'payslip', null)
      returning id`;
    seedDocument = seeded?.id ?? "";
    seedSpare = spare?.id ?? "";
    await db`
      insert into casework.model_settings (purpose, model, reasoning, temperature, max_output_tokens)
      values (${PURPOSE}, 'test/model', 'low', 0.25, 500)`;
  });

  afterAll(async () => {
    if (!db) return;
    await db`delete from casework.model_settings where purpose = ${PURPOSE}`;
    await db`delete from casework.sessions where visitor_hash = ${VISITOR}`;
    await db`delete from casework.case_files where slug = ${SLUG}`;
    await db.end();
  });

  it("creates, reads and scopes Desks to their Owner", async () => {
    session = await repo.createSession(VISITOR, OWNER);
    otherSession = await repo.createSession(VISITOR, OTHER);
    expect(session).toMatch(/^[0-9a-f-]{36}$/);

    const row = await repo.getSession(session);
    expect(row).toMatchObject({ id: session, owner: OWNER, title: null });
    expect(row?.model_overrides).toEqual({});
    expect(row?.created_at).toMatch(ISO_TZ);
    expect(row?.last_active_at).toMatch(ISO_TZ);
    expect(await repo.getSession("not-a-uuid")).toBeNull();
    expect(await repo.getSession(randomUUID())).toBeNull();

    const mine = await repo.sessionsOf(OWNER, 10);
    expect(mine.map((desk) => desk.id)).toEqual([session]);
    const theirs = await repo.sessionsOf(OTHER, 10);
    expect(theirs.map((desk) => desk.id)).toEqual([otherSession]);
  });

  it("touches a Desk, names it once, and stores model overrides as jsonb", async () => {
    const before = await repo.getSession(session);
    if (!before) throw new Error("no session");
    await repo.touchSession(before, "x".repeat(100));
    const named = await repo.getSession(session);
    expect(named?.title).toBe("x".repeat(80));
    expect(named?.last_active_at).toMatch(ISO_TZ);
    if (!named) throw new Error("no session");
    await repo.touchSession(named, "a second title");
    expect((await repo.getSession(session))?.title).toBe("x".repeat(80));

    await repo.setModelOverrides(session, {
      chat: { model: "zai/glm-5.3-flash", temperature: 0.5 },
    });
    const [raw] = await db<{ kind: string }[]>`
      select jsonb_typeof(model_overrides) as kind from casework.sessions where id = ${session}`;
    expect(raw?.kind).toBe("object");
    expect((await repo.getSession(session))?.model_overrides).toEqual({
      chat: { model: "zai/glm-5.3-flash", temperature: 0.5 },
    });
  });

  it("reads org model settings with a numeric temperature as a number", async () => {
    const settings = (await repo.orgModelSettings()) as Record<string, unknown>;
    expect(settings[PURPOSE]).toEqual({
      model: "test/model",
      reasoning: "low",
      temperature: 0.25,
      maxOutputTokens: 500,
    });
  });

  it("reads the Cabinet: Case files, seed Documents and their labels", async () => {
    const cases = await repo.loadCaseFiles();
    const mine = cases.find((item) => item.slug === SLUG);
    expect(mine).toEqual({
      slug: SLUG,
      scenario: "pension_withdrawal",
      title: "Test case",
      summary: "A test",
      as_of: "2026-03-14",
      split: "train",
      position: 9999,
    });
    const positions = cases.map((item) => item.position);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));

    const seeds = await repo.loadSeedDocuments();
    const seed = seeds.find((document) => document.id === seedDocument);
    expect(seed).toMatchObject({
      case_file_slug: SLUG,
      session_id: null,
      page_paths: ["p1.jpg", "p2.jpg"],
      size_bytes: 0,
      label_kind: "bank_statement",
      label: { holder: "A. Test", balance: 12 },
    });
    expect(seed?.created_at).toMatch(ISO_TZ);
    expect(
      seeds.find((document) => document.id === seedSpare)?.page_paths,
    ).toEqual([]);
  });

  it("files uploads with their page paths and keeps them to their Desk", async () => {
    const upload = await repo.insertUpload({
      sessionId: session,
      name: `zzz-${RUN} scan.pdf`,
      mediaType: "application/pdf",
      sourceFormat: "pdf_scanned",
      storagePath: `uploads/${session}/scan.pdf`,
      pagePaths: [
        `uploads/${session}/page-1.jpg`,
        `uploads/${session}/page-2.jpg`,
      ],
      sizeBytes: 2048,
    });
    expect(upload).toMatchObject({
      session_id: session,
      case_file_slug: null,
      page_paths: [
        `uploads/${session}/page-1.jpg`,
        `uploads/${session}/page-2.jpg`,
      ],
      size_bytes: 2048,
      label_kind: null,
    });
    expect("label" in upload).toBe(false);
    expect(upload.created_at).toMatch(ISO_TZ);
    const empty = await repo.insertUpload({
      sessionId: session,
      name: `zzz-${RUN} photo.jpg`,
      mediaType: "image/jpeg",
      sourceFormat: "image",
      storagePath: `uploads/${session}/photo.jpg`,
      pagePaths: [],
      sizeBytes: 10,
    });
    expect(empty.page_paths).toEqual([]);
    expect(repo.toRunDocument(empty).pageCount).toBe(1);

    expect(await repo.countUploads(session)).toBe(2);
    expect(await repo.countUploads(otherSession)).toBe(0);
    const uploads = await repo.loadUploads(session);
    expect(uploads.map((document) => document.name)).toEqual([
      `zzz-${RUN} photo.jpg`,
      `zzz-${RUN} scan.pdf`,
    ]);
    expect(await repo.loadUploads(otherSession)).toHaveLength(0);

    const cabinet = await repo.loadCabinetDocuments(session);
    expect(cabinet.some((document) => document.id === upload.id)).toBe(true);
    expect(cabinet.some((document) => document.id === seedDocument)).toBe(true);
    const otherCabinet = await repo.loadCabinetDocuments(otherSession);
    expect(otherCabinet.some((document) => document.id === upload.id)).toBe(
      false,
    );
    expect(otherCabinet.some((document) => document.id === seedDocument)).toBe(
      true,
    );
    const names = cabinet.map((document) => document.name);
    expect(names).toEqual(
      [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    );

    // uuid[] cast: the Cabinet's and the Desk's own, never another Desk's.
    const byIds = await repo.documentsByIds(
      [upload.id, seedDocument, "junk"],
      session,
    );
    expect(byIds.map((document) => document.id).sort()).toEqual(
      [upload.id, seedDocument].sort(),
    );
    expect(
      (await repo.documentsByIds([upload.id, seedDocument], otherSession)).map(
        (document) => document.id,
      ),
    ).toEqual([seedDocument]);
    expect(await repo.documentsByIds(["junk"], session)).toEqual([]);

    // text[] casts: Kinds in the same Case file, plus this Desk's uploads.
    const candidates = await repo.candidateDocuments(
      session,
      [seedDocument],
      ["payslip"],
    );
    expect(candidates.map((document) => document.id).sort()).toEqual(
      [seedSpare, upload.id, empty.id].sort(),
    );
    expect(
      await repo.candidateDocuments(null, [seedDocument], ["passport"]),
    ).toEqual([]);

    expect(await repo.asOfFor(byIds)).toBe("2026-03-14");
    expect(await repo.asOfFor([upload])).toBe(
      new Date().toISOString().slice(0, 10),
    );
  });

  it("keeps Messages with their arrays and tool calls, and counts them through the Desk", async () => {
    const first = await repo.addMessage({
      sessionId: session,
      role: "user",
      text: "Review this",
      documentIds: [seedDocument],
    });
    const second = await repo.addMessage({
      sessionId: session,
      role: "specialist",
      text: "Done",
      toolCalls: [{ name: "read", input: { id: seedDocument }, ok: true }],
    });
    await repo.addMessage({
      sessionId: otherSession,
      role: "user",
      text: "Hi",
    });
    expect(typeof first).toBe("number");
    expect(second).toBeGreaterThan(first);

    const messages = await repo.loadMessages(session);
    expect(messages.map((message) => message.id)).toEqual([first, second]);
    expect(messages[0]).toMatchObject({
      document_ids: [seedDocument],
      run_id: null,
      tool_calls: [],
    });
    expect(messages[1]?.tool_calls).toEqual([
      { name: "read", input: { id: seedDocument }, ok: true },
    ]);
    expect(messages[1]?.created_at).toMatch(ISO_TZ);
    expect((await repo.loadMessages(session, 1)).map((m) => m.id)).toEqual([
      second,
    ]);
    const [kind] = await db<{ kind: string }[]>`
      select jsonb_typeof(tool_calls) as kind from casework.messages where id = ${second}`;
    expect(kind?.kind).toBe("array");

    // Only the user's Messages, joined to the Desk for its visitor hash.
    expect(await repo.countMessages({ visitorHash: VISITOR, since })).toBe(2);
    expect(
      await repo.countMessages({ visitorHash: `${VISITOR}-nobody`, since }),
    ).toBe(0);
    expect(
      await repo.countMessages({
        visitorHash: VISITOR,
        since: new Date(Date.now() + 60_000),
      }),
    ).toBe(0);
    expect(await repo.countMessages({ since })).toBeGreaterThanOrEqual(2);
  });

  it("runs Runs: arrays on insert and update, jsonb state, and the Job upsert", async () => {
    const run = await repo.createRun({
      sessionId: session,
      pipeline: null,
      jobs: ["sort", "read"],
      documentIds: [seedDocument],
      visitorHash: VISITOR,
    });
    const created = await repo.getRun(run);
    expect(created).toMatchObject({
      session_id: session,
      pipeline: null,
      jobs: ["sort", "read"],
      document_ids: [seedDocument],
      status: "queued",
      state: null,
      completed_at: null,
    });
    expect(created?.created_at).toMatch(ISO_TZ);

    const completedAt = new Date().toISOString();
    await repo.updateRun(run, {
      status: "completed",
      pipeline: "pension_withdrawal" as never,
      jobs: ["sort", "read", "decide"] as never,
      document_ids: [seedDocument, seedSpare],
      state: { documents: [{ id: seedDocument }], note: "ok" } as never,
      recommendation: "approve",
      completed_at: completedAt,
      error: undefined,
    });
    const updated = await repo.getRun(run);
    expect(updated).toMatchObject({
      status: "completed",
      pipeline: "pension_withdrawal",
      jobs: ["sort", "read", "decide"],
      document_ids: [seedDocument, seedSpare],
      state: { documents: [{ id: seedDocument }], note: "ok" },
      recommendation: "approve",
      error: null,
    });
    expect(updated?.completed_at).toMatch(ISO_TZ);
    expect(Date.parse(updated?.completed_at ?? "")).toBe(
      Date.parse(completedAt),
    );
    const [stateKind] = await db<{ kind: string }[]>`
      select jsonb_typeof(state) as kind from casework.runs where id = ${run}`;
    expect(stateKind?.kind).toBe("object");

    await repo.updateRun(run, { state: null, document_ids: [] });
    expect(await repo.getRun(run)).toMatchObject({
      state: null,
      document_ids: [],
    });
    await repo.updateRun(run, {});
    expect(await repo.getRun("nope")).toBeNull();

    await repo.recordJobRun({
      runId: run,
      position: 0,
      job: "sort",
      status: "running",
    });
    await repo.recordJobRun({
      runId: run,
      position: 0,
      job: "sort",
      status: "done",
      summary: "Sorted",
      output: ["a", { b: 1 }],
    });
    await repo.recordJobRun({
      runId: run,
      position: 1,
      job: "read",
      status: "waiting",
      output: "just text",
    });
    const jobRuns = await db<
      {
        position: number;
        status: string;
        summary: string | null;
        output: unknown;
        kind: string | null;
        finished_at: string | null;
      }[]
    >`
      select position, status, summary, output, jsonb_typeof(output) as kind, finished_at
      from casework.job_runs where run_id = ${run} order by position`;
    expect(jobRuns).toHaveLength(2);
    expect(jobRuns[0]).toMatchObject({
      status: "done",
      summary: "Sorted",
      output: ["a", { b: 1 }],
      kind: "array",
    });
    expect(jobRuns[0]?.finished_at).toMatch(ISO_TZ);
    expect(jobRuns[1]).toMatchObject({
      status: "waiting",
      output: "just text",
      kind: "string",
      finished_at: null,
    });

    const active = await repo.createRun({
      sessionId: session,
      pipeline: null,
      jobs: [],
      documentIds: [],
      visitorHash: VISITOR,
    });
    expect((await repo.getRun(active))?.jobs).toEqual([]);
    const all = await repo.runsForSession(session);
    expect(all.map((row) => row.id)).toEqual([active, run]);
    expect((await repo.activeRuns(session)).map((row) => row.id)).toEqual([
      active,
    ]);
    expect(await repo.runsForSession(otherSession)).toHaveLength(0);
    expect(await repo.countRuns({ visitorHash: VISITOR, since })).toBe(2);
    expect(
      await repo.countRuns({ visitorHash: `${VISITOR}-nobody`, since }),
    ).toBe(0);
    expect(await repo.countRuns({ since })).toBeGreaterThanOrEqual(2);
  });

  it("asks Questions: the token upsert, open ones and answers as jsonb", async () => {
    const run = await repo.createRun({
      sessionId: session,
      pipeline: null,
      jobs: ["decide"],
      documentIds: [],
      visitorHash: VISITOR,
    });
    const token = `token-${RUN}-${randomUUID()}`;
    const wants = {
      kinds: ["payslip"],
      options: [{ value: "yes", label: "Yes" }],
    };
    const id = await repo.createQuestion({
      runId: run,
      job: "decide",
      token,
      prompt: "First?",
      wants,
    });
    const again = await repo.createQuestion({
      runId: run,
      job: "decide",
      token,
      prompt: "Second?",
      wants: { ...wants, suggestions: [{ id: seedDocument, name: "S" }] },
    });
    expect(again).toBe(id);
    const question = await repo.getQuestion(id);
    expect(question).toMatchObject({
      run_id: run,
      prompt: "Second?",
      wants: { ...wants, suggestions: [{ id: seedDocument, name: "S" }] },
      answer: null,
      answered_at: null,
    });
    expect(question?.created_at).toMatch(ISO_TZ);
    expect(await repo.getQuestion("nope")).toBeNull();

    expect((await repo.openQuestions([run])).map((q) => q.id)).toEqual([id]);
    expect(await repo.openQuestions([])).toEqual([]);
    expect(await repo.openQuestions([randomUUID()])).toEqual([]);

    await repo.markAnswered(id, { text: "yes" } as never);
    const answered = await repo.getQuestion(id);
    expect(answered?.answer).toEqual({ text: "yes" });
    expect(answered?.answered_at).toMatch(ISO_TZ);
    await repo.markAnswered(id, { text: "changed" } as never);
    expect((await repo.getQuestion(id))?.answer).toEqual({ text: "yes" });
    expect(await repo.openQuestions([run])).toEqual([]);

    // A stopped Run closes its open Jobs and Questions.
    const open = await repo.createQuestion({
      runId: run,
      job: "decide",
      token: `${token}-2`,
      prompt: "Still there?",
      wants,
    });
    await repo.recordJobRun({
      runId: run,
      position: 0,
      job: "decide",
      status: "waiting",
    });
    await repo.recordJobRun({
      runId: run,
      position: 1,
      job: "decide",
      status: "done",
    });
    await repo.closeStoppedRun(run);
    expect((await repo.getQuestion(open))?.answer).toEqual({
      skip: true,
      text: "Stopped",
    });
    expect((await repo.getQuestion(id))?.answer).toEqual({ text: "yes" });
    const statuses = await db<{ status: string }[]>`
      select status from casework.job_runs where run_id = ${run} order by position`;
    expect(statuses.map((row) => row.status)).toEqual(["stopped", "done"]);
  });

  it("records spend and adds it up by Run, Desk and purpose", async () => {
    const run = await repo.createRun({
      sessionId: session,
      pipeline: null,
      jobs: ["read"],
      documentIds: [],
      visitorHash: VISITOR,
    });
    const call = {
      sessionId: session,
      runId: run,
      purpose: "read" as never,
      model: "test/model",
      inputTokens: 100,
      outputTokens: 20,
      reasoningTokens: 5,
      cachedInputTokens: 0,
      costUsd: 0.0012345678,
      latencyMs: 300,
    };
    await repo.recordModelCall(call);
    await repo.recordModelCall({ ...call, costUsd: 0.5 });
    await repo.recordModelCall({
      ...call,
      runId: null,
      purpose: "chat" as never,
    });

    const costs = await repo.runCosts([run]);
    expect(costs.get(run)?.calls).toBe(2);
    expect(costs.get(run)?.costUsd).toBeCloseTo(0.501235, 6);
    expect((await repo.runCosts([])).size).toBe(0);

    const bySession = await repo.spendBySession([session, otherSession]);
    expect(bySession.get(session)).toBeCloseTo(0.50247, 6);
    expect(bySession.has(otherSession)).toBe(false);

    const spend = await repo.sessionSpend(session);
    const read = spend.find((row) => row.purpose === ("read" as never));
    expect(read).toMatchObject({
      calls: 2,
      inputTokens: 200,
      outputTokens: 40,
    });
    expect(typeof read?.costUsd).toBe("number");
    expect(await repo.sessionSpend(otherSession)).toEqual([]);
  });

  it("gives an outside MCP client one shared desk", async () => {
    if (!mcp) throw new Error("mcp.ts could not be imported");
    const [before] = await db<{ n: number }[]>`
      select count(*)::int as n from casework.sessions where visitor_hash = 'mcp-external'`;
    const first = await mcp.externalSession();
    try {
      const second = await mcp.externalSession();
      expect(second).toBe(first);
      expect((await repo.getSession(first))?.owner).toBeNull();
    } finally {
      // Remove the desk only when this test made it.
      if (before?.n === 0)
        await db`delete from casework.sessions where id = ${first}`;
    }
  });

  it("deletes a visitor's Desks and everything under them", async () => {
    const extra = `${VISITOR}-gone`;
    const desk = await repo.createSession(extra, OWNER);
    await repo.addMessage({ sessionId: desk, role: "user", text: "bye" });
    await repo.deleteSessionsByVisitor(extra);
    expect(await repo.getSession(desk)).toBeNull();
    expect(await repo.getSession(session)).not.toBeNull();
  });
});
