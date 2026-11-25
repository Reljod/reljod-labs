import type { MeridianAnswers } from "./api";
import { type DecisionModelId, LLM_BASELINE, MODEL_BY_ID } from "./models";

export type ChuteId = "clear" | "review" | "escalate";

export interface Thresholds {
  /** Maximum composite risk (0..1) allowed for straight-through Auto-Clear. */
  readonly autoClearMaxRisk: number;
  /** Minimum composite risk (0..1) that triggers Block & Escalate. */
  readonly escalateMinRisk: number;
  /** Normalized Shannon entropy (0..1) above which uncertain items route to Human Review. */
  readonly maxUncertainty: number;
  /** P(adversarial) at or above which an item trips directly into Escalate. */
  readonly adversarialTripwire: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  autoClearMaxRisk: 0.28,
  escalateMinRisk: 0.66,
  maxUncertainty: 0.55,
  adversarialTripwire: 0.58,
};

export interface ChuteDecision {
  readonly chute: ChuteId;
  readonly reason: string;
  readonly triggeredGate:
    | "adversarial_tripwire"
    | "risk_ceiling"
    | "uncertainty_band"
    | "human_signoff"
    | "clear_band";
  readonly risk: number;
  readonly entropy: number;
  readonly certainty: number;
  readonly topChoiceMargin: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Normalized Shannon entropy in [0, 1] for a discrete probability map.
 * 0 = one option has 100% mass (completely decisive).
 * 1 = uniform across all options (maximum uncertainty).
 */
export function shannonEntropy(
  probabilities: Readonly<Record<string, number>> | undefined,
): number {
  if (!probabilities) return 0;
  const vals = Object.values(probabilities).filter(
    (v) => Number.isFinite(v) && v > 0,
  );
  const k = Object.keys(probabilities).length;
  if (k <= 1 || vals.length === 0) return 0;
  const total = vals.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  let h = 0;
  for (const v of vals) {
    const p = v / total;
    if (p > 0) h -= p * Math.log2(p);
  }
  return clamp01(h / Math.log2(k));
}

/** Difference between top-1 and top-2 probability mass in a distribution. */
export function topMargin(
  probabilities: Readonly<Record<string, number>> | undefined,
): number {
  if (!probabilities) return 1;
  const sorted = Object.values(probabilities)
    .filter((v) => Number.isFinite(v) && v >= 0)
    .sort((a, b) => b - a);
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return clamp01(sorted[0]);
  return clamp01(sorted[0] - sorted[1]);
}

/**
 * Weighted composite risk index in [0, 1] from the 5 calibrated Meridian answers.
 * Pure deterministic code: the model supplies calibrated probabilities; code decides.
 */
export function compositeRisk(answers: MeridianAnswers): number {
  const sev = clamp01(answers.severity.score / 4);
  const adv = clamp01(answers.adversarial.probability);
  const sign = clamp01(answers.humanSignoff.probability);
  const urg = clamp01(answers.urgent.probability);
  const weighted = sev * 0.44 + adv * 0.34 + sign * 0.14 + urg * 0.08;
  return clamp01(Math.max(weighted, adv * 0.92, sev * 0.88));
}

/**
 * Routes a single Refraction into one of three physical chutes based on live
 * Gate thresholds. Zero model calls — runs at 60fps as sliders move.
 */
export function routeChute(
  answers: MeridianAnswers,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): ChuteDecision {
  const risk = compositeRisk(answers);
  const entropy = shannonEntropy(answers.routing.probabilities);
  const margin = topMargin(answers.routing.probabilities);
  const certainty = clamp01(1 - entropy);
  const adv = clamp01(answers.adversarial.probability);
  const sign = clamp01(answers.humanSignoff.probability);

  if (adv >= thresholds.adversarialTripwire) {
    return {
      chute: "escalate",
      triggeredGate: "adversarial_tripwire",
      reason: `Adversarial probability ${Math.round(adv * 100)}% tripped the ${Math.round(thresholds.adversarialTripwire * 100)}% security gate.`,
      risk,
      entropy,
      certainty,
      topChoiceMargin: margin,
    };
  }

  if (risk >= thresholds.escalateMinRisk) {
    return {
      chute: "escalate",
      triggeredGate: "risk_ceiling",
      reason: `Composite risk ${Math.round(risk * 100)}% crossed the ${Math.round(thresholds.escalateMinRisk * 100)}% escalation floor.`,
      risk,
      entropy,
      certainty,
      topChoiceMargin: margin,
    };
  }

  if (entropy >= thresholds.maxUncertainty) {
    return {
      chute: "review",
      triggeredGate: "uncertainty_band",
      reason: `Routing entropy ${entropy.toFixed(2)} exceeded the ${thresholds.maxUncertainty.toFixed(2)} ambiguity cap — officer decides.`,
      risk,
      entropy,
      certainty,
      topChoiceMargin: margin,
    };
  }

  if (risk <= thresholds.autoClearMaxRisk && sign < 0.55) {
    return {
      chute: "clear",
      triggeredGate: "clear_band",
      reason: `Risk ${Math.round(risk * 100)}% is below the ${Math.round(thresholds.autoClearMaxRisk * 100)}% auto-clear ceiling with decisive routing.`,
      risk,
      entropy,
      certainty,
      topChoiceMargin: margin,
    };
  }

  return {
    chute: "review",
    triggeredGate: sign >= 0.55 ? "human_signoff" : "uncertainty_band",
    reason:
      sign >= 0.55
        ? `Human sign-off probability ${Math.round(sign * 100)}% holds this slip for an officer.`
        : `Composite risk ${Math.round(risk * 100)}% sits inside the human review band.`,
    risk,
    entropy,
    certainty,
    topChoiceMargin: margin,
  };
}

export interface JurorVector {
  readonly modelId: DecisionModelId;
  readonly latencyMs: number;
  readonly costUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly answers: MeridianAnswers;
  readonly decision: ChuteDecision;
  /** 5 normalized [0..1] axes for the polar constellation radar. */
  readonly axes: {
    readonly severity: number;
    readonly urgency: number;
    readonly adversarial: number;
    readonly humanSignoff: number;
    readonly certainty: number;
  };
}

export interface TribunalSummary {
  readonly verdict: "unanimous" | "majority" | "split";
  readonly winningChute: ChuteId;
  readonly agreementRatio: number;
  readonly maxSpread: number;
  readonly mostContestedAxis: keyof JurorVector["axes"];
  readonly spreadByAxis: Record<keyof JurorVector["axes"], number>;
  readonly meanAxes: JurorVector["axes"];
}

export function jurorAxes(answers: MeridianAnswers): JurorVector["axes"] {
  const entropy = shannonEntropy(answers.routing.probabilities);
  return {
    severity: clamp01(answers.severity.score / 4),
    urgency: clamp01(answers.urgent.probability),
    adversarial: clamp01(answers.adversarial.probability),
    humanSignoff: clamp01(answers.humanSignoff.probability),
    certainty: clamp01(1 - entropy),
  };
}

function stdDev(values: readonly number[]): number {
  if (values.length <= 1) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Measures cross-model agreement across the Tribunal jurors.
 * High dispersion across models visually exposes ambiguous/adversarial cases.
 */
export function tribunalConsensus(
  jurors: readonly JurorVector[],
): TribunalSummary | null {
  if (jurors.length === 0) return null;
  const counts: Record<ChuteId, number> = { clear: 0, review: 0, escalate: 0 };
  for (const j of jurors) counts[j.decision.chute] += 1;

  const ranked = (Object.entries(counts) as [ChuteId, number][]).sort(
    (a, b) => b[1] - a[1],
  );
  const [winningChute, topCount] = ranked[0];
  const agreementRatio = topCount / jurors.length;

  const axisKeys: (keyof JurorVector["axes"])[] = [
    "severity",
    "urgency",
    "adversarial",
    "humanSignoff",
    "certainty",
  ];

  const spreadByAxis = {} as Record<keyof JurorVector["axes"], number>;
  const meanAxes = {} as Record<keyof JurorVector["axes"], number>;
  let mostContestedAxis: keyof JurorVector["axes"] = "severity";
  let maxSpread = -1;

  for (const key of axisKeys) {
    const vals = jurors.map((j) => j.axes[key]);
    const sd = stdDev(vals);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    spreadByAxis[key] = sd;
    meanAxes[key] = mean;
    if (sd > maxSpread) {
      maxSpread = sd;
      mostContestedAxis = key;
    }
  }

  const verdict: TribunalSummary["verdict"] =
    agreementRatio === 1 && maxSpread < 0.16
      ? "unanimous"
      : agreementRatio >= 0.75 && maxSpread < 0.24
        ? "majority"
        : "split";

  return {
    verdict,
    winningChute,
    agreementRatio,
    maxSpread: Math.max(0, maxSpread),
    mostContestedAxis,
    spreadByAxis,
    meanAxes,
  };
}

/** Exact micro-dollar estimate for one Decision Model forward pass. */
export function costEstimateUsd(
  modelId: DecisionModelId,
  inputTokens: number,
): number {
  const model = MODEL_BY_ID[modelId];
  const tokens = Math.max(0, inputTokens);
  return (tokens / 1_000_000) * model.pricePerMillionInput;
}

/** Compare Decision Model spend & latency against an equivalent generative LLM call. */
export function savingsVsLlm(params: {
  readonly itemCount: number;
  readonly totalInputTokens: number;
  readonly totalDecisionCostUsd: number;
  readonly totalDecisionMs: number;
  readonly escalatedCount: number;
}) {
  const { itemCount, totalInputTokens, totalDecisionCostUsd, totalDecisionMs } =
    params;
  const llmInputCost =
    (totalInputTokens / 1_000_000) * LLM_BASELINE.pricePerMillionInput;
  const llmOutputTokens = itemCount * LLM_BASELINE.typicalOutputTokens;
  const llmOutputCost =
    (llmOutputTokens / 1_000_000) * LLM_BASELINE.pricePerMillionOutput;
  const llmTotalCostUsd = llmInputCost + llmOutputCost;
  const llmTotalMs = itemCount * LLM_BASELINE.typicalLatencyMs;

  const costReductionPct =
    llmTotalCostUsd > 0
      ? Math.max(
          0,
          Math.min(99.9, (1 - totalDecisionCostUsd / llmTotalCostUsd) * 100),
        )
      : 0;
  const speedupRatio =
    totalDecisionMs > 0 ? Math.max(1, llmTotalMs / totalDecisionMs) : 1;

  return {
    llmTotalCostUsd,
    llmOutputTokens,
    llmTotalMs,
    costReductionPct,
    speedupRatio,
  };
}

export function formatMicroUsd(usd: number): string {
  if (usd <= 0) return "$0.000000";
  if (usd < 0.0001) return `$${usd.toFixed(6)}`;
  if (usd < 0.01) return `$${usd.toFixed(5)}`;
  return `$${usd.toFixed(4)}`;
}

/**
 * Deterministic stub evaluator used ONLY when the Playwright e2e suite sends
 * `x-prism-stub` together with `E2E_BYPASS_TOKEN`. Real requests never call this.
 */
export function stubMeridianAnswers(
  text: string,
  modelIndex = 0,
): MeridianAnswers {
  const lower = text.toLowerCase();
  const jitter = (modelIndex - 1.5) * 0.03;
  const isOverride =
    /override|ignore|system:|skip|offshore|do not call|avoid/.test(lower);
  const isStructuring = /9,850|9,900|10,000|structur|split|threshold/.test(
    lower,
  );
  const isUrgent = /urgent|today|3 pm|16:00|30 min|emergency|immediately/.test(
    lower,
  );
  const isExpired = /expired|notary|pending|missing/.test(lower);
  const isPension = /pension|hardship|beneficiary|hospital/.test(lower);
  const isFx = /eur|fx|forward|wire|iban|treasury/.test(lower);

  const adv = clamp01(
    (isOverride ? 0.94 : isStructuring ? 0.88 : isExpired ? 0.14 : 0.03) +
      jitter,
  );
  const urg = clamp01((isUrgent ? 0.89 : isStructuring ? 0.68 : 0.08) + jitter);
  const sevScore = Math.min(
    4,
    Math.max(
      0,
      (isOverride
        ? 3.82
        : isStructuring
          ? 3.35
          : isExpired && isUrgent
            ? 2.45
            : isExpired
              ? 1.95
              : 0.22) +
        jitter * 2,
    ),
  );
  const sign = clamp01(
    (isOverride || isStructuring || isExpired ? 0.94 : 0.06) + jitter,
  );

  const rawProbs = isOverride
    ? {
        fraud: 0.78,
        compliance: 0.16,
        treasury: 0.03,
        pensions: 0.01,
        support: 0.02,
      }
    : isStructuring
      ? {
          compliance: 0.64,
          fraud: 0.3,
          treasury: 0.04,
          pensions: 0.01,
          support: 0.01,
        }
      : isPension
        ? {
            pensions: 0.61,
            compliance: 0.31,
            support: 0.05,
            treasury: 0.02,
            fraud: 0.01,
          }
        : isFx && isExpired
          ? {
              treasury: 0.47,
              compliance: 0.44,
              fraud: 0.05,
              pensions: 0.02,
              support: 0.02,
            }
          : {
              support: 0.93,
              pensions: 0.03,
              treasury: 0.02,
              compliance: 0.01,
              fraud: 0.01,
            };

  const choice = Object.entries(rawProbs).sort((a, b) => b[1] - a[1])[0][0];

  const roundedLevel = Math.round(sevScore);
  const sevProbs: Record<string, number> = {
    "0": 0.02,
    "1": 0.03,
    "2": 0.05,
    "3": 0.05,
    "4": 0.05,
  };
  sevProbs[String(roundedLevel)] = 0.8;

  return {
    routing: { type: "choice", choice, probabilities: rawProbs },
    severity: {
      type: "score",
      score: Number(sevScore.toFixed(2)),
      probabilities: sevProbs,
    },
    urgent: { type: "boolean", probability: Number(urg.toFixed(3)) },
    adversarial: { type: "boolean", probability: Number(adv.toFixed(3)) },
    humanSignoff: { type: "boolean", probability: Number(sign.toFixed(3)) },
  };
}
