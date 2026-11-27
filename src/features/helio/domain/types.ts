/** Every path the browser calls; each is a gated POST (`src/app/api/helio/`). */
export const ROUTES = {
  extract: "/api/helio/extract",
  shoot: "/api/helio/shoot",
  edit: "/api/helio/edit",
  audit: "/api/helio/audit",
  compare: "/api/helio/compare",
} as const;

/** One image an image model made (a plate, an edit), as the routes answer it. */
export type RenderedFrame = {
  imageDataUrl: string;
  model: string;
  latencyMs: number;
  costUsd: number;
};

export type HelioTab = "studio" | "placements" | "compare" | "hood";

export type HelioModelTier = "flash" | "flagship";

export type BackdropMode = "alpha" | "obsidian" | "marble";

export type HelioSpecimen = {
  slug: string;
  code: string;
  name: string;
  brand: string;
  category: string;
  priceTag: string;
  tagline: string;
  /** Material & lighting notes handed to Gemini 4 Neon and MAI Image 2.7. */
  materialNotes: string;
  /** Public static path to the transparent RGBA PNG plate. */
  imageUrl: string;
  /** Curated accent hex pulled from the product's signature finish. */
  accentHex: string;
  /** Default 3 markets highlighted for this product. */
  defaultMarkets: [string, string, string];
  /** Traditional multi-market location shoot benchmark for CEO ROI comparison. */
  traditionalShootUsd: number;
  traditionalLeadDays: number;
  traditionalCrewCount: number;
};

export type HelioMarket = {
  id: string;
  city: string;
  country: string;
  label: string;
  language: string;
  kelvin: number;
  lens: string;
  surface: string;
  mood: string;
  /** Visual swatch color used on the light table and contact sheet. */
  swatchHex: string;
  /** Default localized tagline badge shown if Neon hasn't overridden it yet. */
  defaultHeadline: string;
  defaultSubcopy: string;
  /** Base scene prompt fused with the product reference image. */
  scenePrompt: string;
};

export type DirectorPreset = {
  id: string;
  label: string;
  shortTag: string;
  kelvinLabel: string;
  instruction: string;
};

export type MarketDirection = {
  marketId: string;
  headline: string;
  subcopy: string;
  localizedBadge: string;
  cameraSpec: string;
  lightingSpec: string;
  materialPhysics: string;
  maiPrompt: string;
};

export type ArtDirectionBrief = {
  campaignTitle: string;
  executiveSummary: string;
  thinkingSummary: string;
  markets: MarketDirection[];
  model: string;
  latencyMs: number;
  costUsd: number;
  reasoningTokens: number;
};

export type BrandAuditPin = {
  id: string;
  /** Horizontal position across image, 6..94 (%). */
  x: number;
  /** Vertical position across image, 6..94 (%). */
  y: number;
  category: "geometry" | "lighting" | "material" | "typography" | "composition";
  status: "pass" | "note";
  label: string;
  detail: string;
};

export type BrandAuditResult = {
  verdict: "APPROVED" | "REVISION_ADVISED";
  overallScore: number;
  scores: {
    geometryFidelity: number;
    lightingPhysics: number;
    materialRealism: number;
    brandLegibility: number;
    commercialImpact: number;
  };
  headlineNote: string;
  thinkingSummary: string;
  pins: BrandAuditPin[];
  model: string;
  latencyMs: number;
  costUsd: number;
  reasoningTokens: number;
};

export type OpticalTelemetry = {
  width: number;
  height: number;
  /** Percentage of pixels with alpha < 245 (0..100). */
  transparentPct: number;
  /** Dominant 5 hex swatches sampled directly from pixels. */
  palette: string[];
  /** 16 normalized luminance histogram bins (0..1). */
  histogram: number[];
  /** Average luminance 0..255. */
  meanLuminance: number;
  /** RMS luminance contrast 0..100. */
  contrastIndex: number;
  /** Sobel edge sharpness score 0..100. */
  sharpnessIndex: number;
  /** Percentage of clipped highlights (L > 250). */
  highlightClipPct: number;
  /** Whether the frame meets 1024px+ digital/social print readiness. */
  printReady: boolean;
};

export type FrameVersion = {
  id: string;
  label: string;
  imageDataUrl: string;
  model: string;
  tier: HelioModelTier;
  latencyMs: number;
  costUsd: number;
  instruction: string;
  createdAt: number;
  audit?: BrandAuditResult;
};

export type CampaignFrame = {
  marketId: string;
  status: "idle" | "directing" | "developing" | "ready" | "error";
  error?: string;
  direction?: MarketDirection;
  versions: FrameVersion[];
  activeVersionIndex: number;
};

export type TelemetryLedgerEntry = {
  id: string;
  timestamp: number;
  operation:
    | "extract-rgba"
    | "synthesize-rgba"
    | "art-direction"
    | "campaign-shoot"
    | "surgical-edit"
    | "brand-audit"
    | "tier-compare";
  model: string;
  label: string;
  latencyMs: number;
  costUsd: number;
  meta: string;
};

export type ShootStreamEvent =
  | {
      type: "phase";
      phase: "directing" | "shooting";
      message: string;
    }
  | {
      type: "direction";
      brief: ArtDirectionBrief;
    }
  | {
      type: "frame-start";
      marketId: string;
      model: string;
    }
  | {
      type: "frame-ready";
      marketId: string;
      version: FrameVersion;
    }
  | {
      type: "frame-error";
      marketId: string;
      error: string;
    }
  | {
      type: "done";
      totalLatencyMs: number;
      totalCostUsd: number;
    };

export type CompareStreamEvent =
  | {
      type: "start";
      flashModel: string;
      flagshipModel: string;
    }
  | {
      type: "result";
      tier: HelioModelTier;
      model: string;
      imageDataUrl: string;
      latencyMs: number;
      costUsd: number;
    }
  | {
      type: "error";
      tier: HelioModelTier;
      error: string;
    }
  | {
      type: "done";
    };
