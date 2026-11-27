import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { Owner } from "@/features/access/domain/owner";
import {
  ConflictError,
  InvalidError,
  LimitError,
  NotFoundError,
} from "@/platform/errors";
import {
  DEFAULT_MODELS,
  DEFAULT_RULEBOOK,
  type ExtractedName,
} from "../../domain/contract";
import { generateDocument } from "../../domain/corpus";
import { LIMITS } from "../../domain/limits";
import type { SievePorts } from "../ports";
import type { RunRow, StoredEvent } from "../run-row";
import type { SieveClaims } from "../toolkit/mcp-token";
import { createSieveServices } from ".";

const ME = "guest:6c1c3a0e-7f7e-4b8e-9d55-0d1d1f0a0b0c" as Owner;
const OTHER = "host:someone-else" as Owner;
const RUN = "11111111-1111-4111-8111-111111111111";
const UPLOAD = "22222222-2222-4222-8222-222222222222";
const visitor = { hash: "v", trusted: false };
const trusted = { hash: "e2e", trusted: true };
const NOW = Date.parse("2026-11-27T10:00:00Z");

function runRow(overrides: Partial<RunRow> = {}): RunRow {
  return {
    id: RUN,
    owner: ME,
    title: "A run",
    pages: 10,
    source: { kind: "corpus", corpusId: "ne-te-01" },
    status: "running",
    models: DEFAULT_MODELS,
    rulebook_version: 0,
    rulebook: DEFAULT_RULEBOOK,
    workflow_run_id: "wf-1",
    cost_usd: 0,
    names: [],
    score: null,
    error: null,
    gate_passed: null,
    stopped_by: null,
    visitor_hash: "v",
    started_at: new Date(NOW - 60_000).toISOString(),
    ended_at: null,
    ...overrides,
  };
}

/** Fake ports over one stored Run; `calls` lists what reached the outside world. */
function fakes(run: RunRow | null = runRow()) {
  const calls: string[] = [];
  const ended: Record<string, unknown>[] = [];
  let created: Parameters<SievePorts["runs"]["create"]>[0] | undefined;
  const ports: SievePorts = {
    runs: {
      create: async (input) => {
        created = input;
        calls.push("create");
        return { runId: RUN };
      },
      owned: async (owner, id) =>
        run && run.owner === owner && run.id === id ? run : null,
      get: async () => run,
      list: async (owner) => (run && run.owner === owner ? [run] : []),
      setWorkflow: async () => {
        calls.push("setWorkflow");
      },
      endIfGoing: async (_id, patch) => {
        ended.push(patch);
        calls.push(`end:${patch.status}`);
        return true;
      },
    },
    events: {
      append: async (_id, events) => {
        calls.push(`append:${events.map((event) => event.type).join(",")}`);
      },
      after: async () => [],
      all: async () => {
        calls.push("events");
        return [];
      },
      latestNames: async () => null,
    },
    rulebooks: {
      current: async () => ({
        version: 0,
        rulebook: DEFAULT_RULEBOOK,
        createdAt: new Date(0).toISOString(),
        note: null,
      }),
      versions: async () => [],
      save: async (_owner, _rulebook, _note, cap) => {
        calls.push(`save:${cap}`);
        return { version: 3 };
      },
    },
    uploads: {
      insert: async () => {
        calls.push("insertUpload");
      },
      owned: async (owner, id) =>
        owner === ME && id === UPLOAD
          ? {
              id: UPLOAD,
              owner: ME,
              title: "Mine",
              pages: 4,
              storage_path: "uploads/x/y.json",
              created_at: new Date(NOW).toISOString(),
            }
          : null,
      countSince: async () => LIMITS.uploadsPerOwnerPerDay,
    },
    store: {
      signedUploadUrl: async (path) => {
        calls.push("signedUrl");
        return { signedUrl: `https://storage/${path}`, token: "t" };
      },
    },
    loadDocument: async (source) => {
      calls.push(`load:${source.kind}`);
      return { id: "d", title: "Mine", pages: ["one", "two", "three", "four"] };
    },
    workflows: {
      start: async () => {
        calls.push("workflow");
        return "wf-2";
      },
      cancel: async () => {
        calls.push("cancel");
      },
    },
    sandbox: {
      dispose: async () => {
        calls.push("dispose");
      },
    },
    signToken: (claims) => JSON.stringify(claims),
    stub: false,
    now: () => NOW,
    newId: () => "33333333-3333-4333-8333-333333333333",
    wait: async () => {},
  };
  return {
    ports,
    calls,
    ended,
    created: () => created,
  };
}

describe("Runs are their Owner's alone", () => {
  it("answers another Owner's Run as not found, for every way in", async () => {
    const { ports, calls } = fakes();
    const { runs, preview } = createSieveServices(ports);
    const signal = new AbortController().signal;
    for (const attempt of [
      () => runs.detail(OTHER, RUN),
      () => runs.report(OTHER, RUN, 30),
      () => runs.stop(OTHER, RUN),
      () => runs.follow(OTHER, RUN, 0, signal),
      () => preview.comparison(OTHER, RUN),
      () =>
        preview.overview(OTHER, {
          source: { kind: "upload", uploadId: UPLOAD },
          runId: RUN,
        }),
    ])
      await expect(attempt()).rejects.toBeInstanceOf(NotFoundError);
    expect(calls.filter((call) => call !== "events")).toEqual([]);
    expect(await runs.list(OTHER)).toEqual([]);
  });

  it("previews only the Owner's own Upload, and a Run's own Document", async () => {
    const { ports, calls } = fakes(
      runRow({
        status: "completed",
        ended_at: new Date(NOW).toISOString(),
        names: [
          {
            canonical: generateDocument("ne-te-01").answerKey[0].canonical,
            type: "person",
            aliases: [],
            roles: [],
            mentions: [{ page: 2, quote: "x" }],
            confidence: 1,
            foundBy: ["reader"],
          } satisfies ExtractedName,
        ],
      }),
    );
    const { preview } = createSieveServices(ports);
    await expect(
      preview.overview(OTHER, {
        source: { kind: "upload", uploadId: UPLOAD },
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(calls).toEqual([]);
    // With a Run, the query's source is ignored: the Run brings its own.
    const view = await preview.overview(ME, {
      source: { kind: "upload", uploadId: UPLOAD },
      runId: RUN,
    });
    expect(view.pages).toBe(10);
    expect(view.density[1]).toBe(1);
    expect(calls).toEqual([]);
  });

  it("refuses a preview read past its page cap before loading anything", async () => {
    const { ports, calls } = fakes();
    const { preview } = createSieveServices(ports);
    const source = { kind: "upload" as const, uploadId: UPLOAD };
    await expect(
      preview.pages(ME, { source, from: 1, to: LIMITS.previewPages + 1 }),
    ).rejects.toBeInstanceOf(InvalidError);
    await expect(
      preview.pages(ME, { source, from: 5, to: 4 }),
    ).rejects.toBeInstanceOf(InvalidError);
    expect(calls).toEqual([]);
  });
});

describe("Starting a Run", () => {
  it("counts the caps for a visitor and skips them only for the trusted suite", async () => {
    const live = fakes();
    await createSieveServices(live.ports).runs.start(
      { owner: ME, visitor },
      { source: { kind: "corpus", corpusId: "ne-tr-01" } },
    );
    expect(live.created()?.limits).toEqual({
      perOwnerPerDay: LIMITS.runsPerOwnerPerDay,
      perVisitorPerHour: LIMITS.runsPerVisitorPerHour,
      activePerOwner: LIMITS.activePerOwner,
    });
    expect(live.calls).toEqual(["create", "workflow", "setWorkflow"]);

    const suite = fakes();
    await createSieveServices(suite.ports).runs.start(
      { owner: "e2e" as Owner, visitor: trusted },
      { source: { kind: "corpus", corpusId: "ne-tr-01" } },
    );
    expect(suite.created()?.limits).toBeNull();
  });

  it("starts no workflow when a cap refuses, or for another Owner's Upload", async () => {
    const capped = fakes();
    capped.ports.runs.create = async () => ({
      refusal: "That's 20 runs today.",
    });
    await expect(
      createSieveServices(capped.ports).runs.start(
        { owner: ME, visitor },
        { source: { kind: "corpus", corpusId: "ne-tr-01" } },
      ),
    ).rejects.toBeInstanceOf(LimitError);
    expect(capped.calls).not.toContain("workflow");

    const theirs = fakes();
    await expect(
      createSieveServices(theirs.ports).runs.start(
        { owner: OTHER, visitor },
        { source: { kind: "upload", uploadId: UPLOAD } },
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(theirs.calls).toEqual([]);
  });

  it("closes the row with an end event when the workflow cannot start", async () => {
    const { ports, calls } = fakes();
    ports.workflows.start = async () => {
      throw new Error("queue down");
    };
    await expect(
      createSieveServices(ports).runs.start(
        { owner: ME, visitor },
        { source: { kind: "corpus", corpusId: "ne-tr-01" } },
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(calls).toEqual(["create", "end:failed", "append:end"]);
  });
});

describe("Stopping a Run", () => {
  it("closes the row first, then cancels the workflow and stops the Sandbox", async () => {
    const { ports, calls } = fakes();
    ports.workflows.cancel = async () => {
      calls.push("cancel");
      throw new Error("already gone");
    };
    const stopped = await createSieveServices(ports).runs.stop(ME, RUN);
    expect(stopped).toEqual({ runId: RUN, stopped: true, status: "stopped" });
    expect(calls).toEqual([
      "end:stopped",
      "append:log,end",
      "cancel",
      "dispose",
    ]);
  });

  it("leaves a Run that is already over as it ended", async () => {
    const { ports, calls } = fakes(runRow({ status: "completed" }));
    expect(await createSieveServices(ports).runs.stop(ME, RUN)).toEqual({
      runId: RUN,
      stopped: false,
      status: "completed",
    });
    expect(calls).toEqual([]);
  });
});

describe("The events stream", () => {
  it("writes the end a dead workflow never wrote, once the grace polls pass", async () => {
    const over = runRow({ status: "failed", error: "lost" });
    const { ports } = fakes(over);
    ports.events.after = async () =>
      [
        { seq: 4, at: NOW, type: "log", level: "info", text: "x" },
      ] as StoredEvent[];
    const stream = await createSieveServices(ports).runs.follow(
      ME,
      RUN,
      0,
      new AbortController().signal,
    );
    const seen: StoredEvent[] = [];
    for await (const event of stream) seen.push(event);
    expect(seen.map((event) => event.type)).toEqual(["log", "end"]);
    expect(seen[1]).toMatchObject({ seq: 4, status: "failed", error: "lost" });
  });
});

describe("Rulebooks and Uploads", () => {
  it("refuses a Rulebook that drops what it would flag, and caps a visitor's saves", async () => {
    const { ports, calls } = fakes();
    const { rulebooks } = createSieveServices(ports);
    await expect(
      rulebooks.save(
        { owner: ME, visitor },
        { rulebook: { ...DEFAULT_RULEBOOK, dropBelow: 0.9, reviewBelow: 0.5 } },
      ),
    ).rejects.toBeInstanceOf(InvalidError);
    await expect(
      rulebooks.save({ owner: ME, visitor }, { rulebook: { entityTypes: [] } }),
    ).rejects.toBeInstanceOf(InvalidError);
    expect(calls).toEqual([]);

    const saved = await rulebooks.save(
      { owner: ME, visitor },
      { rulebook: DEFAULT_RULEBOOK, note: "  mine  " },
    );
    expect(saved).toMatchObject({ version: 3, note: "mine" });
    await rulebooks.save(
      { owner: ME, visitor: trusted },
      { rulebook: DEFAULT_RULEBOOK },
    );
    expect(calls).toEqual([
      `save:${LIMITS.rulebooksPerOwnerPerDay}`,
      "save:null",
    ]);
  });

  it("opens no Storage URL once an Owner has used the day's uploads", async () => {
    const { ports, calls } = fakes();
    await expect(
      createSieveServices(ports).uploads.create(
        { owner: ME, visitor },
        { title: "Statement", pages: 3 },
      ),
    ).rejects.toBeInstanceOf(LimitError);
    expect(calls).toEqual([]);
  });
});

describe("Connect a client", () => {
  it("binds a Guest's token to the pass's own expiry, and marks stub only on the suite's", async () => {
    const { ports } = fakes();
    const access = {
      kind: "guest" as const,
      userId: "u",
      passId: "6c1c3a0e-7f7e-4b8e-9d55-0d1d1f0a0b0c",
      label: "Guest",
      expiresAt: "2026-12-01T00:00:00.000Z",
    };
    const guest = await createSieveServices({
      ...ports,
      stub: true,
    }).connect.mint({ access, owner: ME, visitor });
    const claims = JSON.parse(guest.token) as SieveClaims;
    expect(guest.expiresAt).toBe(access.expiresAt);
    expect(claims).toMatchObject({
      kind: "guest",
      owner: ME,
      pass: access.passId,
    });
    expect(claims.stub).toBeUndefined();

    const suite = await createSieveServices({
      ...ports,
      stub: true,
    }).connect.mint({
      access: { kind: "e2e" },
      owner: "e2e" as Owner,
      visitor: trusted,
    });
    expect((JSON.parse(suite.token) as SieveClaims).stub).toBe(true);
  });
});
