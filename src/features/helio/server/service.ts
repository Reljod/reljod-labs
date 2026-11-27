import "server-only";
import type { z } from "zod";
import { InvalidError, isAppError, TooLargeError } from "@/platform/errors";
import type { Visitor } from "@/platform/request/visitor";
import { findMarket } from "../domain/samples";
import {
  type auditRequestSchema,
  checkCombinedImageBytes,
  type compareRequestSchema,
  decodeImageDataUrl,
  type editRequestSchema,
  type extractRequestSchema,
  type shootRequestSchema,
} from "../domain/schemas";
import type {
  BrandAuditResult,
  CompareStreamEvent,
  FrameVersion,
  HelioMarket,
  HelioModelTier,
  RenderedFrame,
  ShootStreamEvent,
} from "../domain/types";
import type { HelioPorts } from "./ports";

export type ExtractRequest = z.infer<typeof extractRequestSchema>;
export type ShootRequest = z.infer<typeof shootRequestSchema>;
export type EditRequest = z.infer<typeof editRequestSchema>;
export type AuditRequest = z.infer<typeof auditRequestSchema>;
export type CompareRequest = z.infer<typeof compareRequestSchema>;

/**
 * Everything Helio does. Helio saves nothing, so there is no Owner: only
 * the visitor whose caps a request spends. Each method checks every image
 * (magic bytes, per-image and combined size) before it takes the caps for
 * every model call it will make, and takes them before the first call.
 */
export interface HelioService {
  /** An RGBA product plate: the visitor's photo cut out, or a new product drawn. */
  extract(visitor: Visitor, input: ExtractRequest): Promise<RenderedFrame>;
  /** Resolves once the caps are taken; then direction and each market's frame stream. */
  shoot(
    visitor: Visitor,
    input: ShootRequest,
  ): Promise<AsyncGenerator<ShootStreamEvent>>;
  edit(visitor: Visitor, input: EditRequest): Promise<RenderedFrame>;
  audit(visitor: Visitor, input: AuditRequest): Promise<BrandAuditResult>;
  /** Resolves once the caps are taken; then Flash and Flagship race. */
  compare(
    visitor: Visitor,
    input: CompareRequest,
  ): Promise<AsyncGenerator<CompareStreamEvent>>;
}

/**
 * The words a stream line may show for a failure: a refusal's own (an
 * AppError says what it may), `fallback` otherwise, with the cause logged.
 * An internal error's message (a connection string, a provider's body)
 * never reaches the browser.
 */
function publicMessage(error: unknown, fallback: string): string {
  if (isAppError(error) && error.message) return error.message.slice(0, 260);
  console.error(
    "[helio]",
    fallback,
    error instanceof Error ? error.message : String(error),
  );
  return fallback;
}

function image(dataUrl: string) {
  const decoded = decodeImageDataUrl(dataUrl);
  if (!decoded.ok) throw new InvalidError(decoded.error);
  return decoded.image;
}

function fitsOneRequest(images: (Uint8Array | undefined)[]) {
  const combined = checkCombinedImageBytes(images);
  if (!combined.ok) throw new TooLargeError(combined.error);
}

function market(id: string): HelioMarket {
  const found = findMarket(id);
  if (!found) throw new InvalidError("Unknown market.");
  return found;
}

/**
 * Lines pushed from work running in parallel, pulled one at a time. `run`
 * starts at once; the generator ends when it settles, and rethrows if it
 * rejected.
 */
function lines<E>(run: (emit: (event: E) => void) => Promise<void>) {
  const queue: E[] = [];
  let wake: (() => void) | null = null;
  let settled = false;
  let failure: { error: unknown } | null = null;
  const poke = () => {
    wake?.();
    wake = null;
  };
  run((event) => {
    queue.push(event);
    poke();
  }).then(
    () => {
      settled = true;
      poke();
    },
    (error: unknown) => {
      failure = { error };
      settled = true;
      poke();
    },
  );
  return (async function* (): AsyncGenerator<E> {
    for (;;) {
      if (queue.length > 0) {
        yield queue.shift() as E;
        continue;
      }
      if (settled) {
        if (failure) throw (failure as { error: unknown }).error;
        return;
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  })();
}

export function createHelioService(ports: HelioPorts): HelioService {
  const { studio, products, rate, now } = ports;

  return {
    async extract(visitor, input) {
      const sourceImage =
        input.mode === "isolate" ? image(input.imageDataUrl).bytes : undefined;
      await rate.take(visitor, { image: 1 });
      return studio.plate({
        mode: input.mode,
        sourceImage,
        concept: input.mode === "synthesize" ? input.concept : undefined,
        productName: input.productName,
      });
    },

    async shoot(visitor, input) {
      const markets = input.marketIds.map(market);
      const moodRef = input.moodReferenceDataUrl
        ? image(input.moodReferenceDataUrl)
        : undefined;
      const product = await products.resolve(input.product);
      fitsOneRequest([
        input.product.kind === "custom" ? product.bytes : undefined,
        moodRef?.bytes,
      ]);
      // Both buckets in one take: a refused image cap never spends the director's.
      await rate.take(visitor, { director: 1, image: markets.length });

      const started = now();
      const imageModel = studio.imageModel(input.tier);
      let totalCostUsd = 0;
      return lines<ShootStreamEvent>(async (emit) => {
        try {
          emit({
            type: "phase",
            phase: "directing",
            message: `Gemini 4 Neon directing lighting, optics & localized copy for ${markets.length} market${markets.length > 1 ? "s" : ""}…`,
          });
          const brief = await studio.direct({
            product,
            markets,
            customBrief: input.customBrief,
            moodReference: moodRef,
          });
          totalCostUsd += brief.costUsd;
          emit({ type: "direction", brief });
          emit({
            type: "phase",
            phase: "shooting",
            message: `MAI Image 2.7 ${input.tier === "flagship" ? "Flagship" : "Flash"} shooting ${markets.length} multi-reference sets in parallel…`,
          });

          const directionOf = new Map(
            brief.markets.map((m) => [m.marketId, m]),
          );
          await Promise.all(
            markets.map(async (m) => {
              emit({ type: "frame-start", marketId: m.id, model: imageModel });
              try {
                const direction = directionOf.get(m.id);
                const shot = await studio.shoot({
                  product,
                  market: m,
                  tier: input.tier,
                  maiPrompt: direction?.maiPrompt,
                  customBrief: input.customBrief,
                  moodReferenceBytes: moodRef?.bytes,
                });
                totalCostUsd += shot.costUsd;
                const version: FrameVersion = {
                  id: `${m.id}-${now()}-${Math.random().toString(36).slice(2, 7)}`,
                  label: "Pass 01 · Original Shoot",
                  imageDataUrl: shot.imageDataUrl,
                  model: shot.model,
                  tier: input.tier,
                  latencyMs: shot.latencyMs,
                  costUsd: shot.costUsd,
                  instruction: direction?.maiPrompt || m.scenePrompt,
                  createdAt: now(),
                };
                emit({ type: "frame-ready", marketId: m.id, version });
              } catch (error) {
                emit({
                  type: "frame-error",
                  marketId: m.id,
                  error: publicMessage(error, "Market shoot failed."),
                });
              }
            }),
          );
        } catch (error) {
          const message = publicMessage(error, "Campaign shoot interrupted.");
          for (const m of markets)
            emit({ type: "frame-error", marketId: m.id, error: message });
        }
        emit({
          type: "done",
          totalLatencyMs: now() - started,
          totalCostUsd,
        });
      });
    },

    async edit(visitor, input) {
      const target = market(input.marketId);
      const base = image(input.baseImageDataUrl);
      const extraReferenceBytes = input.referenceImageDataUrl
        ? image(input.referenceImageDataUrl).bytes
        : undefined;
      const product = await products.resolve(input.product);
      fitsOneRequest([
        base.bytes,
        input.product.kind === "custom" ? product.bytes : undefined,
        extraReferenceBytes,
      ]);
      await rate.take(visitor, { image: 1 });
      return studio.edit({
        product,
        baseFrameBytes: base.bytes,
        market: target,
        instruction: input.instruction,
        tier: input.tier,
        extraReferenceBytes,
      });
    },

    async audit(visitor, input) {
      const staged = image(input.stagedImageDataUrl);
      const product = await products.resolve(input.product);
      fitsOneRequest([
        staged.bytes,
        input.product.kind === "custom" ? product.bytes : undefined,
      ]);
      await rate.take(visitor, { director: 1 });
      return studio.audit({
        product,
        stagedBytes: staged.bytes,
        stagedMediaType: staged.mediaType,
        marketId: input.marketId,
        directionSummary: input.directionSummary,
      });
    },

    async compare(visitor, input) {
      const target = market(input.marketId);
      const product = await products.resolve(input.product);
      await rate.take(visitor, { image: 2 });
      const tiers: HelioModelTier[] = ["flash", "flagship"];
      return lines<CompareStreamEvent>(async (emit) => {
        emit({
          type: "start",
          flashModel: studio.imageModel("flash"),
          flagshipModel: studio.imageModel("flagship"),
        });
        await Promise.all(
          tiers.map(async (tier) => {
            try {
              const res = await studio.shoot({
                product,
                market: target,
                tier,
                customBrief: input.customBrief,
              });
              emit({
                type: "result",
                tier,
                model: res.model,
                imageDataUrl: res.imageDataUrl,
                latencyMs: res.latencyMs,
                costUsd: res.costUsd,
              });
            } catch (error) {
              emit({
                type: "error",
                tier,
                error: publicMessage(error, "Generation failed."),
              });
            }
          }),
        );
        emit({ type: "done" });
      });
    },
  };
}
