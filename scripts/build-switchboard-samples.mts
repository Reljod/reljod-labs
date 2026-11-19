/**
 * Renders the Sample callers' lines to speech (synthetic, Meridia) with a
 * speech model on AI Gateway, then checks each clip by transcribing it back.
 *
 *   node --env-file=.env.local --experimental-strip-types scripts/build-switchboard-samples.mts [callerId ...] [--force]
 *
 * Writes public/switchboard/samples/<caller>/<n>.mp3 (24 kHz mono) and
 * fixtures/switchboard/samples.json (what was said, what a transcriber heard,
 * seconds). Needs ffmpeg. Spends a few cents; run it only after changing
 * `domain/samples.ts`.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createGateway, generateSpeech, transcribe } from "ai";
// @ts-expect-error TS5097: Node runs this file as is, so the import names the `.ts` file.
import { SAMPLE_CALLERS } from "../src/features/switchboard/domain/samples.ts";

const SPEECH_MODEL = "google/gemini-3.8-flash-tts";
const CHECK_MODEL = "openai/gpt-4o-mini-transcribe";

const key =
  process.env.SWITCHBOARD_AI_GATEWAY_API_KEY ??
  process.env.DOCUMENT_COMPLIANCE_AI_GATEWAY_API_KEY;
if (!key) throw new Error("No gateway key in the environment");
const gateway = createGateway({ apiKey: key });

const args = process.argv.slice(2);
const force = args.includes("--force");
const only = args.filter((arg) => !arg.startsWith("--"));
const root = path.resolve(import.meta.dirname, "..");
const outDir = path.join(root, "public/switchboard/samples");
const manifestPath = path.join(root, "fixtures/switchboard/samples.json");

type Entry = {
  caller: string;
  line: number;
  text: string;
  heard: string;
  seconds: number;
};
const manifest: Entry[] = existsSync(manifestPath)
  ? JSON.parse(await readFile(manifestPath, "utf8"))
  : [];

async function speak(text: string, voice: string, style: string) {
  for (const candidate of [voice, undefined]) {
    try {
      const result = await generateSpeech({
        model: gateway.speech(SPEECH_MODEL),
        text,
        voice: candidate,
        instructions: `${style} This is a phone call: speak like a real person, not an announcer.`,
      });
      return result.audio.uint8Array;
    } catch (error) {
      if (candidate === undefined) throw error;
      console.warn(
        `  voice ${voice} failed, using the default: ${String(error).slice(0, 120)}`,
      );
    }
  }
  throw new Error("unreachable");
}

for (const caller of SAMPLE_CALLERS) {
  if (only.length && !only.includes(caller.id)) continue;
  await mkdir(path.join(outDir, caller.id), { recursive: true });
  for (const [index, line] of caller.lines.entries()) {
    const file = path.join(outDir, caller.id, `${index + 1}.mp3`);
    const known = manifest.find(
      (entry) => entry.caller === caller.id && entry.line === index + 1,
    );
    if (!force && existsSync(file) && known?.text === (line.say ?? line.text))
      continue;
    const wav = await speak(line.say ?? line.text, caller.voice, caller.style);
    const raw = path.join(
      tmpdir(),
      `switchboard-${caller.id}-${index + 1}.wav`,
    );
    await writeFile(raw, wav);
    // 24 kHz mono, the Session's own rate; a touch of silence trimmed at both ends.
    execFileSync("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-i",
      raw,
      "-af",
      "silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse,loudnorm=I=-18:TP=-2",
      "-ar",
      "24000",
      "-ac",
      "1",
      "-b:a",
      "48k",
      file,
    ]);
    const seconds = Number(
      execFileSync("ffprobe", [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "csv=p=0",
        file,
      ])
        .toString()
        .trim(),
    );
    const heard = (
      await transcribe({
        model: gateway.transcription(CHECK_MODEL),
        audio: await readFile(file),
      })
    ).text;
    const entry: Entry = {
      caller: caller.id,
      line: index + 1,
      text: line.say ?? line.text,
      heard,
      seconds: Math.round(seconds * 10) / 10,
    };
    const at = manifest.findIndex(
      (item) => item.caller === entry.caller && item.line === entry.line,
    );
    if (at >= 0) manifest[at] = entry;
    else manifest.push(entry);
    console.log(`${caller.id}/${index + 1} ${entry.seconds}s  heard: ${heard}`);
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
}
