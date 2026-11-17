import "server-only";
import {
  createGateway,
  generateText,
  type LanguageModelUsage,
  NoObjectGeneratedError,
  Output,
  type UserContent,
} from "ai";
import type { z } from "zod";
import {
  estimateCost,
  gatewayCost,
  type ModelCall,
  type Purpose,
} from "../domain/models";
import { auditPipeline } from "./audit";
import { publish } from "./emit";
import { env } from "./env";
import { recordModelCall } from "./repository";

let gatewayClient: ReturnType<typeof createGateway> | undefined;

export function gateway() {
  gatewayClient ??= createGateway({ apiKey: env.aiGatewayApiKey() });
  return gatewayClient;
}

/** Who a model call is made for, and in which pass of the pipeline. Passed into every stage. */
export type RunContext = { runId: string; owner: string; generation: number };

/**
 * Records one model call: a row in `model_calls`, the Run's cost, a `call`
 * event and the new total on the stream, and a `model.called` Audit line.
 * The cost is what the gateway reported, else an estimate from list prices.
 * Spend tracking never fails the work it measures.
 */
export async function trackCall(
  ctx: RunContext,
  input: {
    purpose: Purpose;
    label: string;
    model: string;
    usage: Partial<LanguageModelUsage> | undefined;
    providerMetadata: unknown;
    started: number;
  },
): Promise<ModelCall | null> {
  const inputTokens = input.usage?.inputTokens ?? 0;
  const outputTokens = input.usage?.outputTokens ?? 0;
  const costUsd =
    gatewayCost(input.providerMetadata) ??
    estimateCost(input.model, inputTokens, outputTokens);
  try {
    const { call, runCostUsd } = await recordModelCall(ctx.runId, {
      purpose: input.purpose,
      label: input.label,
      model: input.model,
      inputTokens,
      outputTokens,
      costUsd,
      ms: Date.now() - input.started,
      generation: ctx.generation,
    });
    await auditPipeline({
      owner: ctx.owner,
      action: "model.called",
      runId: ctx.runId,
      summary: `${input.label}: ${input.model}, ${inputTokens + outputTokens} tokens, $${costUsd.toFixed(4)}`,
      detail: {
        purpose: input.purpose,
        model: input.model,
        inputTokens,
        outputTokens,
        costUsd,
        ms: call.ms,
        generation: ctx.generation,
      },
    });
    // The stream may already be closed (the Run was stopped); the cost is on
    // the row and in the Audit trail either way.
    await publish(ctx, [
      { type: "call", call },
      { type: "patch", patch: { costUsd: runCostUsd } },
    ]).catch(() => {});
    return call;
  } catch (error) {
    console.error("[process-transfer] could not record a model call", error);
    return null;
  }
}

/**
 * One model call with structured output, tracked. Gemini runs at its default
 * temperature (lowering it makes Gemini 3 loop) with little reasoning; other
 * models run cool. A call whose output does not fit the schema is still
 * billed, so it is tracked before the error goes on.
 */
export async function generate<T>(
  ctx: RunContext,
  input: {
    purpose: Purpose;
    label: string;
    model: string;
    schema: z.ZodType<T>;
    instructions: string;
    content: UserContent;
    maxOutputTokens: number;
  },
): Promise<T> {
  const started = Date.now();
  const google = input.model.startsWith("google/");
  try {
    const result = await generateText({
      model: gateway()(input.model),
      instructions: input.instructions,
      output: Output.object({ schema: input.schema }),
      messages: [{ role: "user", content: input.content }],
      maxOutputTokens: input.maxOutputTokens,
      maxRetries: 1,
      ...(google ? { reasoning: "low" as const } : { temperature: 0.2 }),
    });
    await trackCall(ctx, {
      purpose: input.purpose,
      label: input.label,
      model: input.model,
      usage: result.usage,
      providerMetadata: result.providerMetadata,
      started,
    });
    return result.output as T;
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      await trackCall(ctx, {
        purpose: input.purpose,
        label: `${input.label} (unusable output)`,
        model: input.model,
        usage: error.usage,
        providerMetadata: undefined,
        started,
      });
    }
    throw error;
  }
}
