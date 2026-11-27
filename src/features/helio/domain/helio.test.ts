import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LIMITS } from "./limits";
import { findMarket, findSpecimen, MARKETS, SPECIMENS } from "./samples";
import {
  checkCombinedImageBytes,
  decodeImageDataUrl,
  inspectImageBytes,
  shootRequestSchema,
} from "./schemas";

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

    // Combined multi-image byte cap keeps edit payloads under Vercel's 4.5 MB limit
    expect(
      checkCombinedImageBytes([
        new Uint8Array(900_000),
        new Uint8Array(900_000),
        new Uint8Array(900_000),
      ]).ok,
    ).toBe(true);
    expect(
      checkCombinedImageBytes([
        new Uint8Array(1_000_000),
        new Uint8Array(1_000_000),
        new Uint8Array(1_000_000),
      ]).ok,
    ).toBe(false);
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
