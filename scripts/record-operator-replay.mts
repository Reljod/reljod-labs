/**
 * Records a finished Run as the Replay of its sample Task: the Run with its
 * Trail goes to `public/operator/replays/<taskId>/run.json`, and each Frame
 * to `frames/<n>.webp` (re-encoded from the stored PNG in a headless browser,
 * about a quarter of the size). The page shows it before a visitor spends
 * anything.
 *
 *   pnpm record:operator-replay <runId> [baseUrl]
 *
 * Needs the app running at baseUrl (default http://localhost:3112) and
 * E2E_BYPASS_TOKEN, and a Run owned by the `e2e` Owner. Record only Runs of
 * sample Tasks: everything in one is synthetic (Meridia, SPECIMEN).
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const [runId, base = "http://localhost:3112"] = process.argv.slice(2);
if (!runId) throw new Error("usage: record-operator-replay <runId> [baseUrl]");
const headers = { "x-e2e-token": process.env.E2E_BYPASS_TOKEN ?? "" };

const response = await fetch(`${base}/api/operator/runs/${runId}`, { headers });
if (!response.ok) throw new Error(`run ${runId}: ${response.status}`);
const run = await response.json();
if (!run.taskId) throw new Error("only a Run of a sample Task can be a Replay");
if (run.status !== "completed" || run.verdict !== "correct")
  throw new Error(`not a good Run: ${run.status}, ${run.verdict}`);

const dir = new URL(`../public/operator/replays/${run.taskId}/`, import.meta.url);
rmSync(dir, { recursive: true, force: true });
mkdirSync(new URL("frames/", dir), { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("about:blank");
let bytes = 0;
const frames = run.events.filter((event: { type: string }) => event.type === "frame");
for (const frame of frames) {
  const png = await fetch(`${base}/api/operator/runs/${runId}/frames/${frame.n}`, {
    headers,
  });
  if (!png.ok) throw new Error(`frame ${frame.n}: ${png.status}`);
  const data = Buffer.from(await png.arrayBuffer()).toString("base64");
  const webp: string = await page.evaluate(async (source) => {
    const image = new Image();
    image.src = `data:image/png;base64,${source}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext("2d")?.drawImage(image, 0, 0);
    return canvas.toDataURL("image/webp", 0.82).split(",")[1];
  }, data);
  const out = Buffer.from(webp, "base64");
  bytes += out.byteLength;
  writeFileSync(new URL(`frames/${frame.n}.webp`, dir), out);
}
await browser.close();

writeFileSync(
  new URL("run.json", dir),
  `${JSON.stringify({ ...run, id: `replay-${run.taskId}`, replay: true, pending: null })}\n`,
);
console.log(
  `recorded ${run.taskId}: ${frames.length} frames, ${(bytes / 1024).toFixed(0)} KB`,
);
