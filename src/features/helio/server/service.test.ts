import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { InvalidError, LimitError } from "@/platform/errors";
import type { HelioPorts, Spend } from "./ports";
import { createHelioService } from "./service";

const visitor = { hash: "v", trusted: false };
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48,
]);
const product = {
  name: "Solis Kettle",
  category: "Appliances",
  materialNotes: "Matte terracotta",
  bytes: PNG,
  mediaType: "image/png",
};
const frame = {
  imageDataUrl: "data:image/png;base64,AA==",
  model: "m",
  latencyMs: 1,
  costUsd: 0.01,
};

function ports(options: { refuse?: boolean; shootFails?: Error } = {}) {
  const calls: string[] = [];
  const spends: Spend[] = [];
  const model = (name: string) => {
    calls.push(`model:${name}`);
  };
  const p: HelioPorts = {
    studio: {
      imageModel: (tier) => `mai-${tier}`,
      async direct() {
        model("direct");
        return {
          campaignTitle: "t",
          executiveSummary: "s",
          thinkingSummary: "k",
          markets: [],
          model: "neon",
          latencyMs: 1,
          costUsd: 0.001,
          reasoningTokens: 0,
        };
      },
      async plate() {
        model("plate");
        return frame;
      },
      async shoot() {
        model("shoot");
        if (options.shootFails) throw options.shootFails;
        return frame;
      },
      async edit() {
        model("edit");
        return frame;
      },
      async audit() {
        model("audit");
        throw new Error("unused");
      },
    },
    products: { resolve: async () => product },
    rate: {
      async take(_who, spend) {
        calls.push("take");
        spends.push(spend);
        if (options.refuse) throw new LimitError("Hourly image limit reached.");
      },
    },
    now: () => 0,
  };
  return { ports: p, calls, spends };
}

async function drain<E>(events: AsyncGenerator<E>) {
  const out: E[] = [];
  for await (const event of events) out.push(event);
  return out;
}

const shoot = {
  product: { kind: "specimen" as const, slug: "solis-kettle" },
  marketIds: ["tokyo", "milan", "manila"],
  tier: "flash" as const,
};

describe("Helio spends nothing it should not", () => {
  it("takes both buckets of a Shoot in one take, before any model call", async () => {
    const { ports: p, calls, spends } = ports();
    const events = await drain(
      await createHelioService(p).shoot(visitor, shoot),
    );
    expect(spends).toEqual([{ director: 1, image: 3 }]);
    expect(calls[0]).toBe("take");
    expect(calls.filter((c) => c === "model:shoot")).toHaveLength(3);
    expect(events.at(-1)?.type).toBe("done");
  });

  it("a refused cap never reaches a model", async () => {
    const { ports: p, calls } = ports({ refuse: true });
    await expect(
      createHelioService(p).shoot(visitor, shoot),
    ).rejects.toBeInstanceOf(LimitError);
    expect(calls).toEqual(["take"]);
  });

  it("refuses an image that is not what it claims before the cap is taken", async () => {
    const { ports: p, calls } = ports();
    const svg = Buffer.from("<svg><script>alert(1)</script></svg>").toString(
      "base64",
    );
    await expect(
      createHelioService(p).extract(visitor, {
        mode: "isolate",
        imageDataUrl: `data:image/png;base64,${svg}`,
      }),
    ).rejects.toBeInstanceOf(InvalidError);
    expect(calls).toEqual([]);
  });

  it("never streams an internal error's message to the browser", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { ports: p } = ports({
      shootFails: new Error(
        "connect ECONNREFUSED postgres://user:secret@db.internal:6543",
      ),
    });
    const events = await drain(
      await createHelioService(p).shoot(visitor, shoot),
    );
    const errors = events.filter((e) => e.type === "frame-error");
    expect(errors).toHaveLength(3);
    for (const e of errors)
      if (e.type === "frame-error")
        expect(e.error).toBe("Market shoot failed.");
    expect(JSON.stringify(events)).not.toContain("secret");
    log.mockRestore();
  });
});
