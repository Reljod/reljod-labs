import { beforeEach, describe, expect, it, vi } from "vitest";

/* Clearing stale pending Sources, with the database and the bucket faked. */

const state = vi.hoisted(() => ({
  removed: [] as string[],
  queries: [] as { text: string; values: unknown[] }[],
  rows: [] as { storage_path: string | null }[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("./audit", () => ({ audit: async () => 1, auditIn: async () => 1 }));
vi.mock("./context", () => ({ assertCan: () => {} }));
vi.mock("./db", () => ({ isUuid: () => true, sql: () => ({}) }));
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

import { clearStalePending, STALE_BATCH } from "./knowledge";

const db = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
  state.queries.push({ text: strings.join("?"), values });
  return state.rows;
}) as never;

beforeEach(() => {
  state.removed = [];
  state.queries = [];
  state.rows = [];
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
