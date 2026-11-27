import "server-only";
import type { z } from "zod";
import type { Owner } from "@/features/access/domain/owner";
import type { Visitor } from "@/platform/request/visitor";
import type {
  CascadeStreamEvent,
  cascadeRequestSchema,
  MeridianAnswers,
  RefractResponse,
  refractRequestSchema,
  TribunalStreamEvent,
  tribunalRequestSchema,
} from "../domain/api";
import { MERIDIAN_QUESTIONS } from "../domain/questions";
import { ProviderUnavailableError } from "./errors";
import type { PrismPorts } from "./ports";

/** Who a Prism call is for: the Owner its hits are filed under, the visitor whose caps it spends. */
export type Caller = { owner: Owner; visitor: Visitor };

export type RefractRequest = z.infer<typeof refractRequestSchema>;
export type TribunalRequest = z.infer<typeof tribunalRequestSchema>;
export type CascadeRequest = z.infer<typeof cascadeRequestSchema>;

/** Slips a Cascade sends to the Decision Model at once. */
const CASCADE_CONCURRENCY = 3;

/**
 * Everything Prism does. Each method takes the cap for every Decision Model
 * call it will make (one Refraction, one per Juror, one per Slip) before the
 * first call, so a refusal spends nothing; the streams start only after.
 */
export interface PrismService {
  /** One Refraction: the Meridian triage slate unless the Lab sends its own. */
  refract(
    caller: Caller,
    input: RefractRequest,
    signal?: AbortSignal,
  ): Promise<RefractResponse>;
  /** Resolves once the cap is taken; then each Juror's answer streams as it lands. */
  tribunal(
    caller: Caller,
    input: TribunalRequest,
    signal?: AbortSignal,
  ): Promise<AsyncGenerator<TribunalStreamEvent>>;
  /** Resolves once the cap is taken; then each Slip streams as it is sorted. */
  cascade(
    caller: Caller,
    input: CascadeRequest,
    signal?: AbortSignal,
  ): Promise<AsyncGenerator<CascadeStreamEvent>>;
}

/** What a failed call tells the visitor: the model's own message, or `fallback`. */
function reason(error: unknown, fallback: string, what: string) {
  if (error instanceof ProviderUnavailableError) return error.message;
  console.error(`[prism] ${what} failed`, error);
  return fallback;
}

/**
 * Runs `run` over `items`, at most `concurrency` at once, and yields each
 * result as it finishes (not in input order). `run` must not reject. Stops
 * starting new items once `signal` aborts.
 */
async function* inCompletionOrder<I, R>(
  items: readonly I[],
  concurrency: number,
  run: (item: I, index: number) => Promise<R>,
  signal?: AbortSignal,
): AsyncGenerator<R> {
  const inflight = new Map<number, Promise<{ index: number; value: R }>>();
  let next = 0;
  const start = () => {
    const index = next++;
    inflight.set(
      index,
      run(items[index] as I, index).then((value) => ({ index, value })),
    );
  };
  while (next < items.length && inflight.size < concurrency) start();
  while (inflight.size > 0) {
    const { index, value } = await Promise.race(inflight.values());
    inflight.delete(index);
    if (next < items.length && !signal?.aborted) start();
    yield value;
  }
}

export function createPrismService(ports: PrismPorts): PrismService {
  const { decider, rate, now } = ports;

  const meridian = async (
    modelId: RefractRequest["modelId"],
    state: string,
    signal?: AbortSignal,
  ) => {
    const result = await decider.decide({
      modelId,
      state,
      questions: MERIDIAN_QUESTIONS,
      signal,
    });
    return { ...result, answers: result.answers as unknown as MeridianAnswers };
  };

  return {
    async refract(caller, input, signal) {
      await rate.take("refract", caller.visitor, { owner: caller.owner });
      return decider.decide({
        modelId: input.modelId,
        state: input.state,
        questions: input.questions ?? MERIDIAN_QUESTIONS,
        signal,
      });
    },

    async tribunal(caller, input, signal) {
      await rate.take("tribunal", caller.visitor, {
        owner: caller.owner,
        units: input.modelIds.length,
      });
      const started = now();
      const jurors = inCompletionOrder(
        input.modelIds,
        input.modelIds.length,
        async (modelId): Promise<TribunalStreamEvent> => {
          try {
            const res = await meridian(modelId, input.state, signal);
            return {
              type: "juror.result",
              modelId,
              latencyMs: res.latencyMs,
              inputTokens: res.inputTokens,
              outputTokens: res.outputTokens,
              costUsd: res.costUsd,
              answers: res.answers,
            };
          } catch (error) {
            return {
              type: "juror.error",
              modelId,
              error: reason(
                error,
                "Juror did not respond.",
                `juror ${modelId}`,
              ),
            };
          }
        },
      );
      return (async function* () {
        yield* jurors;
        yield { type: "tribunal.done", wallMs: Math.round(now() - started) };
      })();
    },

    async cascade(caller, input, signal) {
      await rate.take("cascade", caller.visitor, {
        owner: caller.owner,
        units: input.items.length,
      });
      const started = now();
      const slips = inCompletionOrder(
        input.items,
        CASCADE_CONCURRENCY,
        async (item, index): Promise<CascadeStreamEvent> => {
          try {
            const res = await meridian(input.modelId, item.text, signal);
            return {
              type: "item.decided",
              id: item.id,
              index,
              latencyMs: res.latencyMs,
              inputTokens: res.inputTokens,
              outputTokens: res.outputTokens,
              costUsd: res.costUsd,
              answers: res.answers,
            };
          } catch (error) {
            return {
              type: "item.error",
              id: item.id,
              index,
              error: reason(
                error,
                "Slip could not be sorted.",
                `cascade item ${item.id}`,
              ),
            };
          }
        },
        signal,
      );
      return (async function* () {
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        let totalCostUsd = 0;
        for await (const event of slips) {
          if (event.type === "item.decided") {
            totalInputTokens += event.inputTokens;
            totalOutputTokens += event.outputTokens;
            totalCostUsd += event.costUsd;
          }
          yield event;
        }
        yield {
          type: "cascade.done",
          wallMs: Math.round(now() - started),
          totalInputTokens,
          totalOutputTokens,
          totalCostUsd,
        };
      })();
    },
  };
}
