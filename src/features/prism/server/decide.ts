import "server-only";
import { createGateway, experimental_decide as decide } from "ai";
import type {
  MeridianAnswers,
  PrismAnswer,
  RefractResponse,
} from "../domain/api";
import { DECISION_MODELS, type DecisionModelId } from "../domain/models";
import { MERIDIAN_QUESTIONS, type PrismQuestionMap } from "../domain/questions";
import { costEstimateUsd, stubMeridianAnswers } from "../domain/routing";
import { env } from "./env";
import { ProviderUnavailableError } from "./errors";

let cachedGateway: ReturnType<typeof createGateway> | undefined;

function gateway() {
  cachedGateway ??= createGateway({ apiKey: env.aiGatewayApiKey() });
  return cachedGateway;
}

function estimateTokens(state: string, questions: PrismQuestionMap): number {
  const qLen = JSON.stringify(questions).length;
  return Math.max(40, Math.round((state.length + qLen) / 4));
}

function normalizeAnswers(
  raw: Record<string, unknown>,
): Record<string, PrismAnswer> {
  const out: Record<string, PrismAnswer> = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object") continue;
    const ans = value as Record<string, unknown>;
    if (ans.type === "boolean" && typeof ans.probability === "number") {
      out[id] = { type: "boolean", probability: ans.probability };
    } else if (ans.type === "choice" && typeof ans.choice === "string") {
      const probs =
        ans.probabilities && typeof ans.probabilities === "object"
          ? (ans.probabilities as Record<string, number>)
          : undefined;
      out[id] = {
        type: "choice",
        choice: ans.choice,
        ...(probs ? { probabilities: probs } : {}),
      };
    } else if (ans.type === "score" && typeof ans.score === "number") {
      const probs =
        ans.probabilities && typeof ans.probabilities === "object"
          ? (ans.probabilities as Record<string, number>)
          : undefined;
      out[id] = {
        type: "score",
        score: ans.score,
        ...(probs ? { probabilities: probs } : {}),
      };
    }
  }
  return out;
}

/**
 * Executes a single-forward-pass Decision Model call through Vercel AI Gateway
 * (`experimental_decide`). Returns calibrated probabilities, exact latency,
 * token usage (`outputTokens = 0`), and micro-dollar cost.
 */
export async function runDecision({
  modelId,
  state,
  questions,
  stubbed = false,
  abortSignal,
}: {
  modelId: DecisionModelId;
  state: string;
  questions: PrismQuestionMap;
  stubbed?: boolean;
  abortSignal?: AbortSignal;
}): Promise<RefractResponse> {
  const started = performance.now();

  if (stubbed) {
    const modelIndex = DECISION_MODELS.findIndex((m) => m.id === modelId);
    const delayMs = 70 + Math.max(0, modelIndex) * 35;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    const inputTokens = estimateTokens(state, questions);
    const isMeridian =
      "routing" in questions &&
      "severity" in questions &&
      "urgent" in questions &&
      "adversarial" in questions &&
      "humanSignoff" in questions;
    const answers: Record<string, PrismAnswer> = isMeridian
      ? (stubMeridianAnswers(
          state,
          Math.max(0, modelIndex),
        ) as unknown as Record<string, PrismAnswer>)
      : Object.fromEntries(
          Object.entries(questions).map(([id, q]) => {
            if (q.type === "boolean") {
              return [
                id,
                { type: "boolean", probability: 0.74 } satisfies PrismAnswer,
              ];
            }
            if (q.type === "choice") {
              const keys = Object.keys(q.criteria);
              const probs: Record<string, number> = {};
              keys.forEach((k, idx) => {
                probs[k] =
                  idx === 0
                    ? 0.72
                    : Number((0.28 / Math.max(1, keys.length - 1)).toFixed(3));
              });
              return [
                id,
                {
                  type: "choice",
                  choice: keys[0] ?? "",
                  probabilities: probs,
                } satisfies PrismAnswer,
              ];
            }
            const max = Math.max(1, q.criteria.length - 1);
            const probs: Record<string, number> = {};
            q.criteria.forEach((_, idx) => {
              probs[String(idx)] =
                idx === Math.min(2, max)
                  ? 0.68
                  : Number(
                      (0.32 / Math.max(1, q.criteria.length - 1)).toFixed(3),
                    );
            });
            return [
              id,
              {
                type: "score",
                score: Number(Math.min(2.1, max).toFixed(2)),
                probabilities: probs,
              } satisfies PrismAnswer,
            ];
          }),
        );

    return {
      modelId,
      resolvedModel: modelId,
      latencyMs: Math.round(performance.now() - started),
      inputTokens,
      outputTokens: 0,
      costUsd: costEstimateUsd(modelId, inputTokens),
      answers,
    };
  }

  try {
    const result = await decide({
      model: gateway().decisionModel(modelId),
      state,
      questions,
      maxRetries: 1,
      abortSignal,
    });
    const latencyMs = Math.max(1, Math.round(performance.now() - started));
    const inputTokens =
      result.usage?.inputTokens ?? estimateTokens(state, questions);
    const outputTokens = result.usage?.outputTokens ?? 0;

    return {
      modelId,
      resolvedModel: result.response?.modelId ?? modelId,
      latencyMs,
      inputTokens,
      outputTokens,
      costUsd: costEstimateUsd(modelId, inputTokens),
      answers: normalizeAnswers(result.answers as Record<string, unknown>),
    };
  } catch (error) {
    const msg =
      error instanceof Error
        ? error.message
        : "Decision model call did not succeed.";
    throw new ProviderUnavailableError(
      `${modelId} could not evaluate this slip (${msg.slice(0, 140)}).`,
    );
  }
}

export async function runMeridianDecision(params: {
  modelId: DecisionModelId;
  state: string;
  stubbed?: boolean;
  abortSignal?: AbortSignal;
}) {
  const res = await runDecision({
    ...params,
    questions: MERIDIAN_QUESTIONS,
  });
  return {
    ...res,
    answers: res.answers as unknown as MeridianAnswers,
  };
}
