#!/usr/bin/env node
/**
 * Renders the synthetic casework Cabinet from its sources.
 *
 *   node fixtures/casework/render.mjs                 # every case
 *   node fixtures/casework/render.mjs --only <slug>   # one case (repeatable)
 *   node fixtures/casework/render.mjs --check         # validate case.json files only
 *
 * Each case lives in `cases/<scenario>/<slug>/` with a `case.json` and one source
 * per Document. Output goes to `out/<scenario>/<slug>/`, plus `out/manifest.json`:
 *
 *   render "pdf"   -> born-digital PDF with a text layer, and a JPEG per page
 *   render "scan"  -> image-only PDF of a grey, slightly skewed scan, and a JPEG per page
 *   render "photo" -> a phone photo of the first page as a JPEG (the Document is the JPEG)
 *   render "csv"   -> the CSV copied as is (no page images)
 */
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = dirname(fileURLToPath(import.meta.url));
const CASES = join(ROOT, "cases");
const OUT = join(ROOT, "out");
// Use the pre-installed browser when the project pins a newer Playwright.
const SYSTEM_CHROMIUM =
  process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";
const BASE_CSS = readFileSync(join(ROOT, "templates", "base.css"), "utf8");

const args = process.argv.slice(2);
const only = args.flatMap((arg, index) =>
  args[index - 1] === "--only" ? [arg] : [],
);
const checkOnly = args.includes("--check");

const KINDS = new Set(
  [
    ...readFileSync(
      resolve(ROOT, "../../src/features/casework/domain/document-kinds.ts"),
      "utf8",
    ).matchAll(/^ {2}([a-z_]+): \{$/gm),
  ].map((match) => match[1]),
);
const CHECKS = new Set(
  [
    ...readFileSync(
      resolve(ROOT, "../../src/features/casework/domain/checks.ts"),
      "utf8",
    ).matchAll(/^ {2}([a-z_]+): \{/gm),
  ].map((match) => match[1]),
);

function loadCases() {
  const cases = [];
  for (const scenario of readdirSync(CASES)) {
    const dir = join(CASES, scenario);
    for (const slug of readdirSync(dir)) {
      const file = join(dir, slug, "case.json");
      if (!existsSync(file)) continue;
      const data = JSON.parse(readFileSync(file, "utf8"));
      cases.push({ ...data, dir: join(dir, slug), folderScenario: scenario });
    }
  }
  return cases.sort((a, b) => a.slug.localeCompare(b.slug));
}

/** Light validation, so authors see mistakes before seeding does. */
function validate(item) {
  const problems = [];
  if (item.slug !== basename(item.dir)) problems.push("slug != folder name");
  if (item.scenario !== item.folderScenario)
    problems.push("scenario != folder");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(item.asOf ?? "")) problems.push("bad asOf");
  for (const document of item.documents ?? []) {
    if (!KINDS.has(document.kind))
      problems.push(`${document.name}: unknown kind ${document.kind}`);
    if (!existsSync(join(item.dir, document.source)))
      problems.push(`${document.name}: missing source ${document.source}`);
    const ext = extname(document.name).toLowerCase();
    const want = { pdf: ".pdf", scan: ".pdf", photo: ".jpg", csv: ".csv" }[
      document.render
    ];
    if (ext !== want)
      problems.push(`${document.name}: ${document.render} needs ${want}`);
  }
  for (const check of item.expected?.checks ?? []) {
    if (!CHECKS.has(check.id)) problems.push(`unknown check ${check.id}`);
  }
  for (const kind of item.expected?.missingKinds ?? []) {
    if (!KINDS.has(kind)) problems.push(`unknown missing kind ${kind}`);
  }
  return problems;
}

function inlineHtml(file) {
  return readFileSync(file, "utf8").replace(
    /<link[^>]+href="[^"]*base\.css"[^>]*>/,
    `<style>${BASE_CSS}</style>`,
  );
}

const NOISE = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0.55 0"/></filter><rect width="300" height="300" filter="url(#n)"/></svg>`,
)}`;

/** A seeded number in [0, 1), so renders are repeatable. */
function seeded(seed) {
  const hash = createHash("sha256").update(seed).digest();
  return hash.readUInt32BE(0) / 2 ** 32;
}

async function pageShots(page, scale) {
  const sections = await page.$$(".page");
  const shots = [];
  for (const section of sections) {
    shots.push(
      await section.screenshot({
        type: "png",
        scale: scale ? "device" : "css",
      }),
    );
  }
  return shots;
}

async function effect(browser, png, kind, seed) {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const src = `data:image/png;base64,${png.toString("base64")}`;
  await page.setContent(`<img id="i" src="${src}">`);
  const { width, height } = await page.$eval("#i", (img) => ({
    width: img.naturalWidth,
    height: img.naturalHeight,
  }));
  const r = seeded(seed);
  let html;
  if (kind === "scan") {
    const tilt = (r - 0.5) * 1.6;
    html = `<body style="margin:0"><div id="s" style="width:${width}px;height:${height}px;position:relative;overflow:hidden;background:#f2f0ea">
      <img src="${src}" style="position:absolute;left:${Math.round(r * 10)}px;top:${Math.round(r * 8)}px;width:${width}px;transform:rotate(${tilt}deg);filter:grayscale(1) contrast(1.25) brightness(1.04) blur(0.4px)">
      <div style="position:absolute;inset:0;background:url('${NOISE}');opacity:.16;mix-blend-mode:multiply"></div>
      <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:700 ${Math.round(width / 7)}px/1 'Liberation Sans',sans-serif;letter-spacing:.12em;color:rgba(60,60,60,.16);transform:rotate(-32deg);pointer-events:none">SPECIMEN</div>
      <div style="position:absolute;left:0;top:0;bottom:0;width:${Math.round(width * 0.012)}px;background:linear-gradient(90deg,rgba(0,0,0,.25),transparent)"></div>
    </div></body>`;
  } else {
    const w = Math.round(width * 1.25);
    const h = Math.round(height * 1.3);
    const tilt = (r - 0.5) * 7;
    html = `<body style="margin:0"><div id="s" style="width:${w}px;height:${h}px;position:relative;overflow:hidden;background:radial-gradient(circle at ${30 + r * 40}% 30%, #8a6a4c, #4a3424 75%);display:flex;align-items:center;justify-content:center;perspective:1400px">
      <img src="${src}" style="width:${width}px;transform:rotateX(${4 + r * 6}deg) rotateZ(${tilt}deg) scale(.92);box-shadow:0 18px 40px rgba(0,0,0,.45);filter:saturate(.9) contrast(1.05) blur(0.5px)">
      <div style="position:absolute;inset:0;background:radial-gradient(circle at ${20 + r * 50}% 20%, rgba(255,250,235,.28), transparent 55%), linear-gradient(180deg, transparent 60%, rgba(0,0,0,.18))"></div>
      <div style="position:absolute;inset:0;background:url('${NOISE}');opacity:.1;mix-blend-mode:multiply"></div>
    </div></body>`;
  }
  await page.setContent(html);
  await page.waitForLoadState("load");
  const out = await (await page.$("#s")).screenshot({
    type: "jpeg",
    quality: 80,
  });
  await page.close();
  return out;
}

async function imagePdf(browser, jpegs, sizes) {
  const page = await browser.newPage();
  const body = jpegs
    .map(
      (jpeg, index) =>
        `<div style="width:${sizes[index].width}in;height:${sizes[index].height}in;page-break-after:always;overflow:hidden"><img style="width:100%;height:100%;object-fit:cover" src="data:image/jpeg;base64,${jpeg.toString("base64")}"></div>`,
    )
    .join("");
  await page.setContent(
    `<html><head><style>@page{size:${sizes[0].width}in ${sizes[0].height}in;margin:0}body{margin:0}</style></head><body>${body}</body></html>`,
  );
  await page.waitForLoadState("load");
  const pdf = await page.pdf({
    preferCSSPageSize: true,
    printBackground: true,
  });
  await page.close();
  return pdf;
}

async function renderDocument(browser, item, document, outDir) {
  const source = join(item.dir, document.source);
  const stem = document.name.replace(/\.[^.]+$/, "");
  const target = join(outDir, document.name);
  if (document.render === "csv") {
    copyFileSync(source, target);
    return {
      file: document.name,
      mediaType: "text/csv",
      sourceFormat: "csv",
      pages: [],
    };
  }
  const page = await browser.newPage({ deviceScaleFactor: 1.5 });
  await page.setContent(inlineHtml(source), { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  const shots = await pageShots(page, true);
  if (shots.length === 0)
    throw new Error(`${source}: no <section class="page">`);
  const sizes = await page.$$eval(".page", (sections) =>
    sections.map((section) => ({
      width: section.offsetWidth / 96,
      height: section.offsetHeight / 96,
    })),
  );
  const pages = [];
  if (document.render === "pdf") {
    writeFileSync(
      target,
      await page.pdf({ preferCSSPageSize: true, printBackground: true }),
    );
    for (const [index, section] of (await page.$$(".page")).entries()) {
      const jpeg = await section.screenshot({ type: "jpeg", quality: 82 });
      const name = `${stem}.page-${index + 1}.jpg`;
      writeFileSync(join(outDir, name), jpeg);
      pages.push(name);
    }
  } else if (document.render === "scan") {
    const jpegs = [];
    for (const [index, shot] of shots.entries()) {
      const jpeg = await effect(
        browser,
        shot,
        "scan",
        `${item.slug}/${document.name}/${index}`,
      );
      jpegs.push(jpeg);
      const name = `${stem}.page-${index + 1}.jpg`;
      writeFileSync(join(outDir, name), jpeg);
      pages.push(name);
    }
    writeFileSync(target, await imagePdf(browser, jpegs, sizes));
  } else {
    const jpeg = await effect(
      browser,
      shots[0],
      "photo",
      `${item.slug}/${document.name}`,
    );
    writeFileSync(target, jpeg);
    pages.push(document.name);
  }
  await page.close();
  return {
    file: document.name,
    mediaType: document.render === "photo" ? "image/jpeg" : "application/pdf",
    sourceFormat:
      document.render === "pdf"
        ? "pdf_digital"
        : document.render === "scan"
          ? "pdf_scanned"
          : "image",
    pages,
  };
}

async function main() {
  const cases = loadCases().filter(
    (item) => only.length === 0 || only.includes(item.slug),
  );
  let failed = false;
  for (const item of cases) {
    const problems = validate(item);
    if (problems.length > 0) {
      failed = true;
      console.error(`✗ ${item.slug}\n  ${problems.join("\n  ")}`);
    }
  }
  if (checkOnly || failed) {
    console.log(
      `${cases.length} cases, ${cases.reduce((n, c) => n + c.documents.length, 0)} documents`,
    );
    process.exit(failed ? 1 : 0);
  }

  const browser = await chromium.launch(
    existsSync(SYSTEM_CHROMIUM) ? { executablePath: SYSTEM_CHROMIUM } : {},
  );
  const manifestPath = join(OUT, "manifest.json");
  const manifest =
    only.length > 0 && existsSync(manifestPath)
      ? JSON.parse(readFileSync(manifestPath, "utf8"))
      : { cases: [] };
  for (const item of cases) {
    const outDir = join(OUT, item.scenario, item.slug);
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    const documents = [];
    for (const document of item.documents) {
      const rendered = await renderDocument(browser, item, document, outDir);
      documents.push({ ...document, ...rendered });
    }
    const { dir, folderScenario, ...data } = item;
    manifest.cases = manifest.cases.filter((entry) => entry.slug !== item.slug);
    manifest.cases.push({ ...data, documents });
    console.log(`✓ ${item.scenario}/${item.slug} (${documents.length})`);
  }
  await browser.close();
  manifest.cases.sort((a, b) => a.slug.localeCompare(b.slug));
  mkdirSync(OUT, { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
