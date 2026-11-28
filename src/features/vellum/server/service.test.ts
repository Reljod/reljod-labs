import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./env", () => ({
  env: {
    model: () => "test/model",
    reasoning: () => "low",
    aiGatewayApiKey: () => "",
  },
}));

import { InvalidError, LimitError } from "@/platform/errors";
import type { VellumPorts } from "./ports";
import { createVellumService } from "./service";

const PNG = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64")}`;
const visitor = { hash: "v", trusted: false };
const signal = new AbortController().signal;

function ports(refuse = false) {
  const calls: string[] = [];
  const p: VellumPorts = {
    draftsman: {
      model: "m",
      draw: () => {
        calls.push("model");
        return (async function* () {})();
      },
    },
    rate: {
      take: async (kind) => {
        calls.push(`take:${kind}`);
        if (refuse) throw new LimitError("That's 12 Passes this hour.");
      },
      used: async () => ({ pass: 0 }),
    },
  };
  return { ports: p, calls };
}

const pass = {
  pass: 1,
  width: 1280,
  height: 720,
  screenshot: PNG,
  squared: PNG,
};

describe("a Pass spends nothing it should not", () => {
  it("refuses an image that isn't what it claims before the rate is taken", async () => {
    const { ports: p, calls } = ports();
    const lying = `data:image/jpeg;base64,${PNG.split(",")[1]}`;
    await expect(
      createVellumService(p).pass(visitor, { ...pass, squared: lying }, signal),
    ).rejects.toBeInstanceOf(InvalidError);
    expect(calls).toEqual([]);
  });

  it("takes the rate before the model, and a refusal never reaches it", async () => {
    const ok = ports();
    await createVellumService(ok.ports).pass(visitor, pass, signal);
    expect(ok.calls).toEqual(["take:pass", "model"]);

    const refused = ports(true);
    await expect(
      createVellumService(refused.ports).pass(visitor, pass, signal),
    ).rejects.toBeInstanceOf(LimitError);
    expect(refused.calls).toEqual(["take:pass"]);
  });
});
