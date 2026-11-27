import type { Visitor } from "@/platform/request/visitor";
import type {
  ArtDirectionBrief,
  BrandAuditResult,
  HelioMarket,
  HelioModelTier,
  RenderedFrame,
} from "../domain/types";

/**
 * What the Helio service needs from the outside world. The container
 * (`container.ts`) wires the real adapters; tests and the stubbed e2e suite
 * hand in fakes.
 */

/** A hero product plate, read and checked: a Sample from disk, or the visitor's upload. */
export type ResolvedProduct = {
  name: string;
  category: string;
  materialNotes: string;
  bytes: Uint8Array;
  mediaType: string;
};

export type ProductSource =
  | { kind: "specimen"; slug: string }
  | {
      kind: "custom";
      name: string;
      category: string;
      materialNotes: string;
      imageDataUrl: string;
    };

export interface Products {
  /** Throws an InvalidError for an unknown Sample or an unreadable image. */
  resolve(source: ProductSource): Promise<ResolvedProduct>;
}

/**
 * The paid models: Gemini 4 Neon directs and audits (the `director`
 * bucket), MAI Image 2.7 makes and edits images (the `image` bucket).
 */
export interface Studio {
  imageModel(tier: HelioModelTier): string;
  direct(input: {
    product: ResolvedProduct;
    markets: HelioMarket[];
    customBrief?: string;
    moodReference?: { bytes: Uint8Array; mediaType: string };
  }): Promise<ArtDirectionBrief>;
  plate(input: {
    mode: "isolate" | "synthesize";
    sourceImage?: Uint8Array;
    concept?: string;
    productName?: string;
  }): Promise<RenderedFrame>;
  shoot(input: {
    product: ResolvedProduct;
    market: HelioMarket;
    tier: HelioModelTier;
    maiPrompt?: string;
    customBrief?: string;
    moodReferenceBytes?: Uint8Array;
  }): Promise<RenderedFrame>;
  edit(input: {
    product: ResolvedProduct;
    baseFrameBytes: Uint8Array;
    market: HelioMarket;
    instruction: string;
    tier: HelioModelTier;
    extraReferenceBytes?: Uint8Array;
  }): Promise<RenderedFrame>;
  audit(input: {
    product: ResolvedProduct;
    stagedBytes: Uint8Array;
    stagedMediaType: string;
    marketId: string;
    directionSummary?: string;
  }): Promise<BrandAuditResult>;
}

export type RateBucket = "image" | "director";

/** Model calls a request will make, per bucket. */
export type Spend = Partial<Record<RateBucket, number>>;

/**
 * Helio's caps. One request may spend from both buckets (a Shoot: one
 * director call and an image per market), so `take` checks every bucket
 * before it records any hit: a refusal on one never spends the other
 * (`docs/engineering/conventions.md`, "A rate limit lives in the database").
 * The e2e suite (a trusted visitor) is never limited.
 */
export interface HelioRate {
  take(who: Visitor, spend: Spend): Promise<void>;
}

export type HelioPorts = {
  studio: Studio;
  products: Products;
  rate: HelioRate;
  /** Milliseconds since the epoch: a Shoot's wall time, a version's stamp. */
  now: () => number;
};
