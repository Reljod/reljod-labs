import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { InvalidError, LimitError } from "@/platform/errors";
import type { FloorwalkPorts } from "./ports";
import { createFloorwalkService } from "./service";

const owner = "guest:6c1c3a0e-7f7e-4b8e-9d55-0d1d1f0a0b0c" as const;
const visitor = { hash: "v", trusted: false };

function ports(overrides: Partial<FloorwalkPorts> = {}) {
  const calls: string[] = [];
  const base: FloorwalkPorts = {
    store: {
      uploadUrl: async (path) => `https://storage/${path}`,
      download: async () => {
        calls.push("download");
        return null;
      },
      sweep: async () => {},
    },
    walker: {
      model: "m",
      walk: () => {
        calls.push("model");
        return (async function* () {})();
      },
      ask: async () => {
        calls.push("model");
        throw new Error("unused");
      },
    },
    rate: {
      take: async (kind) => {
        calls.push(`take:${kind}`);
      },
      used: async () => ({ walk: 0, ask: 0, upload: 0 }),
    },
    later: () => {},
    newId: () => "00000000-0000-4000-8000-000000000000",
  };
  return { ports: { ...base, ...overrides }, calls };
}

const someoneElses = {
  kind: "upload" as const,
  path: "uploads/2026112710/host-other/00000000-0000-4000-8000-000000000000.mp4",
};

describe("Floorwalk spends nothing it should not", () => {
  it("refuses another Owner's upload before taking the rate or reading footage", async () => {
    const { ports: p, calls } = ports();
    const service = createFloorwalkService(p);
    await expect(
      service.walk({ owner, visitor }, someoneElses, {
        origin: "http://localhost",
      }),
    ).rejects.toBeInstanceOf(InvalidError);
    expect(calls).toEqual([]);
  });

  it("takes the rate before it reads footage, and a refusal never reaches the model", async () => {
    const { ports: p, calls } = ports({
      rate: {
        take: async () => {
          throw new LimitError("That's 6 Walks this hour.");
        },
        used: async () => ({ walk: 0, ask: 0, upload: 0 }),
      },
    });
    const service = createFloorwalkService(p);
    await expect(
      service.ask(
        { owner, visitor },
        { kind: "sample", slug: "cold-store" },
        "Is the exit clear?",
        { origin: "http://localhost" },
      ),
    ).rejects.toBeInstanceOf(LimitError);
    expect(calls).toEqual([]);
  });

  it("files a new upload under the caller's own folder only", async () => {
    const { ports: p } = ports();
    const ticket = await createFloorwalkService(p).prepareUpload(
      { owner, visitor },
      { type: "video/mp4", size: 1000 },
    );
    expect(ticket.path).toMatch(
      /^uploads\/\d{10}\/guest-6c1c3a0e-7f7e-4b8e-9d55-0d1d1f0a0b0c\/[0-9a-f-]{36}\.mp4$/,
    );
  });
});
