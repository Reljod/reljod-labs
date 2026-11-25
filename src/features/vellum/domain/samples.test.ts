import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SAMPLES, sampleBySlug } from "./samples";

const PUBLIC_DIR = join(import.meta.dirname, "../../../../public");

/** Width and height from a PNG's IHDR chunk. */
function pngSize(path: string): { width: number; height: number } {
  const bytes = readFileSync(path);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("Vellum samples", () => {
  it("has unique slugs", () => {
    const slugs = SAMPLES.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it.each(SAMPLES)("$slug has its image and thumbnail under public/", (s) => {
    expect(existsSync(join(PUBLIC_DIR, s.src))).toBe(true);
    expect(existsSync(join(PUBLIC_DIR, s.thumb))).toBe(true);
  });

  it.each(SAMPLES)("$slug states the PNG's pixel size", (s) => {
    expect(pngSize(join(PUBLIC_DIR, s.src))).toEqual({
      width: s.width,
      height: s.height,
    });
  });

  it("finds a sample by slug", () => {
    expect(sampleBySlug("ferry-poster")?.title).toBe("Ferry Week poster");
    expect(sampleBySlug("nope")).toBeUndefined();
  });
});
