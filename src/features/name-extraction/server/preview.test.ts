import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RULEBOOK, type ExtractedName } from "../domain/contract";
import { generateDocument } from "../domain/corpus";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  ownedRun: vi.fn(),
  ownedUpload: vi.fn(),
  latestNames: vi.fn(),
  loadDocument: vi.fn(),
}));

vi.mock("./repository", () => ({
  isOver: (status: string) =>
    status === "completed" || status === "failed" || status === "stopped",
  ownedRun: mocks.ownedRun,
  ownedUpload: mocks.ownedUpload,
  latestNames: mocks.latestNames,
}));
vi.mock("./document", () => ({
  isCorpusId: (id: string) => id.startsWith("ne-"),
  loadDocument: mocks.loadDocument,
}));

import { comparison, MAX_PREVIEW_PAGES, overview, pages } from "./preview";

const OWNER = "host:me";
const RUN = "11111111-1111-4111-8111-111111111111";
const corpus = { kind: "corpus", corpusId: "ne-te-01" } as const;
const upload = {
  kind: "upload",
  uploadId: "22222222-2222-4222-8222-222222222222",
} as const;

const { answerKey } = generateDocument("ne-te-01");
const asFound = (canonical: string, page: number): ExtractedName => ({
  canonical,
  type: "person",
  aliases: [],
  roles: [],
  mentions: [{ page, quote: canonical }],
  confidence: 1,
  foundBy: ["reader"],
});

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN,
    owner: OWNER,
    title: "A run",
    pages: 10,
    source: corpus,
    status: "completed",
    rulebook: DEFAULT_RULEBOOK,
    names: [] as ExtractedName[],
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("overview", () => {
  it("counts the key's names per page on a demo Document", async () => {
    const result = await overview(OWNER, corpus);
    if ("error" in result) throw new Error(result.error);
    expect(result.pages).toBe(10);
    expect(result.density).toHaveLength(10);
    const total = answerKey.reduce((sum, name) => sum + name.pages.length, 0);
    expect(result.density.reduce((a, b) => a + b, 0)).toBe(total);
    expect(result.title).toBe("Retail customer account-opening file");
  });

  it("refuses another Owner's Run and an Upload that is not the Owner's", async () => {
    mocks.ownedRun.mockResolvedValue(null);
    expect(await overview(OWNER, corpus, RUN)).toEqual({
      error: "No such Run.",
    });
    mocks.ownedUpload.mockResolvedValue(null);
    expect(await overview(OWNER, upload)).toEqual({ error: "No such upload." });
    expect(mocks.loadDocument).not.toHaveBeenCalled();
    expect(mocks.ownedRun).toHaveBeenCalledWith(OWNER, RUN);
  });

  it("uses the Run's source, not the one asked for, and the Run's names", async () => {
    mocks.ownedRun.mockResolvedValue(
      run({ names: [asFound(answerKey[0].canonical, 2)] }),
    );
    const result = await overview(OWNER, upload, RUN);
    if ("error" in result) throw new Error(result.error);
    expect(result.density.reduce((a, b) => a + b, 0)).toBe(1);
    expect(result.density[1]).toBe(1);
    expect(mocks.ownedUpload).not.toHaveBeenCalled();
  });

  it("reads a Run still going from its latest names event", async () => {
    mocks.ownedRun.mockResolvedValue(run({ status: "running", names: [] }));
    mocks.latestNames.mockResolvedValue([asFound("Someone Else", 3)]);
    const result = await overview(OWNER, corpus, RUN);
    if ("error" in result) throw new Error(result.error);
    expect(result.density[2]).toBe(1);
  });
});

describe("pages", () => {
  it("validates the range", async () => {
    expect(await pages(OWNER, corpus, { from: 0, to: 3 })).toHaveProperty(
      "error",
    );
    expect(await pages(OWNER, corpus, { from: 4, to: 3 })).toHaveProperty(
      "error",
    );
    expect(await pages(OWNER, corpus, { from: 1.5, to: 3 })).toHaveProperty(
      "error",
    );
    expect(
      await pages(OWNER, corpus, { from: 1, to: MAX_PREVIEW_PAGES + 1 }),
    ).toHaveProperty("error");
    expect(await pages(OWNER, corpus, { from: 11, to: 12 })).toHaveProperty(
      "error",
    );
    expect(await pages(OWNER, null, { from: 1, to: 2 })).toHaveProperty(
      "error",
    );
  });

  it("marks the key as expected before a Run, and clamps to the last page", async () => {
    const result = await pages(OWNER, corpus, { from: 9, to: 12 });
    if ("error" in result) throw new Error(result.error);
    expect(result.total).toBe(10);
    expect(result.pages.map((p) => p.page)).toEqual([9, 10]);
    const all = await pages(OWNER, corpus, { from: 1, to: 10 });
    if ("error" in all) throw new Error(all.error);
    const marks = all.pages.flatMap((p) => p.key ?? []);
    expect(marks.length).toBeGreaterThan(0);
    expect(marks.every((m) => m.status === "expected")).toBe(true);
    expect(all.pages.every((p) => p.run === null)).toBe(true);
  });

  it("marks found and missed on the key, found and extra on the Run's side", async () => {
    const hit = answerKey.find((name) => name.pages.length > 0);
    if (!hit) throw new Error("empty key");
    const page = hit.pages[0];
    const text = generateDocument("ne-te-01").document.pages[page - 1];
    // An extra the Run claims to have found on the same page, printed there.
    const word = text.match(/SPECIMEN/)?.[0] ?? "SPECIMEN";
    mocks.ownedRun.mockResolvedValue(
      run({
        names: [
          { ...asFound(hit.canonical, page), aliases: hit.aliases },
          asFound(word, page),
        ],
      }),
    );
    const result = await pages(OWNER, corpus, { from: page, to: page }, RUN);
    if ("error" in result) throw new Error(result.error);
    const [one] = result.pages;
    const statuses = new Set((one.key ?? []).map((m) => m.status));
    expect(statuses.has("found")).toBe(true);
    expect(
      (one.key ?? [])
        .filter((m) => m.name === hit.canonical)
        .every((m) => m.status === "found"),
    ).toBe(true);
    expect(
      (one.run ?? []).some((m) => m.status === "extra" && m.name === word),
    ).toBe(true);
    expect(
      (one.run ?? []).some(
        (m) => m.status === "found" && m.name === hit.canonical,
      ),
    ).toBe(true);
  });

  it("marks only the Run's side on an Upload, all found", async () => {
    mocks.ownedRun.mockResolvedValue(
      run({ source: upload, names: [asFound("Ana Ferreira", 1)] }),
    );
    mocks.loadDocument.mockResolvedValue({
      id: upload.uploadId,
      title: "Scan",
      pages: ["Paid to Ana\nFerreira.", "Nothing here."],
    });
    const result = await pages(OWNER, corpus, { from: 1, to: 2 }, RUN);
    if ("error" in result) throw new Error(result.error);
    expect(mocks.loadDocument).toHaveBeenCalledWith(upload);
    expect(result.pages[0].key).toBeNull();
    expect(result.pages[0].run).toEqual([
      {
        start: 8,
        end: 20,
        status: "found",
        name: "Ana Ferreira",
        type: "person",
      },
    ]);
    expect(result.pages[1].run).toEqual([]);
  });
});

describe("comparison", () => {
  it("scores a demo Run under the Run's Rulebook", async () => {
    mocks.ownedRun.mockResolvedValue(
      run({
        names: answerKey.map((name) => ({
          ...asFound(name.canonical, name.pages[0]),
          aliases: name.aliases,
        })),
      }),
    );
    const result = await comparison(OWNER, RUN);
    if ("error" in result) throw new Error(result.error);
    expect(result.score?.recall).toBe(1);
    expect(result.rows.every((row) => row.status === "found")).toBe(true);
  });

  it("drops organizations from the key when the Run's Rulebook did", async () => {
    mocks.ownedRun.mockResolvedValue(
      run({ rulebook: { ...DEFAULT_RULEBOOK, entityTypes: ["person"] } }),
    );
    const result = await comparison(OWNER, RUN);
    if ("error" in result) throw new Error(result.error);
    expect(result.rows.every((row) => row.type === "person")).toBe(true);
    expect(result.rows.every((row) => row.status === "missed")).toBe(true);
  });

  it("lists an Upload's names with no score, and refuses others' Runs", async () => {
    mocks.ownedRun.mockResolvedValue(
      run({ source: upload, names: [asFound("Ana Ferreira", 1)] }),
    );
    const result = await comparison(OWNER, RUN);
    if ("error" in result) throw new Error(result.error);
    expect(result.score).toBeNull();
    expect(result.rows).toHaveLength(1);
    mocks.ownedRun.mockResolvedValue(null);
    expect(await comparison(OWNER, RUN)).toEqual({ error: "No such Run." });
  });
});
