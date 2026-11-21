/**
 * Records a real Walk of each Sample, so the page can replay it for free:
 * `public/floorwalk/samples/<slug>.walk.json` holds every event the route
 * streamed and the millisecond it arrived.
 *
 *   node --env-file=.env.local --experimental-strip-types scripts/record-floorwalk-walks.mts [slug] [--base http://localhost:3000]
 *
 * It calls the running app's own route with the e2e bypass token (the real
 * model, not the scripted Walker), so it spends money: about three cents a
 * Sample. Run it after re-rendering the footage.
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const args = process.argv.slice(2);
const base = args.includes("--base")
  ? args[args.indexOf("--base") + 1]
  : "http://localhost:3000";
const only = args.find(
  (a, i) => !a.startsWith("--") && args[i - 1] !== "--base",
);
const token = process.env.E2E_BYPASS_TOKEN;
if (!token)
  throw new Error(
    "Set E2E_BYPASS_TOKEN (the recorder calls the route as the e2e Owner).",
  );

const slugs = only ? [only] : ["cold-store", "grocer"];
for (const slug of slugs) {
  const started = Date.now();
  const response = await fetch(`${base}/api/floorwalk/walks`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-e2e-token": token },
    body: JSON.stringify({ source: { kind: "sample", slug } }),
  });
  if (!response.ok || !response.body)
    throw new Error(`${slug}: ${response.status} ${await response.text()}`);
  const events: { ms: number; event: { t: string; model?: string } }[] = [];
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      events.push({ ms: Date.now() - started, event });
      if (event.t !== "raw")
        console.log(slug, Date.now() - started, line.slice(0, 220));
    }
  }
  const model =
    events.find((e) => e.event.t === "start")?.event.model ?? "unknown";
  if (events.some((e) => e.event.t === "error"))
    throw new Error(`${slug}: the Walk ended in an error; not saved.`);
  await writeFile(
    join(
      import.meta.dirname,
      "..",
      "public/floorwalk/samples",
      `${slug}.walk.json`,
    ),
    `${JSON.stringify({ slug, model, recordedAt: new Date().toISOString(), events })}\n`,
  );
  console.log(
    `${slug}: ${events.length} events in ${Math.round((Date.now() - started) / 1000)}s`,
  );
}
