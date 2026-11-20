import { requireAccess } from "@/features/access/server/gate";
import {
  type CascadeStreamEvent,
  cascadeRequestSchema,
} from "@/features/prism/domain/api";
import { runMeridianDecision } from "@/features/prism/server/decide";
import { takeRate, visitor } from "@/features/prism/server/rate";
import {
  bodyOf,
  failure,
  NDJSON_HEADERS,
} from "@/features/prism/server/respond";

const CONCURRENCY = 3;

export async function POST(request: Request) {
  try {
    const [, who, raw] = await Promise.all([
      requireAccess(),
      visitor(),
      bodyOf(request),
    ]);
    const input = cascadeRequestSchema.parse(raw);
    takeRate(who, "cascade");

    const started = performance.now();
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (event: CascadeStreamEvent) => {
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          } catch {
            // Stream already closed.
          }
        };

        let nextIndex = 0;
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        let totalCostUsd = 0;

        const worker = async () => {
          while (!request.signal.aborted) {
            const index = nextIndex;
            nextIndex += 1;
            const item = input.items[index];
            if (!item) return;

            try {
              const res = await runMeridianDecision({
                modelId: input.modelId,
                state: item.text,
                stubbed: who.stubbed,
                abortSignal: request.signal,
              });
              totalInputTokens += res.inputTokens;
              totalOutputTokens += res.outputTokens;
              totalCostUsd += res.costUsd;
              emit({
                type: "item.decided",
                id: item.id,
                index,
                latencyMs: res.latencyMs,
                inputTokens: res.inputTokens,
                outputTokens: res.outputTokens,
                costUsd: res.costUsd,
                answers: res.answers,
              });
            } catch (err) {
              emit({
                type: "item.error",
                id: item.id,
                index,
                error:
                  err instanceof Error
                    ? err.message
                    : "Slip could not be sorted.",
              });
            }
          }
        };

        await Promise.all(
          Array.from(
            { length: Math.min(CONCURRENCY, input.items.length) },
            () => worker(),
          ),
        );

        emit({
          type: "cascade.done",
          wallMs: Math.round(performance.now() - started),
          totalInputTokens,
          totalOutputTokens,
          totalCostUsd,
        });
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      },
    });

    return new Response(stream, { headers: NDJSON_HEADERS });
  } catch (error) {
    return failure(error);
  }
}
