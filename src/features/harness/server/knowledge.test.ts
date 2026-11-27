import { beforeEach, describe, expect, it, vi } from "vitest";

/* Clearing stale pending Sources, with the database and the bucket faked. */

const state = vi.hoisted(() => ({
  removed: [] as string[],
  queries: [] as { text: string; values: unknown[] }[],
  rows: [] as { storage_path: string | null }[],
  /** What each query answers, in order, for the transaction fake. */
  answers: [] as unknown[][],
  audited: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("./audit", () => ({
  audit: async () => 1,
  auditIn: async (_tx: unknown, event: { action: string }) => {
    state.audited.push(event.action);
    return 1;
  },
}));
vi.mock("./context", () => ({ assertCan: () => {} }));
vi.mock("./db", () => ({ isUuid: () => true, sql: () => fakeSql }));
vi.mock("./knowledge/conflict-check", () => ({ checkForConflicts: vi.fn() }));
vi.mock("./knowledge/embeddings", () => ({}));
vi.mock("./knowledge/extract", () => ({
  extractText: vi.fn(),
  UnreadableError: class extends Error {},
}));
vi.mock("./knowledge/storage", () => ({
  download: vi.fn(),
  uploadUrl: vi.fn(),
  removeFile: async (path: string) => {
    state.removed.push(path);
  },
}));
vi.mock("./knowledge/views", () => ({ STALE_READING_MINUTES: 10 }));
vi.mock("./llm", () => ({ embed: vi.fn(), toVector: vi.fn() }));
vi.mock("./rate", () => ({ takeRate: async () => {} }));
vi.mock("./seed/knowledge", () => ({ backfillKnowledge: vi.fn() }));
vi.mock("./sessions", () => ({ writableSession: vi.fn() }));
vi.mock("./stub", () => ({ modelStubbed: async () => true }));

import {
  clearStalePending,
  purgeRemovedSources,
  REMOVED_SOURCE_DAYS,
  removeSource,
  STALE_BATCH,
} from "./knowledge";

const db = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
  state.queries.push({ text: strings.join("?"), values });
  return state.rows;
}) as never;

/* A transaction fake: each query takes the next answer (default: no rows). */
const tx = async (strings: TemplateStringsArray, ...values: unknown[]) => {
  state.queries.push({ text: strings.join("?"), values });
  return state.answers.shift() ?? [];
};
const fakeSql = Object.assign(tx, {
  begin: async (work: (t: typeof tx) => Promise<unknown>) => work(tx),
});

beforeEach(() => {
  state.removed = [];
  state.queries = [];
  state.rows = [];
  state.answers = [];
  state.audited = [];
});

describe("clearing stale pending Sources", () => {
  it("limits the delete itself to one batch, so rows and files go together", async () => {
    // The database returns only what it deleted: one batch at most.
    state.rows = Array.from({ length: STALE_BATCH }, (_, index) => ({
      storage_path: `owner/file-${index}`,
    }));
    const cleared = await clearStalePending(db, "host:1" as never);
    const [query] = state.queries;
    expect(query?.text).toMatch(/where owner = \? and id in \(/);
    expect(query?.text).toMatch(/limit \?/);
    expect(query?.values).toContain(STALE_BATCH);
    expect(cleared).toBe(STALE_BATCH);
    // Every row deleted has its file removed: none is orphaned.
    expect(state.removed).toHaveLength(STALE_BATCH);
  });

  it("skips rows that never had a file", async () => {
    state.rows = [{ storage_path: null }, { storage_path: "owner/a" }];
    await clearStalePending(db, "host:1" as never);
    expect(state.removed).toEqual(["owner/a"]);
  });
});

const actor = {
  owner: "host:1",
  staff: { id: "staff-1", name: "A", role: "admin" },
} as unknown as Omit<Parameters<typeof removeSource>[0], "sourceId">;
const SOURCE = "22222222-2222-4222-8222-222222222222";

describe("removing a Source", () => {
  it("marks it deleted and keeps its row and file for the purge", async () => {
    state.answers = [
      [
        {
          id: SOURCE,
          title: "Circular",
          is_seed: false,
          kind: "pdf",
          session_id: null,
        },
      ],
      [],
      [{ id: 7 }],
    ];
    await removeSource({ ...actor, sourceId: SOURCE });
    const texts = state.queries.map((query) => query.text);
    expect(texts[0]).toMatch(/deleted_at is null/);
    expect(texts[1]).toMatch(
      /update harness\.sources set deleted_at = now\(\)/,
    );
    expect(texts[2]).toMatch(/superseded_by = null/);
    // No hard delete of this Source: only the purge of old removals runs.
    expect(
      texts.filter((text) => /delete from harness\.sources/.test(text)),
    ).toHaveLength(1);
    expect(texts.at(-1)).toMatch(/deleted_at is not null/);
    expect(state.removed).toEqual([]);
    expect(state.audited).toEqual(["source.removed"]);
  });

  it("refuses a seed Source and a Source already removed", async () => {
    state.answers = [
      [{ id: SOURCE, title: "Guide", is_seed: true, kind: "text" }],
    ];
    await expect(removeSource({ ...actor, sourceId: SOURCE })).rejects.toThrow(
      /seed/,
    );
    state.answers = [[]];
    await expect(removeSource({ ...actor, sourceId: SOURCE })).rejects.toThrow(
      /not in this Workspace/,
    );
  });
});

describe("purging removed Sources", () => {
  it("deletes only the Owner's old removals, one batch, files with rows", async () => {
    state.rows = [{ storage_path: "owner/a" }, { storage_path: null }];
    const purged = await purgeRemovedSources(db, "host:1" as never);
    const [query] = state.queries;
    expect(query?.text).toMatch(/where owner = \? and id in \(/);
    expect(query?.text).toMatch(/deleted_at is not null/);
    expect(query?.values).toContain(REMOVED_SOURCE_DAYS);
    expect(query?.values).toContain(STALE_BATCH);
    expect(purged).toBe(2);
    expect(state.removed).toEqual(["owner/a"]);
  });
});
