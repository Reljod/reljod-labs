/**
 * Renders the sample Recordings for the Process transfer demo: mock screen-share
 * calls in which a presenter hands a back-office process over to a colleague.
 *
 *   pnpm render:process-transfer-samples                 # all of them
 *   pnpm render:process-transfer-samples --only wire-recall
 *   pnpm render:process-transfer-samples --only wire-recall --keep-video  # reuse the last silent render
 *
 * Each `fixtures/process-transfer/recordings/<slug>.mjs` is one call: the
 * shared screen, the actions on it and the dialogue. This script
 *   1. speaks every line with the local Kokoro-82M voice model (`hyperframes tts`),
 *   2. lays the actions out against the speech, mixes the dialogue and measures
 *      each speaker's level for the participant tiles,
 *   3. fills `fixtures/process-transfer/template/call.html` (a HyperFrames
 *      composition) and renders it to video with `hyperframes render`,
 *   4. muxes video and dialogue with ffmpeg into
 *      `public/process-transfer/samples/<slug>.mp4` plus a `<slug>.jpg` poster,
 *   5. writes the ground truth to `fixtures/process-transfer/expected/<slug>.json`.
 *
 * Needs Node, ffmpeg/ffprobe on PATH, npx (HyperFrames is fetched on demand) and
 * a Python with `kokoro-onnx` and `soundfile` for the voices. See
 * `fixtures/process-transfer/README.md` for the one-time setup.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

const ROOT = join(import.meta.dirname, "..");
const FIXTURES = join(ROOT, "fixtures/process-transfer");
const OUT_DIR = join(ROOT, "public/process-transfer/samples");
const CACHE = join(ROOT, "node_modules/.cache/process-transfer");
const HYPERFRAMES = "hyperframes@0.9.61";
const FPS = 15;
const SAMPLE_RATE = 24000;
const MAX_BYTES = 3.5 * 1024 * 1024;
const POSTER_MAX_BYTES = 60 * 1024;

const env = {
  ...process.env,
  HYPERFRAMES_CACHE_DIR:
    process.env.HYPERFRAMES_CACHE_DIR ??
    join(homedir(), ".local/share/hyperframes-cache"),
  HYPERFRAMES_PYTHON:
    process.env.HYPERFRAMES_PYTHON ??
    join(homedir(), ".cache/process-transfer-tts/bin/python"),
};

// ---------- recording scripts ----------

type Speaker = "P" | "R";
type Person = {
  name: string;
  role: string;
  initials: string;
  color: string;
  voice: string;
  speed?: number;
};
type Op = Record<string, unknown>;
type Line = {
  s: Speaker;
  text: string;
  step?: string | { title: string; actor?: string; system?: string };
  act?: Op[];
  /** Seconds after the line starts that its actions begin. */
  at?: number;
  /** Silence after the line. */
  gap?: number;
  /** Let the next line start while this line's actions still run. */
  nowait?: boolean;
};
type Recording = {
  slug: string;
  title: string;
  callTitle: string;
  callSub: string;
  agenda: string;
  timerOffset?: number;
  system: string;
  presenter: Person;
  receiver: Person;
  ui: Record<string, unknown>;
  lines: Line[];
  decisions: string[];
  warnings: string[];
  openQuestions: string[];
};

type TimedEvent = { t: number; type: string } & Record<string, unknown>;
type Toast = {
  t: number;
  dur: number;
  tone?: string;
  title: string;
  text?: string;
};

// ---------- speech ----------

async function speak(text: string, person: Person): Promise<string> {
  const speed = person.speed ?? 1.05;
  const key = createHash("sha256")
    .update(`${person.voice}|${speed}|${text}`)
    .digest("hex")
    .slice(0, 16);
  const file = join(CACHE, "tts", `${key}.wav`);
  if (existsSync(file)) return file;
  await mkdir(join(CACHE, "tts"), { recursive: true });
  await run(
    "npx",
    [
      "-y",
      HYPERFRAMES,
      "tts",
      text,
      "-v",
      person.voice,
      "-s",
      String(speed),
      "-o",
      file,
      "--json",
    ],
    { env, maxBuffer: 1 << 24 },
  );
  return file;
}

/** 16-bit PCM mono WAV at 24 kHz, as Kokoro writes it. */
async function readWav(file: string): Promise<Float32Array> {
  const buf = await readFile(file);
  let offset = 12;
  while (offset < buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === "fmt ") {
      const channels = buf.readUInt16LE(offset + 10);
      const rate = buf.readUInt32LE(offset + 12);
      const bits = buf.readUInt16LE(offset + 22);
      if (channels !== 1 || rate !== SAMPLE_RATE || bits !== 16) {
        throw new Error(
          `${file}: expected 24 kHz mono 16-bit, got ${rate}/${channels}/${bits}`,
        );
      }
    }
    if (id === "data") {
      const n = size / 2;
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++)
        out[i] = buf.readInt16LE(offset + 8 + i * 2) / 32768;
      return out;
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error(`${file}: no data chunk`);
}

/** Drops leading and trailing near-silence so lines butt up like real speech. */
function trim(samples: Float32Array): Float32Array {
  const floor = 0.01;
  let a = 0;
  let b = samples.length - 1;
  while (a < b && Math.abs(samples[a]) < floor) a++;
  while (b > a && Math.abs(samples[b]) < floor) b--;
  const pad = Math.round(SAMPLE_RATE * 0.06);
  return samples.subarray(
    Math.max(0, a - pad),
    Math.min(samples.length, b + pad),
  );
}

function writeWav(samples: Float32Array): Buffer {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write("WAVEfmt ", 8, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    buf.writeInt16LE(
      Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767),
      44 + i * 2,
    );
  }
  return buf;
}

// ---------- layout: actions against speech ----------

const r2 = (n: number) => Math.round(n * 100) / 100;

function hash(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0) / 4294967295;
}

class Timeline {
  events: TimedEvent[] = [];
  toasts: Toast[] = [];
  cursorFree = 0;

  push(t: number, type: string, rest: Record<string, unknown> = {}) {
    this.events.push({ t: r2(t), type, ...rest });
  }

  move(t: number, target: string, opts: Op = {}): number {
    const start = Math.max(t, this.cursorFree);
    const dur = Number(opts.dur ?? 0.55 + hash(target) * 0.3);
    const h = hash(`${target}:${start}`);
    this.push(start, "move", {
      t1: r2(start + dur),
      target,
      fx: Number(opts.fx ?? 0.35 + h * 0.3),
      fy: Number(opts.fy ?? 0.45 + hash(target) * 0.15),
      bend: r2((h - 0.5) * 0.18),
    });
    this.push(start + dur, "arrive", { id: target });
    this.cursorFree = start + dur;
    return start + dur;
  }

  click(t: number, target: string, opts: Op = {}): number {
    const at = this.move(t, target, opts);
    this.push(at + 0.05, "click", { id: target });
    return at + 0.17;
  }

  op(t: number, op: Op) {
    const [kind] = Object.keys(op);
    const v = op[kind];
    switch (kind) {
      case "nav":
        this.push(t, "nav", { page: v });
        break;
      case "set": {
        const [id, props] = v as [string, Record<string, unknown>];
        this.push(t, "set", { id, props });
        break;
      }
      case "add": {
        const [into, item, pos] = v as [string, unknown, string?];
        this.push(t, "add", { into, item, pos });
        break;
      }
      case "modal":
        this.push(t, "modal", { modal: v });
        break;
      case "menu":
        this.push(t, "menu", { menu: v });
        break;
      case "loading": {
        const [id, dur] = v as [string, number];
        this.push(t, "loading", { id, dur });
        break;
      }
      case "toast": {
        const toast = v as Omit<Toast, "t" | "dur"> & { dur?: number };
        this.toasts.push({ dur: 3.6, ...toast, t: r2(t) });
        break;
      }
      case "focus":
        this.push(t, "focus", { id: v });
        break;
      case "blur":
        this.push(t, "blur");
        break;
      default:
        throw new Error(`unknown op ${kind}`);
    }
  }

  /** Runs one line's action list from `t`; returns when the last action ends. */
  act(t: number, actions: Op[]): number {
    let cur = t;
    for (const a of actions) {
      if ("wait" in a) {
        cur += Number(a.wait);
      } else if ("click" in a) {
        cur = this.click(cur, String(a.click), a);
      } else if ("point" in a) {
        cur = this.move(cur, String(a.point), a) + Number(a.hold ?? 0.6);
      } else if ("check" in a) {
        cur = this.click(cur, String(a.check), { fx: 0.04, ...a });
        this.op(cur, { set: [String(a.check), { checked: true }] });
      } else if ("type" in a) {
        const id = String(a.type);
        const text = String(a.text);
        cur = this.click(cur, id, { fx: 0.3, ...a });
        const cps = Number(a.cps ?? 14);
        this.push(cur + 0.15, "type", {
          id,
          text,
          cps,
          append: Boolean(a.append),
          base: a.base,
        });
        cur += 0.15 + text.length / cps + 0.25;
      } else if ("pick" in a || "select" in a) {
        const spec = (a.pick ?? a.select) as {
          anchor?: string;
          id?: string;
          items?: { id: string; label: string; danger?: boolean }[];
          options?: string[];
          choose?: string;
          value?: string;
          alignRight?: boolean;
        };
        const anchor = String(spec.anchor ?? spec.id);
        const items =
          spec.items ??
          (spec.options ?? []).map((label, i) => ({
            id: `${anchor}--opt-${i}`,
            label,
          }));
        const chosen =
          spec.choose ??
          items.find((i) => i.label === spec.value)?.id ??
          items[0].id;
        cur = this.click(cur, anchor);
        this.op(cur, { menu: { anchor, items, alignRight: spec.alignRight } });
        cur = this.click(cur + 0.35, chosen, { dur: 0.45, fx: 0.4 });
        this.op(cur, { menu: null });
        if ("select" in a) {
          this.op(cur, {
            set: [anchor, { value: items.find((i) => i.id === chosen)?.label }],
          });
        }
      } else {
        this.op(cur, a);
      }
    }
    return cur;
  }
}

type Laid = {
  duration: number;
  events: TimedEvent[];
  toasts: Toast[];
  speech: { s: Speaker; start: number; samples: Float32Array; text: string }[];
  steps: { title: string; actor: string; system: string; at: number }[];
};

async function layout(rec: Recording): Promise<Laid> {
  const people = { P: rec.presenter, R: rec.receiver };
  const voices: Float32Array[] = [];
  const queue = rec.lines.map((line, i) => ({ line, i }));
  const workers = Array.from({ length: 3 }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      voices[job.i] = trim(
        await readWav(await speak(job.line.text, people[job.line.s])),
      );
    }
  });
  await Promise.all(workers);

  const tl = new Timeline();
  const speech: Laid["speech"] = [];
  const steps: Laid["steps"] = [];
  let t = 1.1;
  let prev: Speaker | null = null;
  for (const [i, line] of rec.lines.entries()) {
    const dur = voices[i].length / SAMPLE_RATE;
    if (prev && prev !== line.s) t += 0.2;
    const start = t;
    speech.push({ s: line.s, start, samples: voices[i], text: line.text });
    const actStart = start + (line.at ?? 0.35);
    const end = line.act?.length ? tl.act(actStart, line.act) : start;
    if (line.step) {
      const step =
        typeof line.step === "string" ? { title: line.step } : line.step;
      steps.push({
        title: step.title,
        actor: step.actor ?? rec.presenter.name,
        system: step.system ?? rec.system,
        at: Math.round((line.act?.length ? actStart : start) * 10) / 10,
      });
    }
    const gap = line.gap ?? 0.3;
    t = Math.max(start + dur + gap, line.nowait ? 0 : end + 0.35);
    prev = line.s;
  }
  const duration = Math.ceil((t + 1.2) * FPS) / FPS;
  tl.events.sort((a, b) => a.t - b.t);
  return { duration, events: tl.events, toasts: tl.toasts, speech, steps };
}

// ---------- audio ----------

function mix(laid: Laid) {
  const n = Math.ceil(laid.duration * SAMPLE_RATE);
  const out = new Float32Array(n);
  const per: Record<Speaker, Float32Array> = {
    P: new Float32Array(n),
    R: new Float32Array(n),
  };
  for (const line of laid.speech) {
    const at = Math.round(line.start * SAMPLE_RATE);
    for (let i = 0; i < line.samples.length && at + i < n; i++) {
      out[at + i] += line.samples[i];
      per[line.s][at + i] += line.samples[i];
    }
  }
  // A faint room tone so the gaps sound like an open microphone, not digital silence.
  let seed = 12345;
  let brown = 0;
  for (let i = 0; i < n; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    brown = brown * 0.985 + (seed / 4294967295 - 0.5) * 0.02;
    out[i] += brown * 0.06;
  }
  const hop = SAMPLE_RATE / FPS;
  const frames = Math.ceil(laid.duration * FPS);
  const levels = { P: "", R: "" };
  for (const k of ["P", "R"] as const) {
    for (let f = 0; f < frames; f++) {
      let sum = 0;
      const a = Math.round(f * hop);
      for (let i = a; i < Math.min(n, a + hop); i++) sum += per[k][i] ** 2;
      const rms = Math.sqrt(sum / hop);
      const lv = Math.min(1, (rms / 0.09) ** 0.7);
      levels[k] += Math.round(lv * 35).toString(36);
    }
  }
  return { wav: writeWav(out), levels };
}

// ---------- video ----------

async function encode(
  slug: string,
  video: string,
  wav: string,
  duration: number,
) {
  const target = join(OUT_DIR, `${slug}.mp4`);
  const common = [
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(FPS),
    "-g",
    String(FPS * 10),
    "-c:a",
    "aac",
    "-b:a",
    "48k",
    "-ac",
    "1",
    "-af",
    "highpass=f=70,loudnorm=I=-17:TP=-1.5:LRA=11",
    "-ar",
    String(SAMPLE_RATE),
    "-movflags",
    "+faststart",
    "-t",
    String(duration),
  ];
  const input = [
    "-y",
    "-loglevel",
    "error",
    "-i",
    video,
    "-i",
    wav,
    "-map",
    "0:v",
    "-map",
    "1:a",
  ];
  await run("ffmpeg", [
    ...input,
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-tune",
    "stillimage",
    "-crf",
    "27",
    ...common,
    target,
  ]);
  if ((await stat(target)).size > MAX_BYTES) {
    const kbps = Math.floor(
      ((MAX_BYTES * 0.92 * 8) / duration - 50_000) / 1000,
    );
    const passlog = join(CACHE, "work", slug, "x264");
    await run("ffmpeg", [
      ...input,
      "-c:v",
      "libx264",
      "-preset",
      "slow",
      "-b:v",
      `${kbps}k`,
      "-pass",
      "1",
      "-passlogfile",
      passlog,
      "-an",
      "-f",
      "mp4",
      "/dev/null",
    ]);
    await run("ffmpeg", [
      ...input,
      "-c:v",
      "libx264",
      "-preset",
      "slow",
      "-b:v",
      `${kbps}k`,
      "-pass",
      "2",
      "-passlogfile",
      passlog,
      ...common,
      target,
    ]);
  }
  const poster = join(OUT_DIR, `${slug}.jpg`);
  for (const q of [5, 7, 9, 12, 16]) {
    await run("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-ss",
      String(Math.round(duration * 0.55)),
      "-i",
      target,
      "-frames:v",
      "1",
      "-vf",
      "scale=640:360:flags=lanczos",
      "-q:v",
      String(q),
      poster,
    ]);
    if ((await stat(poster)).size <= POSTER_MAX_BYTES) break;
  }
  return {
    bytes: (await stat(target)).size,
    poster: (await stat(poster)).size,
  };
}

async function renderOne(slug: string, keepVideo: boolean) {
  const rec: Recording = (
    await import(
      pathToFileURL(join(FIXTURES, "recordings", `${slug}.mjs`)).href
    )
  ).default;
  if (rec.slug !== slug)
    throw new Error(`${slug}.mjs declares slug ${rec.slug}`);
  const laid = await layout(rec);
  const { wav, levels } = mix(laid);
  const work = join(CACHE, "work", slug);
  await mkdir(work, { recursive: true });
  await writeFile(join(work, "dialogue.wav"), wav);

  const data = {
    duration: laid.duration,
    levelsFps: FPS,
    callTitle: rec.callTitle,
    callSub: rec.callSub,
    agenda: rec.agenda,
    timerOffset: rec.timerOffset ?? 0,
    people: { P: rec.presenter, R: rec.receiver },
    ui: rec.ui,
    events: laid.events,
    toasts: laid.toasts,
    levels,
  };
  const template = await readFile(join(FIXTURES, "template/call.html"), "utf8");
  const html = template
    .replace("__DURATION__", String(laid.duration))
    .replace("/*__REC__*/ null", JSON.stringify(data).replace(/</g, "\\u003c"));
  await writeFile(join(work, "index.html"), html);

  const video = join(work, "video.mp4");
  if (!(keepVideo && existsSync(video))) {
    await rm(video, { force: true });
    await run(
      "npx",
      [
        "-y",
        HYPERFRAMES,
        "render",
        work,
        "-f",
        String(FPS),
        "--crf",
        "14",
        "-o",
        video,
        "--quiet",
      ],
      { env, maxBuffer: 1 << 26 },
    );
  }
  await mkdir(OUT_DIR, { recursive: true });
  const { bytes, poster } = await encode(
    slug,
    video,
    join(work, "dialogue.wav"),
    laid.duration,
  );

  const expected = {
    slug,
    title: rec.title,
    presenter: { name: rec.presenter.name, role: rec.presenter.role },
    receiver: { name: rec.receiver.name, role: rec.receiver.role },
    steps: laid.steps,
    decisions: rec.decisions,
    warnings: rec.warnings,
    openQuestions: rec.openQuestions,
  };
  await mkdir(join(FIXTURES, "expected"), { recursive: true });
  const expectedFile = join(FIXTURES, "expected", `${slug}.json`);
  await writeFile(expectedFile, `${JSON.stringify(expected, null, 2)}\n`);
  await run(join(ROOT, "node_modules/.bin/biome"), [
    "format",
    "--write",
    expectedFile,
  ]).catch(() => {});
  await writeFile(
    join(work, "transcript.txt"),
    laid.speech
      .map(
        (l) =>
          `[${l.start.toFixed(1)}] ${l.s === "P" ? rec.presenter.name : rec.receiver.name}: ${l.text}`,
      )
      .join("\n"),
  );
  return {
    slug,
    durationSeconds: Math.round(laid.duration),
    bytes,
    posterBytes: poster,
    presenter: rec.presenter.name,
    receiver: rec.receiver.name,
  };
}

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const keepVideo = args.includes("--keep-video");
const slugs = only
  ? [only]
  : (await readdir(join(FIXTURES, "recordings")))
      .filter((f) => f.endsWith(".mjs"))
      .map((f) => f.replace(/\.mjs$/, ""))
      .sort();

const results = [];
for (const slug of slugs) {
  const started = Date.now();
  const result = await renderOne(slug, keepVideo);
  results.push(result);
  console.log(
    `${slug}: ${result.durationSeconds}s, ${(result.bytes / 1024 / 1024).toFixed(2)} MB, poster ${Math.round(result.posterBytes / 1024)} KB (${Math.round((Date.now() - started) / 1000)}s)`,
  );
}
console.log(JSON.stringify(results, null, 2));
