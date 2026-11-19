/**
 * The models Switchboard uses, all through Vercel AI Gateway, with list
 * prices (USD per token, from the gateway catalog on 2026-11-18) so a Call's
 * cost can be shown as it runs. Why this choice: docs/adr/0029.
 */

export type RealtimeUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  inputTextTokens?: number;
  inputAudioTokens?: number;
  outputTextTokens?: number;
  outputAudioTokens?: number;
  cachedInputTextTokens?: number;
  cachedInputAudioTokens?: number;
};

type RealtimePricing = {
  textIn: number;
  textOut: number;
  audioIn: number;
  audioOut: number;
  cachedIn: number;
};

export type RealtimeModel = {
  id: string;
  label: string;
  /** One line for the picker. */
  note: string;
  voice: string | undefined;
  pricing: RealtimePricing;
};

const perMillion = (usd: number) => usd / 1_000_000;

export const REALTIME_MODELS: RealtimeModel[] = [
  {
    id: "openai/gpt-realtime-2.1",
    label: "GPT-Realtime 2.1",
    note: "Talks while it works, best at tools. The default.",
    voice: "marin",
    pricing: {
      textIn: perMillion(4),
      textOut: perMillion(24),
      audioIn: perMillion(32),
      audioOut: perMillion(64),
      cachedIn: perMillion(0.4),
    },
  },
  {
    id: "google/gemini-3.8-live",
    label: "Gemini 3.8 Live",
    note: "A quarter of the price; quick, plainer turn-taking.",
    voice: undefined,
    pricing: {
      textIn: perMillion(0.75),
      textOut: perMillion(4.5),
      audioIn: perMillion(3),
      audioOut: perMillion(12),
      cachedIn: perMillion(0.75),
    },
  },
  {
    id: "openai/gpt-realtime-mini",
    label: "GPT-Realtime mini",
    note: "Cheapest OpenAI voice; wordier, weaker with Rules.",
    voice: "marin",
    pricing: {
      textIn: perMillion(0.6),
      textOut: perMillion(2.4),
      audioIn: perMillion(10),
      audioOut: perMillion(20),
      cachedIn: perMillion(0.06),
    },
  },
];

export const DEFAULT_REALTIME_MODEL = REALTIME_MODELS[0].id;

export function realtimeModel(id: string): RealtimeModel | undefined {
  return REALTIME_MODELS.find((model) => model.id === id);
}

/** What one response's usage is worth at list price. */
export function realtimeCost(modelId: string, usage: RealtimeUsage): number {
  const pricing = realtimeModel(modelId)?.pricing;
  if (!pricing) return 0;
  const n = (value: number | undefined) =>
    typeof value === "number" && Number.isFinite(value) && value > 0
      ? value
      : 0;
  const inAudio = n(usage.inputAudioTokens);
  const outAudio = n(usage.outputAudioTokens);
  // A provider that reports only totals: everything not audio is text.
  const inText =
    usage.inputTextTokens ?? Math.max(0, n(usage.inputTokens) - inAudio);
  const outText =
    usage.outputTextTokens ?? Math.max(0, n(usage.outputTokens) - outAudio);
  const cachedAudio = Math.min(inAudio, n(usage.cachedInputAudioTokens));
  const cachedText = Math.min(
    n(inText),
    usage.cachedInputTextTokens ??
      Math.max(0, n(usage.cachedInputTokens) - cachedAudio),
  );
  return (
    (n(inText) - cachedText) * pricing.textIn +
    (inAudio - cachedAudio) * pricing.audioIn +
    (cachedText + cachedAudio) * pricing.cachedIn +
    n(outText) * pricing.textOut +
    outAudio * pricing.audioOut
  );
}

/** Adds one response's usage to a Call's running total. */
export function addUsage(
  total: RealtimeUsage,
  more: RealtimeUsage,
): RealtimeUsage {
  const out: RealtimeUsage = { ...total };
  for (const key of Object.keys(more) as (keyof RealtimeUsage)[]) {
    const value = more[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0)
      out[key] = (out[key] ?? 0) + value;
  }
  return out;
}

/** The text Line and the Wrap-up run on language models. */
export const TEXT_MODELS = {
  /** The Agent on the text Line: quick, good with tools. */
  line: "anthropic/claude-haiku-5.5",
  /** The Wrap-up's summary. */
  wrapup: "anthropic/claude-haiku-5.5",
} as const;

/** The "model" of a Call the end-to-end test runs with canned Turns (`domain/stub.ts`). */
export const STUB_MODEL = "stub/canned";

export const usd = (amount: number) =>
  amount < 0.01 && amount > 0
    ? `$${amount.toFixed(4)}`
    : `$${amount.toFixed(amount < 1 ? 3 : 2)}`;
