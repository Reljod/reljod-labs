import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { LimitError } from "@/platform/errors";
import { DEFAULT_JUROR_IDS, DEFAULT_MODEL_ID } from "../domain/models";
import { CASCADE_BATCH } from "../domain/slips";
import type { PrismPorts, RateKind } from "./ports";
import { createPrismService } from "./service";

const owner = "guest:6c1c3a0e-7f7e-4b8e-9d55-0d1d1f0a0b0c" as const;
const visitor = { hash: "v", trusted: false };
const caller = { owner, visitor };

function ports(refuse = false) {
  const calls: string[] = [];
  const p: PrismPorts = {
    decider: {
      async decide({ modelId }) {
        calls.push(`model:${modelId}`);
        return {
          modelId,
          resolvedModel: modelId,
          latencyMs: 1,
          inputTokens: 10,
          outputTokens: 0,
          costUsd: 0.000001,
          answers: {},
        };
      },
    },
    rate: {
      async take(kind, who, options) {
        calls.push(
          `take:${kind}:${options?.units ?? 1}:${options?.owner}:${who.hash}`,
        );
        if (refuse) throw new LimitError("That would go over your calls.");
      },
      used: async () => ({ refract: 0, tribunal: 0, cascade: 0 }),
    },
    now: () => 0,
  };
  return { ports: p, calls };
}

async function drain<E>(events: AsyncGenerator<E>) {
  const out: E[] = [];
  for await (const event of events) out.push(event);
  return out;
}

describe("Prism takes its cap before any Decision Model call", () => {
  it("counts one call per Juror and one per Slip, under the caller's Owner, before the first call", async () => {
    const { ports: p, calls } = ports();
    const service = createPrismService(p);

    const jurors = DEFAULT_JUROR_IDS.slice(0, 3);
    const tribunal = await service.tribunal(caller, {
      state: "Wire MRD 4,000 to the pension fund.",
      modelIds: [...jurors],
    });
    expect(calls).toEqual([`take:tribunal:3:${owner}:v`]);
    const events = await drain(tribunal);
    expect(events.filter((e) => e.type === "juror.result")).toHaveLength(3);
    expect(events.at(-1)?.type).toBe("tribunal.done");

    calls.length = 0;
    const items = CASCADE_BATCH.map((s) => ({ id: s.id, text: s.text }));
    const cascade = await service.cascade(caller, {
      modelId: DEFAULT_MODEL_ID,
      items,
    });
    expect(calls).toEqual([`take:cascade:${items.length}:${owner}:v`]);
    const sorted = await drain(cascade);
    expect(sorted.filter((e) => e.type === "item.decided")).toHaveLength(
      items.length,
    );
    expect(calls.filter((c) => c.startsWith("model:"))).toHaveLength(
      items.length,
    );
  });

  it.each<RateKind>([
    "refract",
    "tribunal",
    "cascade",
  ])("a refused %s cap never reaches the model", async (kind) => {
    const { ports: p, calls } = ports(true);
    const service = createPrismService(p);
    const state = "Close my account.";
    const attempt =
      kind === "refract"
        ? service.refract(caller, { modelId: DEFAULT_MODEL_ID, state })
        : kind === "tribunal"
          ? service.tribunal(caller, {
              state,
              modelIds: [...DEFAULT_JUROR_IDS.slice(0, 2)],
            })
          : service.cascade(caller, {
              modelId: DEFAULT_MODEL_ID,
              items: [{ id: "a", text: state }],
            });
    await expect(attempt).rejects.toBeInstanceOf(LimitError);
    expect(calls.some((c) => c.startsWith("model:"))).toBe(false);
  });
});
