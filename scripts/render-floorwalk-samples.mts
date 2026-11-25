/**
 * Renders Floorwalk's Sample footage and its answer key.
 *
 *   pnpm render:floorwalk-samples                  # every Site
 *   pnpm render:floorwalk-samples --only grocer
 *   pnpm render:floorwalk-samples --only grocer --at 12.5   # one still, to look at
 *
 * For each Site in `src/features/floorwalk/domain/sites.ts` it opens
 * `fixtures/floorwalk/scene.html` (Three.js, fetched from jsDelivr at render
 * time) in headless Chromium, renders every frame from the Site's route, and
 * encodes them with ffmpeg into `public/floorwalk/samples/<slug>.mp4`, plus a
 * poster. Each frame also reports where every planted prop is on screen, and
 * that becomes `src/features/floorwalk/domain/answer-key.generated.json`: when
 * each planted problem (and each decoy) is in view and its box at its
 * clearest moment. A Walk of a Sample is measured against it.
 *
 * Needs ffmpeg on PATH and Playwright's Chromium (`pnpm exec playwright install chromium`).
 */
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";
// @ts-expect-error TS5097: Node runs this file as is, so the import names the `.ts` file.
import { SITES } from "../src/features/floorwalk/domain/sites.ts";

const run = promisify(execFile);
const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "public/floorwalk/samples");
const KEY = join(
  ROOT,
  "src/features/floorwalk/domain/answer-key.generated.json",
);
const CACHE = join(ROOT, "node_modules/.cache/floorwalk");
const FPS = 24;
const MAX_BYTES = 6 * 1024 * 1024;

type ScreenBox = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  seen: number;
};
type KeyEntry = {
  id: string;
  rule: string;
  decoy: boolean;
  note: string;
  /** Seconds the problem is in view; merged when the gap is under half a second. */
  spans: [number, number][];
  /** Its clearest frame: the largest box. */
  best: {
    at: number;
    box: [top: number, left: number, bottom: number, right: number];
  } | null;
};

const args = process.argv.slice(2);
const only = args.includes("--only")
  ? args[args.indexOf("--only") + 1]
  : undefined;
const still = args.includes("--at")
  ? Number(args[args.indexOf("--at") + 1])
  : undefined;

const browser = await chromium.launch({
  args: [
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
  ],
});
const key: Record<string, { seconds: number; fps: number; items: KeyEntry[] }> =
  JSON.parse(await readFile(KEY, "utf8").catch(() => "{}"));
await mkdir(OUT, { recursive: true });

for (const site of SITES) {
  if (only && site.slug !== only) continue;
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
  });
  page.on(
    "console",
    (m) => m.type() === "error" && console.error("[page]", m.text()),
  );
  page.on("pageerror", (e) => console.error("[page]", e.message));
  await page.goto(
    pathToFileURL(join(ROOT, "fixtures/floorwalk/scene.html")).href,
  );
  await page.waitForFunction(
    () => (window as unknown as { ready?: boolean }).ready === true,
    null,
    { timeout: 60_000 },
  );
  const marks = await page.evaluate(
    (s) => (window as unknown as { setup: (s: unknown) => string[] }).setup(s),
    site as unknown,
  );
  for (const planted of site.planted)
    for (const prop of planted.props)
      if (!marks.includes(prop))
        throw new Error(`${site.slug}: prop ${prop} was not built`);

  const seconds = site.route[site.route.length - 1]?.[2] ?? 0;
  if (still !== undefined) {
    const truth = await page.evaluate(
      (t) =>
        (window as unknown as { renderAt: (t: number) => unknown }).renderAt(t),
      still,
    );
    const file = join(CACHE, `${site.slug}-${still}.jpg`);
    await mkdir(CACHE, { recursive: true });
    await page
      .locator("#wrap")
      .screenshot({ path: file, type: "jpeg", quality: 90 });
    console.log(file, JSON.stringify(truth));
    await page.close();
    continue;
  }

  const frames = join(CACHE, site.slug);
  await rm(frames, { recursive: true, force: true });
  await mkdir(frames, { recursive: true });
  const total = Math.round(seconds * FPS);
  const seen: Record<string, { t: number; box: ScreenBox }[]> = {};
  const started = Date.now();
  for (let i = 0; i < total; i++) {
    const t = i / FPS;
    const truth = await page.evaluate(
      (tt) =>
        (
          window as unknown as {
            renderAt: (t: number) => Record<string, ScreenBox>;
          }
        ).renderAt(tt),
      t,
    );
    for (const [id, box] of Object.entries(truth))
      seen[id] = [...(seen[id] ?? []), { t, box }];
    await page.locator("#wrap").screenshot({
      path: join(frames, `${String(i).padStart(5, "0")}.jpg`),
      type: "jpeg",
      quality: 88,
    });
    if (i % 48 === 0)
      console.log(
        `${site.slug} ${i}/${total} (${Math.round((Date.now() - started) / 1000)}s)`,
      );
  }
  await page.close();

  const mp4 = join(OUT, `${site.slug}.mp4`);
  for (const crf of [27, 30, 33]) {
    await run("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-framerate",
      String(FPS),
      "-i",
      join(frames, "%05d.jpg"),
      "-c:v",
      "libx264",
      "-preset",
      "slow",
      "-crf",
      String(crf),
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      mp4,
    ]);
    if ((await stat(mp4)).size <= MAX_BYTES) break;
  }
  const mid = String(Math.round(total * 0.3)).padStart(5, "0");
  await run("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-i",
    join(frames, `${mid}.jpg`),
    "-vf",
    "scale=640:-2",
    "-q:v",
    "5",
    join(OUT, `${site.slug}.jpg`),
  ]);

  key[site.slug] = {
    seconds,
    fps: FPS,
    items: site.planted.map((planted) => {
      const byTime = new Map<number, ScreenBox[]>();
      for (const prop of planted.props)
        for (const s of seen[prop] ?? [])
          byTime.set(s.t, [...(byTime.get(s.t) ?? []), s.box]);
      const times = [...byTime.keys()].sort((a, b) => a - b);
      const spans: [number, number][] = [];
      for (const t of times) {
        const last = spans[spans.length - 1];
        if (last && t - last[1] < 0.5) last[1] = t;
        else spans.push([t, t]);
      }
      let best: KeyEntry["best"] = null,
        area = 0;
      for (const [t, boxes] of byTime) {
        const u = {
          left: Math.min(...boxes.map((b) => b.left)),
          right: Math.max(...boxes.map((b) => b.right)),
          top: Math.min(...boxes.map((b) => b.top)),
          bottom: Math.max(...boxes.map((b) => b.bottom)),
        };
        const a = (u.right - u.left) * (u.bottom - u.top);
        if (a > area) {
          area = a;
          best = {
            at: round(t),
            box: [round(u.top), round(u.left), round(u.bottom), round(u.right)],
          };
        }
      }
      return {
        id: planted.id,
        rule: planted.rule,
        decoy: Boolean(planted.decoy),
        note: planted.note,
        spans: spans
          .filter(([a, b]) => b - a >= 0.4)
          .map(([a, b]) => [round(a), round(b)] as [number, number]),
        best,
      };
    }),
  };
  console.log(
    site.slug,
    `${((await stat(mp4)).size / 1024 / 1024).toFixed(2)} MB`,
    JSON.stringify(key[site.slug].items.map((i) => [i.id, i.spans])),
  );
}
await browser.close();
if (still === undefined)
  await writeFile(KEY, `${JSON.stringify(key, null, 2)}\n`);

function round(n: number) {
  return Math.round(n * 1000) / 1000;
}
