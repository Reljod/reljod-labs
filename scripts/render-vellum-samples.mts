/**
 * Renders the Vellum sample screens in `fixtures/vellum/<slug>.html` to
 * `public/vellum/samples/<slug>.png` at their own CSS size and scale 1, and
 * to a ~320px wide JPEG thumbnail `<slug>.thumb.jpg`. Safe to re-run.
 *
 *   pnpm render:vellum-samples
 *
 * Uses Playwright's bundled Chromium. Set CHROMIUM_PATH to render with another
 * Chromium build, e.g. when the bundled one is not installed.
 */
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const FIXTURES_DIR = join(import.meta.dirname, "../fixtures/vellum");
const OUT_DIR = join(import.meta.dirname, "../public/vellum/samples");
const THUMB_WIDTH = 320;

// Keep in step with `src/features/vellum/domain/samples.ts`.
const SCREENS = [
  { slug: "rail-ticket", width: 390, height: 844 },
  { slug: "harbour-dashboard", width: 1280, height: 800 },
  { slug: "tidewater-card", width: 1280, height: 720 },
  { slug: "ferry-poster", width: 900, height: 1200 },
] as const;

await mkdir(OUT_DIR, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
try {
  for (const { slug, width, height } of SCREENS) {
    const url = pathToFileURL(join(FIXTURES_DIR, `${slug}.html`)).href;
    const viewport = { width, height };

    const full = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await full.newPage();
    await page.goto(url, { waitUntil: "load" });
    const png = join(OUT_DIR, `${slug}.png`);
    await page.screenshot({ path: png, type: "png" });
    await full.close();

    const small = await browser.newContext({
      viewport,
      deviceScaleFactor: THUMB_WIDTH / width,
    });
    const thumbPage = await small.newPage();
    await thumbPage.goto(url, { waitUntil: "load" });
    const thumb = join(OUT_DIR, `${slug}.thumb.jpg`);
    await thumbPage.screenshot({ path: thumb, type: "jpeg", quality: 82 });
    await small.close();

    console.log(
      `${slug}.png  ${(await stat(png)).size} bytes, ${slug}.thumb.jpg  ${(await stat(thumb)).size} bytes`,
    );
  }
} finally {
  await browser.close();
}
