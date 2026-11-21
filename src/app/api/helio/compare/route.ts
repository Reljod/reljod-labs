import { accessOrDenied } from "@/features/access/server/gate";
import { findMarket } from "@/features/helio/domain/samples";
import { compareRequestSchema } from "@/features/helio/domain/schemas";
import type {
  CompareStreamEvent,
  HelioModelTier,
} from "@/features/helio/domain/types";
import { takeRate } from "@/features/helio/server/rate";
import {
  failure,
  isStubRequest,
  json,
  NO_STORE,
  visitorKeyOf,
} from "@/features/helio/server/respond";
import {
  imageModelIdForTier,
  resolveProductSource,
  shootMarketFrame,
} from "@/features/helio/server/studio";

export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const access = await accessOrDenied();
    if (access instanceof Response) return access;

    const raw = await request.json().catch(() => null);
    const parsed = compareRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return json(
        {
          error: parsed.error.issues[0]?.message || "Invalid compare request.",
        },
        400,
      );
    }

    const data = parsed.data;
    const market = findMarket(data.marketId);
    if (!market) return json({ error: "Unknown market." }, 400);

    const product = await resolveProductSource(data.product);
    const stub = isStubRequest(request);

    if (!stub) {
      takeRate({
        visitorKey: visitorKeyOf(access),
        bucket: "image",
        units: 2,
      });
    }

    const encoder = new TextEncoder();
    const flashModel = imageModelIdForTier("flash");
    const flagshipModel = imageModelIdForTier("flagship");

    const stream = new ReadableStream({
      async start(controller) {
        const emit = (event: CompareStreamEvent) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        };

        try {
          emit({ type: "start", flashModel, flagshipModel });
          const tiers: HelioModelTier[] = ["flash", "flagship"];

          await Promise.all(
            tiers.map(async (tier) => {
              try {
                const res = await shootMarketFrame({
                  product,
                  market,
                  tier,
                  customBrief: data.customBrief,
                  stub,
                });
                emit({
                  type: "result",
                  tier,
                  model: res.model,
                  imageDataUrl: res.imageDataUrl,
                  latencyMs: res.latencyMs,
                  costUsd: res.costUsd,
                });
              } catch (err) {
                emit({
                  type: "error",
                  tier,
                  error:
                    err instanceof Error && err.message
                      ? err.message.slice(0, 180)
                      : "Generation failed.",
                });
              }
            }),
          );
          emit({ type: "done" });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        ...NO_STORE,
        "content-type": "application/x-ndjson; charset=utf-8",
      },
    });
  } catch (error) {
    return failure(error);
  }
}
