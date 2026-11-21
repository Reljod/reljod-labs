import { requireOwner } from "@/features/access/server/gate";
import {
  type TribunalStreamEvent,
  tribunalRequestSchema,
} from "@/features/prism/domain/api";
import { runMeridianDecision } from "@/features/prism/server/decide";
import { ProviderUnavailableError } from "@/features/prism/server/errors";
import { takeRate, visitor } from "@/features/prism/server/rate";
import {
  bodyOf,
  failure,
  NDJSON_HEADERS,
} from "@/features/prism/server/respond";

export async function POST(request: Request) {
  try {
    const [{ owner }, who, raw] = await Promise.all([
      requireOwner(),
      visitor(),
      bodyOf(request),
    ]);
    const input = tribunalRequestSchema.parse(raw);
    await takeRate(who, owner, "tribunal", input.modelIds.length);

    const started = performance.now();
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (event: TribunalStreamEvent) => {
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          } catch {
            // Stream already closed by client abort.
          }
        };

        await Promise.all(
          input.modelIds.map(async (modelId) => {
            try {
              const res = await runMeridianDecision({
                modelId,
                state: input.state,
                stubbed: who.stubbed,
                abortSignal: request.signal,
              });
              emit({
                type: "juror.result",
                modelId,
                latencyMs: res.latencyMs,
                inputTokens: res.inputTokens,
                outputTokens: res.outputTokens,
                costUsd: res.costUsd,
                answers: res.answers,
              });
            } catch (err) {
              if (!(err instanceof ProviderUnavailableError)) {
                console.error("[prism] tribunal juror failed", modelId, err);
              }
              emit({
                type: "juror.error",
                modelId,
                error:
                  err instanceof ProviderUnavailableError
                    ? err.message
                    : "Juror did not respond.",
              });
            }
          }),
        );

        emit({
          type: "tribunal.done",
          wallMs: Math.round(performance.now() - started),
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
