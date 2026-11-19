import "server-only";
import { createGateway, type LanguageModelUsage, type streamText } from "ai";
import { env } from "./env";

type ProviderOptions = NonNullable<
  Parameters<typeof streamText>[0]["providerOptions"]
>;

let client: ReturnType<typeof createGateway> | undefined;

/** The Vercel AI Gateway, with the bank's key. */
export function gateway() {
  client ??= createGateway({ apiKey: env.aiGatewayApiKey() });
  return client;
}

/** Makes a model's thinking visible, so the chat can stream it. Visibility only. */
export function visibleThinking(model: string): ProviderOptions | undefined {
  if (model.startsWith("anthropic/")) {
    return {
      anthropic: { thinking: { type: "adaptive", display: "summarized" } },
    };
  }
  if (model.startsWith("openai/"))
    return { openai: { reasoningSummary: "auto" } };
  if (model.startsWith("google/"))
    return { google: { thinkingConfig: { includeThoughts: true } } };
  return undefined;
}

/** List prices per million tokens (USD), used only when the gateway reports no cost. */
const LIST_PRICE: Record<string, { input: number; output: number }> = {
  "anthropic/claude-sonnet-5.5": { input: 2, output: 10 },
  "anthropic/claude-haiku-5.5": { input: 0.1, output: 0.5 },
  "openai/gpt-6.1-terra": { input: 1, output: 5 },
  "openai/gpt-6-luna": { input: 0.1, output: 0.5 },
};

export type Usage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
};

function gatewayCost(providerMetadata: unknown): number | null {
  const meta = (
    providerMetadata as
      | { gateway?: { cost?: unknown; marketCost?: unknown } }
      | undefined
  )?.gateway;
  if (!meta) return null;
  let best: number | null = null;
  for (const value of [meta.cost, meta.marketCost]) {
    const number = typeof value === "string" ? Number(value) : value;
    if (typeof number === "number" && Number.isFinite(number) && number >= 0) {
      best = Math.max(best ?? 0, number);
    }
  }
  return best;
}

/** What one model call cost: the gateway's figure, else the list price, else null. */
export function usageOf(input: {
  model: string;
  usage: Partial<LanguageModelUsage> | undefined;
  providerMetadata?: unknown;
}): Usage {
  const inputTokens = input.usage?.inputTokens ?? 0;
  const outputTokens = input.usage?.outputTokens ?? 0;
  const reported = gatewayCost(input.providerMetadata);
  const price = LIST_PRICE[input.model];
  const estimated = price
    ? (inputTokens * price.input + outputTokens * price.output) / 1_000_000
    : null;
  return {
    model: input.model,
    inputTokens,
    outputTokens,
    costUsd:
      reported !== null && (reported > 0 || inputTokens + outputTokens === 0)
        ? reported
        : estimated,
  };
}

export function addUsage(calls: Usage[]): Usage | null {
  const [first] = calls;
  if (!first) return null;
  return calls.slice(1).reduce<Usage>(
    (sum, call) => ({
      model: sum.model,
      inputTokens: sum.inputTokens + call.inputTokens,
      outputTokens: sum.outputTokens + call.outputTokens,
      costUsd:
        sum.costUsd === null && call.costUsd === null
          ? null
          : (sum.costUsd ?? 0) + (call.costUsd ?? 0),
    }),
    first,
  );
}
