import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCampaignShootPrompt,
  buildDirectorPrompt,
  buildIsolateCutoutPrompt,
  buildSurgicalEditPrompt,
  buildSynthesizeProductPrompt,
} from "./brief";
import { LIMITS } from "./limits";
import {
  calculateRoi,
  findMarket,
  findSpecimen,
  MARKETS,
  SPECIMENS,
} from "./samples";
import {
  decodeImageDataUrl,
  inspectImageBytes,
  shootRequestSchema,
} from "./schemas";
import { analyzeRgbaPixels } from "./telemetry";

describe("helio specimens & markets", () => {
  it("registers unique specimens with valid default markets and real RGBA PNG plates", () => {
    const slugs = SPECIMENS.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(SPECIMENS.length);
    for (const specimen of SPECIMENS) {
      expect(findSpecimen(specimen.slug)).toBe(specimen);
      for (const marketId of specimen.defaultMarkets) {
        expect(findMarket(marketId)).toBeDefined();
      }
      const bytes = readFileSync(
        join(
          process.cwd(),
          "public",
          "helio",
          "samples",
          `${specimen.slug}.png`,
        ),
      );
      expect(bytes[0]).toBe(0x89);
      expect(bytes[1]).toBe(0x50);
      // PNG colorType 6 = truecolor with alpha (RGBA)
      expect(bytes[25]).toBe(6);
    }
  });

  it("computes CEO ROI savings and speed multiplier accurately", () => {
    const roi = calculateRoi({
      traditionalUsd: 68500,
      traditionalDays: 32,
      aiCostUsd: 0.033,
      aiSeconds: 15,
      frameCount: 3,
    });
    expect(roi.savingsUsd).toBeGreaterThan(68499);
    expect(roi.costReductionPct).toBeGreaterThan(99.9);
    expect(roi.speedMultiplier).toBeGreaterThan(100000);
    expect(roi.costPerFrameUsd).toBeCloseTo(0.011, 3);
  });
});

describe("helio magic-byte image validation & schemas", () => {
  it("accepts genuine PNG, JPEG, and WebP headers and rejects spoofed bytes", () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48,
    ]);
    expect(inspectImageBytes(png)).toEqual({
      ok: true,
      mediaType: "image/png",
    });

    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1,
    ]);
    expect(inspectImageBytes(jpeg)).toEqual({
      ok: true,
      mediaType: "image/jpeg",
    });

    const webp = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50,
    ]);
    expect(inspectImageBytes(webp)).toEqual({
      ok: true,
      mediaType: "image/webp",
    });

    const spoofedSvg = new TextEncoder().encode(
      "<svg><script>alert(1)</script></svg>",
    );
    const spoofedUrl = `data:image/png;base64,${Buffer.from(spoofedSvg).toString("base64")}`;
    expect(decodeImageDataUrl(spoofedUrl).ok).toBe(false);
  });

  it("enforces market cap and rejects duplicate or unknown markets", () => {
    const valid = shootRequestSchema.safeParse({
      product: { kind: "specimen", slug: "solis-kettle" },
      marketIds: ["tokyo", "milan", "manila"],
      tier: "flash",
    });
    expect(valid.success).toBe(true);

    const dup = shootRequestSchema.safeParse({
      product: { kind: "specimen", slug: "solis-kettle" },
      marketIds: ["tokyo", "tokyo"],
      tier: "flash",
    });
    expect(dup.success).toBe(false);

    const tooMany = shootRequestSchema.safeParse({
      product: { kind: "specimen", slug: "solis-kettle" },
      marketIds: MARKETS.slice(0, LIMITS.maxMarketsPerShoot + 1).map(
        (m) => m.id,
      ),
      tier: "flash",
    });
    expect(tooMany.success).toBe(false);
  });
});

describe("helio pure-code optical pixel telemetry", () => {
  it("measures transparency percentage, palette, histogram, and sharpness deterministically", () => {
    const w = 16;
    const h = 16;
    const data = new Uint8ClampedArray(w * h * 4);
    // Top half transparent, bottom half crisp vertical stripes (navy & brass)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const off = (y * w + x) * 4;
        if (y < h / 2) {
          data[off + 3] = 0;
        } else if (Math.floor(x / 2) % 2 === 0) {
          data[off] = 20;
          data[off + 1] = 33;
          data[off + 2] = 61;
          data[off + 3] = 255;
        } else {
          data[off] = 217;
          data[off + 1] = 168;
          data[off + 2] = 78;
          data[off + 3] = 255;
        }
      }
    }

    const telemetry = analyzeRgbaPixels({
      data,
      width: w,
      height: h,
      sourceWidth: 1024,
      sourceHeight: 1024,
    });
    expect(telemetry.transparentPct).toBe(50);
    expect(telemetry.histogram).toHaveLength(16);
    expect(telemetry.palette.length).toBeGreaterThanOrEqual(2);
    expect(telemetry.sharpnessIndex).toBeGreaterThan(20);
    expect(telemetry.contrastIndex).toBeGreaterThan(20);
    expect(telemetry.printReady).toBe(true);
  });
});

describe("helio prompt builders", () => {
  it("incorporates product dossier, markets, and mood reference clauses safely", () => {
    const dir = buildDirectorPrompt({
      productName: "Solis Kettle",
      productCategory: "Appliances",
      materialNotes: "Matte terracotta",
      markets: [MARKETS[0], MARKETS[1]],
      customBrief: "Warm autumn glow",
      hasMoodReference: true,
    });
    expect(dir).toContain("Solis Kettle");
    expect(dir).toContain('marketId="tokyo"');
    expect(dir).toContain("Warm autumn glow");
    expect(dir).toContain("MOOD REFERENCE");

    expect(buildIsolateCutoutPrompt("Kettle")).toContain("transparent alpha");
    expect(buildSynthesizeProductPrompt("Brass lamp")).toContain("Brass lamp");
    expect(
      buildCampaignShootPrompt({
        productName: "Solis Kettle",
        market: MARKETS[0],
        hasMoodReference: true,
      }),
    ).toContain("second reference mood image");
    expect(
      buildSurgicalEditPrompt({
        productName: "Solis Kettle",
        market: MARKETS[0],
        instruction: "Add warm steam",
        hasExtraReference: true,
      }),
    ).toContain("Reference 3");
  });
});
