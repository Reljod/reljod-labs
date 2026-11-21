import { accessOrDenied } from "@/features/access/server/gate";
import { findMarket } from "@/features/helio/domain/samples";
import {
  checkCombinedImageBytes,
  decodeImageDataUrl,
  shootRequestSchema,
} from "@/features/helio/domain/schemas";
import type {
  FrameVersion,
  HelioMarket,
  ShootStreamEvent,
} from "@/features/helio/domain/types";
import { takeRates, visitor } from "@/features/helio/server/rate";
import {
  failure,
  isStubRequest,
  json,
  NO_STORE,
} from "@/features/helio/server/respond";
import {
  directCampaign,
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
    const parsed = shootRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return json(
        { error: parsed.error.issues[0]?.message || "Invalid shoot request." },
        400,
      );
    }

    const data = parsed.data;
    const markets = data.marketIds
      .map((id) => findMarket(id))
      .filter((m): m is HelioMarket => Boolean(m));
    if (markets.length !== data.marketIds.length) {
      return json({ error: "One or more markets are unknown." }, 400);
    }

    let moodRef: { bytes: Uint8Array; mediaType: string } | undefined;
    if (data.moodReferenceDataUrl) {
      const decoded = decodeImageDataUrl(data.moodReferenceDataUrl);
      if (!decoded.ok) {
        return json({ error: decoded.error }, 400);
      }
      moodRef = decoded.image;
    }

    // Validate product image and combined request size BEFORE taking rate.
    const product = await resolveProductSource(data.product);
    if (data.product.kind === "custom") {
      const sizeCheck = checkCombinedImageBytes([
        product.bytes,
        moodRef?.bytes,
      ]);
      if (!sizeCheck.ok) {
        return json({ error: sizeCheck.error }, 413);
      }
    }

    const stub = isStubRequest(request);

    // Atomically check & record both director and image buckets in one transaction.
    if (!stub) {
      const who = await visitor();
      await takeRates(who, [
        { bucket: "director", units: 1 },
        { bucket: "image", units: markets.length },
      ]);
    }

    const encoder = new TextEncoder();
    const started = Date.now();
    const imageModel = imageModelIdForTier(data.tier);

    const stream = new ReadableStream({
      async start(controller) {
        const emit = (event: ShootStreamEvent) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        };
        let totalCostUsd = 0;

        try {
          emit({
            type: "phase",
            phase: "directing",
            message: `Gemini 4 Neon directing lighting, optics & localized copy for ${markets.length} market${markets.length > 1 ? "s" : ""}…`,
          });

          const brief = await directCampaign({
            product,
            markets,
            customBrief: data.customBrief,
            moodReference: moodRef,
            stub,
          });
          totalCostUsd += brief.costUsd;
          emit({ type: "direction", brief });

          emit({
            type: "phase",
            phase: "shooting",
            message: `MAI Image 2.7 ${data.tier === "flagship" ? "Flagship" : "Flash"} shooting ${markets.length} multi-reference sets in parallel…`,
          });

          const dirById = new Map(brief.markets.map((m) => [m.marketId, m]));

          await Promise.all(
            markets.map(async (market) => {
              emit({
                type: "frame-start",
                marketId: market.id,
                model: imageModel,
              });
              try {
                const direction = dirById.get(market.id);
                const shot = await shootMarketFrame({
                  product,
                  market,
                  tier: data.tier,
                  maiPrompt: direction?.maiPrompt,
                  customBrief: data.customBrief,
                  moodReferenceBytes: moodRef?.bytes,
                  stub,
                });
                totalCostUsd += shot.costUsd;
                const version: FrameVersion = {
                  id: `${market.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                  label: "Pass 01 · Original Shoot",
                  imageDataUrl: shot.imageDataUrl,
                  model: shot.model,
                  tier: data.tier,
                  latencyMs: shot.latencyMs,
                  costUsd: shot.costUsd,
                  instruction: direction?.maiPrompt || market.scenePrompt,
                  createdAt: Date.now(),
                };
                emit({ type: "frame-ready", marketId: market.id, version });
              } catch (err) {
                const message =
                  err instanceof Error && err.message
                    ? err.message.slice(0, 180)
                    : "Market shoot failed.";
                emit({
                  type: "frame-error",
                  marketId: market.id,
                  error: message,
                });
              }
            }),
          );

          emit({
            type: "done",
            totalLatencyMs: Date.now() - started,
            totalCostUsd,
          });
        } catch (err) {
          const message =
            err instanceof Error && err.message
              ? err.message.slice(0, 200)
              : "Campaign shoot interrupted.";
          for (const market of markets) {
            emit({ type: "frame-error", marketId: market.id, error: message });
          }
          emit({
            type: "done",
            totalLatencyMs: Date.now() - started,
            totalCostUsd,
          });
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
