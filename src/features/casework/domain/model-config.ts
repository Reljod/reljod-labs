import { z } from "zod";

/** Everything that calls a model, each with its own settings. */
export const PURPOSES = {
  chat: {
    label: "Chat",
    hint: "The Specialist: reads requests and calls tools",
  },
  sort: { label: "Sort job", hint: "Decides what each document is" },
  read: { label: "Read job", hint: "Extracts fields from every page" },
  adjudicate: { label: "Adjudicate job", hint: "Weighs screening hits" },
  decide: { label: "Decision job", hint: "Writes the decision file" },
} as const;

export type Purpose = keyof typeof PURPOSES;
export const PURPOSE_IDS = Object.keys(PURPOSES) as Purpose[];

export const REASONING = ["none", "minimal", "low", "medium", "high"] as const;
export type Reasoning = (typeof REASONING)[number];

/** Models a visitor may pick, with prices per million tokens (USD) for estimates. */
export const MODELS = {
  "openai/gpt-6.1-terra": {
    label: "GPT-6.1 Terra",
    input: 1,
    output: 5,
    reasoning: true,
  },
  "openai/gpt-6.1-terra-fast": {
    label: "GPT-6.1 Terra Fast",
    input: 2,
    output: 10,
    reasoning: true,
  },
  "openai/gpt-6.1-sol": {
    label: "GPT-6.1 Sol",
    input: 2,
    output: 10,
    reasoning: true,
  },
  "openai/gpt-6-luna": {
    label: "GPT-6 Luna",
    input: 0.1,
    output: 0.5,
    reasoning: true,
  },
  "anthropic/claude-sonnet-5.5": {
    label: "Claude Sonnet 5.5",
    input: 2,
    output: 10,
    reasoning: false,
  },
  "anthropic/claude-haiku-5.5": {
    label: "Claude Haiku 5.5",
    input: 0.1,
    output: 0.5,
    reasoning: false,
  },
  "google/gemini-3.8-flash": {
    label: "Gemini 3.8 Flash",
    input: 0.75,
    output: 3.75,
    reasoning: false,
  },
  "zai/glm-5.3-flash": {
    label: "GLM 5.3 Flash",
    input: 0.15,
    output: 0.5,
    reasoning: false,
  },
} as const;

export type ModelId = keyof typeof MODELS;
export const MODEL_IDS = Object.keys(MODELS) as ModelId[];

export const modelSettingsSchema = z.object({
  model: z.enum(MODEL_IDS as [ModelId, ...ModelId[]]),
  reasoning: z.enum(REASONING).nullable(),
  /** Ignored by reasoning models, which do not take a temperature. */
  temperature: z.number().min(0).max(2).nullable(),
  maxOutputTokens: z.number().int().min(256).max(32_000).nullable(),
});

export type ModelSettings = z.infer<typeof modelSettingsSchema>;
export type ModelSettingsByPurpose = Record<Purpose, ModelSettings>;

/** GPT-6.1 Terra everywhere: the pipelines and the chat. */
export const DEFAULT_SETTINGS: ModelSettingsByPurpose = {
  chat: {
    model: "openai/gpt-6.1-terra",
    reasoning: "low",
    temperature: null,
    maxOutputTokens: 2_000,
  },
  sort: {
    model: "openai/gpt-6.1-terra",
    reasoning: "minimal",
    temperature: null,
    maxOutputTokens: 1_000,
  },
  read: {
    model: "openai/gpt-6.1-terra",
    reasoning: "low",
    temperature: null,
    maxOutputTokens: 8_000,
  },
  adjudicate: {
    model: "openai/gpt-6.1-terra",
    reasoning: "medium",
    temperature: null,
    maxOutputTokens: 4_000,
  },
  decide: {
    model: "openai/gpt-6.1-terra",
    reasoning: "low",
    temperature: null,
    maxOutputTokens: 1_500,
  },
};

/** Layers settings: code defaults, then org rows, then this session's overrides. */
export function resolveSettings(
  ...layers: Partial<Record<Purpose, Partial<ModelSettings>>>[]
): ModelSettingsByPurpose {
  const result = structuredClone(DEFAULT_SETTINGS);
  for (const layer of layers) {
    for (const purpose of PURPOSE_IDS) {
      const patch = layer[purpose];
      if (!patch) continue;
      const merged = { ...result[purpose], ...patch };
      const parsed = modelSettingsSchema.safeParse(merged);
      if (parsed.success) result[purpose] = parsed.data;
    }
  }
  return result;
}

/** USD for a call, from usage, when the gateway does not report a cost. */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
) {
  const price = MODELS[model as ModelId];
  if (!price) return 0;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}
