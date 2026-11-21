import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createGateway, generateImage, generateText, Output } from "ai";
import { z } from "zod";
import {
  AUDIT_SYSTEM_INSTRUCTIONS,
  buildCampaignShootPrompt,
  buildDirectorPrompt,
  buildIsolateCutoutPrompt,
  buildSurgicalEditPrompt,
  buildSynthesizeProductPrompt,
  DIRECTOR_SYSTEM_INSTRUCTIONS,
} from "../domain/brief";
import { findMarket, findSpecimen } from "../domain/samples";
import { decodeImageDataUrl } from "../domain/schemas";
import type {
  ArtDirectionBrief,
  BrandAuditResult,
  HelioMarket,
  HelioModelTier,
  MarketDirection,
} from "../domain/types";
import { env } from "./env";

function getGateway() {
  const apiKey = env.aiGatewayApiKey();
  if (!apiKey) {
    throw new Error(
      "AI Gateway API key is not configured (HELIO_AI_GATEWAY_API_KEY or DOCUMENT_COMPLIANCE_AI_GATEWAY_API_KEY).",
    );
  }
  return createGateway({ apiKey });
}

export function imageModelIdForTier(tier: HelioModelTier): string {
  return tier === "flagship" ? env.flagshipImageModel() : env.flashImageModel();
}

export function extractGatewayCost(
  providerMetadata: unknown,
  fallbackUsd: number,
): number {
  const meta = providerMetadata as
    | { gateway?: { cost?: string | number; gatewayCost?: string | number } }
    | undefined;
  const raw = meta?.gateway?.cost ?? meta?.gateway?.gatewayCost;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const parsed = Number.parseFloat(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallbackUsd;
}

export function bytesToDataUrl(bytes: Uint8Array, mediaType: string): string {
  return `data:${mediaType};base64,${Buffer.from(bytes).toString("base64")}`;
}

export type ResolvedProduct = {
  name: string;
  category: string;
  materialNotes: string;
  bytes: Uint8Array;
  mediaType: string;
};

const specimenBytesCache = new Map<string, Uint8Array>();

export async function resolveProductSource(
  source:
    | { kind: "specimen"; slug: string }
    | {
        kind: "custom";
        name: string;
        category: string;
        materialNotes: string;
        imageDataUrl: string;
      },
): Promise<ResolvedProduct> {
  if (source.kind === "specimen") {
    const specimen = findSpecimen(source.slug);
    if (!specimen) {
      throw new Error(`Unknown specimen product: ${source.slug}`);
    }
    let bytes = specimenBytesCache.get(specimen.slug);
    if (!bytes) {
      const filePath = join(
        process.cwd(),
        "public",
        "helio",
        "samples",
        `${specimen.slug}.png`,
      );
      const buf = await readFile(filePath);
      bytes = new Uint8Array(buf);
      specimenBytesCache.set(specimen.slug, bytes);
    }
    return {
      name: specimen.name,
      category: specimen.category,
      materialNotes: specimen.materialNotes,
      bytes,
      mediaType: "image/png",
    };
  }

  const decoded = decodeImageDataUrl(source.imageDataUrl);
  if (!decoded.ok) {
    throw new Error(decoded.error);
  }
  return {
    name: source.name,
    category: source.category,
    materialNotes: source.materialNotes,
    bytes: decoded.image.bytes,
    mediaType: decoded.image.mediaType,
  };
}

const directionSchema = z.object({
  campaignTitle: z.string(),
  executiveSummary: z.string(),
  thinkingSummary: z.string(),
  markets: z.array(
    z.object({
      marketId: z.string(),
      headline: z.string(),
      subcopy: z.string(),
      localizedBadge: z.string(),
      cameraSpec: z.string(),
      lightingSpec: z.string(),
      materialPhysics: z.string(),
      maiPrompt: z.string(),
    }),
  ),
});

/**
 * Google Gemini 4 Neon (Nov 18, 2026) Executive Creative Director.
 * Sees the real hero product plate and produces lighting/lens/copy briefs.
 */
export async function directCampaign(input: {
  product: ResolvedProduct;
  markets: HelioMarket[];
  customBrief?: string;
  moodReference?: { bytes: Uint8Array; mediaType: string };
  stub?: boolean;
}): Promise<ArtDirectionBrief> {
  const modelId = env.directorModel();
  if (input.stub) {
    return {
      campaignTitle: `${input.product.name} · Global Light Edition`,
      executiveSummary:
        "Three calibrated flagship environments tuned to preserve material truth across coastal twilight, travertine daylight, and warm tropical hour.",
      thinkingSummary:
        "Balanced specular rim light against matte surface grain; preserved silhouette lock across all three markets.",
      markets: input.markets.map((m) => ({
        marketId: m.id,
        headline: m.defaultHeadline,
        subcopy: m.defaultSubcopy,
        localizedBadge: `${m.city.toUpperCase()} · ${m.kelvin}K`,
        cameraSpec: m.lens,
        lightingSpec: `${m.kelvin}K directional key + calibrated ambient bounce`,
        materialPhysics: `Contact shadow & reflection calibrated on ${m.surface.toLowerCase()}`,
        maiPrompt: m.scenePrompt,
      })),
      model: `${modelId} (stub)`,
      latencyMs: 180,
      costUsd: 0.0018,
      reasoningTokens: 142,
    };
  }

  const gw = getGateway();
  const started = Date.now();
  const promptText = buildDirectorPrompt({
    productName: input.product.name,
    productCategory: input.product.category,
    materialNotes: input.product.materialNotes,
    markets: input.markets,
    customBrief: input.customBrief,
    hasMoodReference: Boolean(input.moodReference),
  });

  const userContent: Array<
    | { type: "text"; text: string }
    | { type: "image"; image: Uint8Array; mediaType: string }
  > = [
    { type: "text", text: promptText },
    {
      type: "image",
      image: input.product.bytes,
      mediaType: input.product.mediaType,
    },
  ];
  if (input.moodReference) {
    userContent.push({
      type: "image",
      image: input.moodReference.bytes,
      mediaType: input.moodReference.mediaType,
    });
  }

  const result = await generateText({
    model: gw(modelId),
    instructions: DIRECTOR_SYSTEM_INSTRUCTIONS,
    output: Output.object({ schema: directionSchema }),
    providerOptions: {
      google: {
        thinkingConfig: {
          thinkingLevel: "low",
        },
      },
    },
    messages: [{ role: "user", content: userContent }],
  });

  const latencyMs = Date.now() - started;
  const output = result.output;
  const byId = new Map<string, MarketDirection>(
    output.markets.map((m) => [m.marketId, m]),
  );

  // Ensure every requested market has a valid direction entry
  const alignedMarkets: MarketDirection[] = input.markets.map((market) => {
    const planned = byId.get(market.id);
    if (planned) return planned;
    return {
      marketId: market.id,
      headline: market.defaultHeadline,
      subcopy: market.defaultSubcopy,
      localizedBadge: `${market.city.toUpperCase()} · ${market.kelvin}K`,
      cameraSpec: market.lens,
      lightingSpec: `${market.kelvin}K key light`,
      materialPhysics: market.surface,
      maiPrompt: market.scenePrompt,
    };
  });

  const reasoningTokens =
    result.usage?.outputTokenDetails?.reasoningTokens ?? 0;

  return {
    campaignTitle: output.campaignTitle,
    executiveSummary: output.executiveSummary,
    thinkingSummary: output.thinkingSummary,
    markets: alignedMarkets,
    model: modelId,
    latencyMs,
    costUsd: extractGatewayCost(result.providerMetadata, 0.0024),
    reasoningTokens,
  };
}

/**
 * Microsoft MAI Image 2.7-Flash / 2.7 (Nov 17, 2026) native transparent RGBA
 * product isolation OR brand-new product plate synthesis.
 */
export async function generateRgbaPlate(input: {
  mode: "isolate" | "synthesize";
  sourceImage?: Uint8Array;
  concept?: string;
  productName?: string;
  stub?: boolean;
}): Promise<{
  imageDataUrl: string;
  model: string;
  latencyMs: number;
  costUsd: number;
}> {
  const modelId = env.flashImageModel();
  if (input.stub) {
    const sample = await resolveProductSource({
      kind: "specimen",
      slug: "solis-kettle",
    });
    return {
      imageDataUrl: bytesToDataUrl(sample.bytes, "image/png"),
      model: `${modelId} (stub)`,
      latencyMs: 220,
      costUsd: 0.0103,
    };
  }

  const gw = getGateway();
  const started = Date.now();
  const prompt =
    input.mode === "isolate" && input.sourceImage
      ? {
          text: buildIsolateCutoutPrompt(input.productName),
          images: [input.sourceImage],
        }
      : buildSynthesizeProductPrompt(
          input.concept?.trim() || "Minimalist brushed brass espresso tamper",
        );

  const result = await generateImage({
    model: gw.imageModel(modelId),
    prompt,
    size: "1024x1024",
    providerOptions: {
      azure: {
        background: "transparent",
      },
    },
  });

  const latencyMs = Date.now() - started;
  const image = result.image;
  return {
    imageDataUrl: bytesToDataUrl(
      image.uint8Array,
      image.mediaType || "image/png",
    ),
    model: modelId,
    latencyMs,
    costUsd: extractGatewayCost(result.providerMetadata, 0.0103),
  };
}

/**
 * Microsoft MAI Image 2.7 / 2.7-Flash multi-reference campaign photography shoot.
 */
export async function shootMarketFrame(input: {
  product: ResolvedProduct;
  market: HelioMarket;
  tier: HelioModelTier;
  maiPrompt?: string;
  customBrief?: string;
  moodReferenceBytes?: Uint8Array;
  stub?: boolean;
}): Promise<{
  imageDataUrl: string;
  model: string;
  latencyMs: number;
  costUsd: number;
}> {
  const modelId = imageModelIdForTier(input.tier);
  if (input.stub) {
    return {
      imageDataUrl: bytesToDataUrl(
        input.product.bytes,
        input.product.mediaType,
      ),
      model: `${modelId} (stub)`,
      latencyMs: input.tier === "flagship" ? 390 : 240,
      costUsd: input.tier === "flagship" ? 0.034 : 0.0103,
    };
  }

  const gw = getGateway();
  const started = Date.now();
  const images = input.moodReferenceBytes
    ? [input.product.bytes, input.moodReferenceBytes]
    : [input.product.bytes];

  const text = buildCampaignShootPrompt({
    productName: input.product.name,
    market: input.market,
    maiPrompt: input.maiPrompt,
    customBrief: input.customBrief,
    hasMoodReference: Boolean(input.moodReferenceBytes),
  });

  const result = await generateImage({
    model: gw.imageModel(modelId),
    prompt: { text, images },
    size: "1024x1024",
  });

  const latencyMs = Date.now() - started;
  const fallbackCost = input.tier === "flagship" ? 0.034 : 0.0103;
  return {
    imageDataUrl: bytesToDataUrl(
      result.image.uint8Array,
      result.image.mediaType || "image/png",
    ),
    model: modelId,
    latencyMs,
    costUsd: extractGatewayCost(result.providerMetadata, fallbackCost),
  };
}

/**
 * Microsoft MAI Image 2.7 / 2.7-Flash surgical multi-reference art-direction edit.
 */
export async function editCampaignFrame(input: {
  product: ResolvedProduct;
  baseFrameBytes: Uint8Array;
  market: HelioMarket;
  instruction: string;
  tier: HelioModelTier;
  extraReferenceBytes?: Uint8Array;
  stub?: boolean;
}): Promise<{
  imageDataUrl: string;
  model: string;
  latencyMs: number;
  costUsd: number;
}> {
  const modelId = imageModelIdForTier(input.tier);
  if (input.stub) {
    return {
      imageDataUrl: bytesToDataUrl(input.baseFrameBytes, "image/png"),
      model: `${modelId} (stub)`,
      latencyMs: 260,
      costUsd: input.tier === "flagship" ? 0.034 : 0.0103,
    };
  }

  const gw = getGateway();
  const started = Date.now();
  const images = input.extraReferenceBytes
    ? [input.baseFrameBytes, input.product.bytes, input.extraReferenceBytes]
    : [input.baseFrameBytes, input.product.bytes];

  const text = buildSurgicalEditPrompt({
    productName: input.product.name,
    market: input.market,
    instruction: input.instruction,
    hasExtraReference: Boolean(input.extraReferenceBytes),
  });

  const result = await generateImage({
    model: gw.imageModel(modelId),
    prompt: { text, images },
    size: "1024x1024",
  });

  const latencyMs = Date.now() - started;
  const fallbackCost = input.tier === "flagship" ? 0.034 : 0.0103;
  return {
    imageDataUrl: bytesToDataUrl(
      result.image.uint8Array,
      result.image.mediaType || "image/png",
    ),
    model: modelId,
    latencyMs,
    costUsd: extractGatewayCost(result.providerMetadata, fallbackCost),
  };
}

const auditSchema = z.object({
  verdict: z.enum(["APPROVED", "REVISION_ADVISED"]),
  overallScore: z.number().min(0).max(100),
  scores: z.object({
    geometryFidelity: z.number().min(0).max(100),
    lightingPhysics: z.number().min(0).max(100),
    materialRealism: z.number().min(0).max(100),
    brandLegibility: z.number().min(0).max(100),
    commercialImpact: z.number().min(0).max(100),
  }),
  headlineNote: z.string(),
  thinkingSummary: z.string(),
  pins: z
    .array(
      z.object({
        id: z.string(),
        x: z.number().min(6).max(94),
        y: z.number().min(6).max(94),
        category: z.enum([
          "geometry",
          "lighting",
          "material",
          "typography",
          "composition",
        ]),
        status: z.enum(["pass", "note"]),
        label: z.string(),
        detail: z.string(),
      }),
    )
    .min(2)
    .max(5),
});

/**
 * Google Gemini 4 Neon Vision Brand-Integrity Auditor: compares the original
 * product reference plate and the staged campaign photograph side-by-side.
 */
export async function auditStagedFrame(input: {
  product: ResolvedProduct;
  stagedBytes: Uint8Array;
  stagedMediaType: string;
  marketId: string;
  directionSummary?: string;
  stub?: boolean;
}): Promise<BrandAuditResult> {
  const modelId = env.directorModel();
  const market = findMarket(input.marketId);

  if (input.stub) {
    return {
      verdict: "APPROVED",
      overallScore: 95,
      scores: {
        geometryFidelity: 96,
        lightingPhysics: 94,
        materialRealism: 95,
        brandLegibility: 93,
        commercialImpact: 97,
      },
      headlineNote:
        "Silhouette, proportions, and specular rim reflections hold across the staged surface with billboard-grade polish.",
      thinkingSummary:
        "Verified hero contour against original RGBA plate; contact shadow direction aligns with key light temperature.",
      pins: [
        {
          id: "pin-1",
          x: 50,
          y: 34,
          category: "geometry",
          status: "pass",
          label: "Silhouette Lock",
          detail:
            "Primary contour and proportions match the studio reference plate cleanly.",
        },
        {
          id: "pin-2",
          x: 64,
          y: 52,
          category: "lighting",
          status: "pass",
          label: "Specular Rim Light",
          detail:
            "Edge highlight matches the directional kelvin temperature of the set.",
        },
        {
          id: "pin-3",
          x: 48,
          y: 78,
          category: "material",
          status: "pass",
          label: "Contact Shadow",
          detail:
            "Grounded ambient occlusion anchors the product realistically onto the plinth.",
        },
        {
          id: "pin-4",
          x: 24,
          y: 26,
          category: "composition",
          status: "pass",
          label: "Headline Negative Space",
          detail:
            "Clean upper-left visual breathing room leaves space for localized campaign copy.",
        },
      ],
      model: `${modelId} (stub)`,
      latencyMs: 210,
      costUsd: 0.0029,
      reasoningTokens: 168,
    };
  }

  const gw = getGateway();
  const started = Date.now();
  const contextLine = market
    ? `Target Market: ${market.city} (${market.label}, ${market.kelvin}K, ${market.surface}).`
    : `Target Market: ${input.marketId}.`;

  const result = await generateText({
    model: gw(modelId),
    instructions: AUDIT_SYSTEM_INSTRUCTIONS,
    output: Output.object({ schema: auditSchema }),
    providerOptions: {
      google: {
        thinkingConfig: {
          thinkingLevel: "medium",
        },
      },
    },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Hero Product: ${input.product.name} (${input.product.category}). ${contextLine}${
              input.directionSummary ? ` Brief: ${input.directionSummary}` : ""
            }\n\nImage 1 is the original studio product plate. Image 2 is the staged campaign shot. Evaluate faithfully and return the structured brand integrity audit.`,
          },
          {
            type: "image",
            image: input.product.bytes,
            mediaType: input.product.mediaType,
          },
          {
            type: "image",
            image: input.stagedBytes,
            mediaType: input.stagedMediaType,
          },
        ],
      },
    ],
  });

  const latencyMs = Date.now() - started;
  const output = result.output;
  const reasoningTokens =
    result.usage?.outputTokenDetails?.reasoningTokens ?? 0;

  return {
    verdict: output.verdict,
    overallScore: Math.round(output.overallScore),
    scores: {
      geometryFidelity: Math.round(output.scores.geometryFidelity),
      lightingPhysics: Math.round(output.scores.lightingPhysics),
      materialRealism: Math.round(output.scores.materialRealism),
      brandLegibility: Math.round(output.scores.brandLegibility),
      commercialImpact: Math.round(output.scores.commercialImpact),
    },
    headlineNote: output.headlineNote,
    thinkingSummary: output.thinkingSummary,
    pins: output.pins.slice(0, 4).map((p, idx) => ({
      ...p,
      id: p.id || `pin-${idx + 1}`,
      x: Math.max(8, Math.min(92, Math.round(p.x))),
      y: Math.max(8, Math.min(92, Math.round(p.y))),
    })),
    model: modelId,
    latencyMs,
    costUsd: extractGatewayCost(result.providerMetadata, 0.0034),
    reasoningTokens,
  };
}
