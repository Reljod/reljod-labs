import { z } from "zod";

/** Everything in the pipeline that calls a model, each with its own model. */
export const PURPOSES = {
  watch: {
    label: "Watch",
    hint: "Listens to the call and reads the shared screen",
  },
  write: {
    label: "Write",
    hint: "Writes the Process, plans the slides and revises them",
  },
  review: {
    label: "Review",
    hint: "A second model that checks the first one's work",
  },
} as const;
export type Purpose = keyof typeof PURPOSES;
export const PURPOSE_IDS = Object.keys(PURPOSES) as Purpose[];

/** Models a person may pick, with list prices per million tokens (USD) for estimates. */
export const MODELS = {
  "google/gemini-3.8-flash": {
    label: "Gemini 3.8 Flash",
    input: 0.75,
    output: 3.75,
    video: true,
  },
  "google/gemini-3.5-flash-lite": {
    label: "Gemini 3.5 Flash Lite",
    input: 0.3,
    output: 2.5,
    video: true,
  },
  "anthropic/claude-sonnet-5.5": {
    label: "Claude Sonnet 5.5",
    input: 2,
    output: 10,
    video: false,
  },
  "anthropic/claude-haiku-5.5": {
    label: "Claude Haiku 5.5",
    input: 0.1,
    output: 0.5,
    video: false,
  },
} as const;
export type ModelId = keyof typeof MODELS;
export const MODEL_IDS = Object.keys(MODELS) as ModelId[];

export type ModelChoice = Record<Purpose, ModelId>;

/** Only a model that takes video can Watch. */
export function modelsFor(purpose: Purpose): ModelId[] {
  return MODEL_IDS.filter((id) => purpose !== "watch" || MODELS[id].video);
}

export const DEFAULT_MODELS: ModelChoice = {
  watch: "google/gemini-3.8-flash",
  write: "anthropic/claude-haiku-5.5",
  review: "google/gemini-3.8-flash",
};

const modelIdSchema = z.enum(MODEL_IDS as [ModelId, ...ModelId[]]);
export const modelChoiceSchema = z.object({
  watch: modelIdSchema,
  write: modelIdSchema,
  review: modelIdSchema,
});

/** Defaults with a stored choice on top; anything unknown or not allowed for its purpose is dropped. */
export function resolveModels(stored: unknown): ModelChoice {
  const result = { ...DEFAULT_MODELS };
  if (!stored || typeof stored !== "object") return result;
  for (const purpose of PURPOSE_IDS) {
    const value = (stored as Record<string, unknown>)[purpose];
    if (
      typeof value === "string" &&
      modelsFor(purpose).includes(value as ModelId)
    ) {
      result[purpose] = value as ModelId;
    }
  }
  return result;
}

/** USD for a call from its usage, when the gateway does not report what it charged. */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const price = MODELS[model as ModelId];
  if (!price) return 0;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

/** One call to a model, as the Run records and shows it. */
export type ModelCall = {
  id: string;
  purpose: Purpose;
  /** What the call was for: "Plan the slides (round 2)". */
  label: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  ms: number;
  at: string;
  /** Which pass made it: 0 for the Run, n for its nth Redo. Totals count every generation. */
  generation?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * What a call cost, from the gateway's metadata, or null. `cost` is what was
 * charged and `marketCost` the list price. The gateway can charge nothing for
 * a call (credits, a promotion), and a demo that shows the cost of a model
 * should not then say it was free, so a zero falls through to the list price.
 */
export function gatewayCost(providerMetadata: unknown): number | null {
  const meta = isRecord(providerMetadata) ? providerMetadata.gateway : null;
  if (!isRecord(meta)) return null;
  for (const value of [meta.cost, meta.marketCost]) {
    const number = typeof value === "string" ? Number(value) : value;
    if (typeof number === "number" && Number.isFinite(number) && number > 0) {
      return number;
    }
  }
  return null;
}
