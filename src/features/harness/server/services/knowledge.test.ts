import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  ForbiddenError,
  InvalidError,
  LimitError,
  NotFoundError,
} from "@/platform/errors";
import { LIMITS } from "../../domain/limits";
import type { Staff } from "../../domain/staff";
import type { KnowledgeRepository } from "../ports";
import { createKnowledgeService } from "./knowledge";

const owner = "host:1" as const;
const visitor = { hash: "v", trusted: false };
const staff = (role: Staff["role"]): Staff => ({
  id: `${role}-id`,
  key: role,
  name: role,
  title: "",
  role,
  initials: "",
});
const user = staff("user");
const admin = staff("admin");
const seedId = "44444444-4444-4444-8444-444444444444";

function setup(
  overrides: {
    knowledge?: Partial<KnowledgeRepository>;
    take?: () => Promise<void>;
  } = {},
) {
  const calls: string[] = [];
  const knowledge = {
    count: async () => 0,
    sweep: async () => [],
    insert: async () => {
      calls.push("insert");
    },
    source: async () => null,
    search: async () => {
      calls.push("search");
      return [];
    },
    hasUnembedded: async () => false,
    remove: async ({ check }) => check({ isSeed: true }),
    ...overrides.knowledge,
  } as KnowledgeRepository;
  const service = createKnowledgeService({
    knowledge,
    texts: {
      of: async () => "",
      read: async () => null,
    },
    files: {
      uploadUrl: async () => {
        calls.push("uploadUrl");
        return "https://storage/upload";
      },
      signedUrl: async () => "",
      remove: async () => {},
    },
    embedder: {
      embedAll: async (texts) => ({
        vectors: texts.map(() => null),
        usage: null,
      }),
      embedQuery: async () => {
        calls.push("embed");
        return [0.1];
      },
    },
    conflicts: {
      check: async () => ({
        found: [],
        quietUsage: [],
        asked: 0,
        skipped: 0,
        failed: 0,
      }),
    },
    sessions: {
      writable: async () => {
        throw new Error("unused");
      },
    },
    rate: {
      take: async (kind) => {
        calls.push(`take:${kind}`);
        await overrides.take?.();
      },
      used: async () => ({}) as never,
    },
    audit: { record: async () => 1, strict: async () => {} },
    later: () => {},
    newId: () => "55555555-5555-4555-8555-555555555555",
    now: () => 0,
  });
  return { service, calls };
}

describe("search spends one embedding per new query, within the cap", () => {
  it("searches by words alone once the visitor's searches are used up, and pays for no embedding", async () => {
    const { service, calls } = setup({
      take: async () => {
        throw new LimitError("That's 60 searches this hour.");
      },
    });
    await service.search({ owner, staff: user, visitor }, "transfer out", 8);
    expect(calls).toEqual(["take:search", "search"]);
  });

  it("does not pay twice for the same query", async () => {
    const { service, calls } = setup();
    const actor = { owner, staff: user, visitor };
    await service.search(actor, "transfer out", 8);
    await service.search(actor, "transfer out", 8);
    expect(calls.filter((call) => call === "embed")).toHaveLength(1);
  });
});

describe("adding a Source", () => {
  const file = { name: "circular.pdf", type: "application/pdf", bytes: 1000 };

  it("refuses a full Workspace before it takes a Source this hour or saves a row", async () => {
    const { service, calls } = setup({
      knowledge: { count: async () => LIMITS.sourcesPerWorkspace },
    });
    await expect(
      service.upload({ owner, staff: user, visitor }, file),
    ).rejects.toBeInstanceOf(LimitError);
    expect(calls).toEqual([]);
  });

  it("refuses a file kind it cannot read before anything else", async () => {
    const { service, calls } = setup();
    await expect(
      service.upload(
        { owner, staff: user, visitor },
        { ...file, name: "run.exe", type: "application/x-msdownload" },
      ),
    ).rejects.toBeInstanceOf(InvalidError);
    expect(calls).toEqual([]);
  });
});

describe("removing a Source", () => {
  it("is for an admin only", async () => {
    const { service } = setup();
    await expect(
      service.remove({ owner, staff: user }, seedId),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses a seed Source, and answers another Workspace's as not found", async () => {
    const { service } = setup();
    await expect(
      service.remove({ owner, staff: admin }, seedId),
    ).rejects.toBeInstanceOf(InvalidError);
    const other = setup({
      knowledge: { remove: async ({ check }) => check(null) },
    });
    await expect(
      other.service.remove({ owner, staff: admin }, seedId),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
