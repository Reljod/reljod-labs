/**
 * Prints the synthetic Client Manager documents in
 * `fixtures/client-manager/<client>/*.html` to A4 PDFs under
 * `public/client-manager/samples/<client>/`, and copies the spreadsheets
 * (`*.xlsx`) alongside them. Safe to re-run.
 *
 *   pnpm render:client-manager-samples
 *
 * Uses Playwright's bundled Chromium. Set CHROMIUM_PATH to print with another
 * Chromium build, e.g. when the bundled one is not installed.
 */
import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const FIXTURES_DIR = join(import.meta.dirname, "../fixtures/client-manager");
const OUT_DIR = join(import.meta.dirname, "../public/client-manager/samples");

const clients = (await readdir(FIXTURES_DIR, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
try {
  const page = await browser.newPage();
  for (const client of clients) {
    const sourceDir = join(FIXTURES_DIR, client);
    const targetDir = join(OUT_DIR, client);
    await mkdir(targetDir, { recursive: true });

    for (const file of (await readdir(sourceDir)).sort()) {
      const source = join(sourceDir, file);
      const extension = extname(file);
      if (extension === ".html") {
        const target = join(targetDir, `${basename(file, ".html")}.pdf`);
        await page.goto(pathToFileURL(source).href, { waitUntil: "load" });
        await page.pdf({
          path: target,
          format: "A4",
          printBackground: true,
          preferCSSPageSize: true,
        });
        console.log(
          `${client}/${basename(target)}  ${(await stat(target)).size} bytes`,
        );
      } else if (extension === ".xlsx") {
        const target = join(targetDir, file);
        await copyFile(source, target);
        console.log(`${client}/${file}  ${(await stat(target)).size} bytes`);
      }
    }
  }
} finally {
  await browser.close();
}
