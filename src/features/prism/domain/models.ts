/**
 * Brand-new November 2026 Decision Models live on Vercel AI Gateway.
 * Unlike generative LLMs, every model here returns calibrated probability
 * distributions in a single forward pass with zero output tokens.
 */

export interface DecisionModelInfo {
  readonly id: DecisionModelId;
  readonly name: string;
  readonly shortName: string;
  readonly lab: string;
  readonly released: string;
  readonly pricePerMillionInput: number;
  readonly contextWindow: number;
  readonly modalities: readonly ("text" | "image" | "pdf")[];
  readonly accent: string;
  readonly tagline: string;
  readonly defaultJuror: boolean;
}

export const DECISION_MODELS = [
  {
    id: "microsoft/decision-1.1",
    name: "Microsoft Decision-1.1",
    shortName: "Decision-1.1",
    lab: "Microsoft AI",
    released: "Nov 17, 2026",
    pricePerMillionInput: 0.042,
    contextWindow: 32_768,
    modalities: ["text"],
    accent: "#1d4e89",
    tagline: "Ignite 2026 release · calibrated enterprise routing & scoring",
    defaultJuror: true,
  },
  {
    id: "liquid/d1.2-ultra",
    name: "Liquid d1.2 Ultra",
    shortName: "Liquid d1.2",
    lab: "Liquid AI",
    released: "Nov 16, 2026",
    pricePerMillionInput: 0.042,
    contextWindow: 32_768,
    modalities: ["text", "image"],
    accent: "#d9a84e",
    tagline: "High-accuracy non-transformer decision engine · text & vision",
    defaultJuror: true,
  },
  {
    id: "perplexity/pplx-decider-v1.3",
    name: "Perplexity Decider v1.3",
    shortName: "Decider v1.3",
    lab: "Perplexity",
    released: "Nov 13, 2026",
    pricePerMillionInput: 0.05,
    contextWindow: 32_768,
    modalities: ["text", "image"],
    accent: "#2f6b3f",
    tagline: "Open-weights decision model · vision & rubric calibration",
    defaultJuror: true,
  },
  {
    id: "nace-ai/drex-max-finance",
    name: "Drex Max Finance",
    shortName: "Drex Finance",
    lab: "Nace AI",
    released: "Nov 9, 2026",
    pricePerMillionInput: 0.03,
    contextWindow: 32_768,
    modalities: ["text", "image"],
    accent: "#b23a2b",
    tagline: "Finance-specialized open-weights decision model",
    defaultJuror: true,
  },
  {
    id: "google/gemini-decision-1",
    name: "Gemini Decision 1",
    shortName: "Gemini Dec-1",
    lab: "Google DeepMind",
    released: "Nov 2026",
    pricePerMillionInput: 0.1,
    contextWindow: 262_144,
    modalities: ["text", "image", "pdf"],
    accent: "#6fa0dc",
    tagline: "262K context multimodal evaluator · text, images & PDFs",
    defaultJuror: false,
  },
  {
    id: "baseten/joey-1",
    name: "Joey-1 (2B)",
    shortName: "Joey-1 2B",
    lab: "Base Labs",
    released: "Nov 2026",
    pricePerMillionInput: 0.01,
    contextWindow: 16_384,
    modalities: ["text"],
    accent: "#6b4226",
    tagline: "Ultra-fast 2B single-pass classifier at $0.01 / 1M tokens",
    defaultJuror: false,
  },
] as const;

export type DecisionModelId = (typeof DECISION_MODELS)[number]["id"];

export const DEFAULT_MODEL_ID: DecisionModelId = "microsoft/decision-1.1";

export const DEFAULT_JUROR_IDS: readonly DecisionModelId[] =
  DECISION_MODELS.filter((m) => m.defaultJuror).map((m) => m.id);

export const MODEL_BY_ID: Record<DecisionModelId, DecisionModelInfo> =
  Object.fromEntries(
    DECISION_MODELS.map((m) => [m.id, m]),
  ) as unknown as Record<DecisionModelId, DecisionModelInfo>;

export function isDecisionModelId(value: string): value is DecisionModelId {
  return value in MODEL_BY_ID;
}

/**
 * Reference cost & latency for doing the same 5-question structured-JSON
 * triage with a mid-tier generative LLM (e.g. $3/M in, $15/M out, ~360 output
 * tokens of JSON + reasoning, ~1.9s wall-clock). Shown transparently as a
 * comparative benchmark beside the live Decision Model telemetry.
 */
export const LLM_BASELINE = {
  label: "Frontier LLM (JSON output)",
  pricePerMillionInput: 3.0,
  pricePerMillionOutput: 15.0,
  typicalOutputTokens: 360,
  typicalLatencyMs: 1_900,
} as const;
