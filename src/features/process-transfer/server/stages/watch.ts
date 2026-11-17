import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { LIMITS } from "../../domain/limits";
import {
  type Observation,
  observationSchema,
  type Watch,
  watchSchema,
} from "../../domain/process";
import { sampleBySlug } from "../../domain/samples";
import { mp4DurationSeconds } from "../../domain/uploads";
import { RunError } from "../errors";
import { generate, type RunContext } from "../llm";
import { WATCH_INSTRUCTIONS, watchPrompt } from "../prompts";
import type { RunRow } from "../repository";
import { download } from "../storage";

type Recording = { bytes: Uint8Array; mediaType: string; title?: string };

/**
 * The Recording's bytes. A Sample is read from `public/` when the files are
 * there (local dev) and otherwise fetched from the site that started the Run;
 * an upload comes from the private bucket.
 */
async function readRecording(row: RunRow, origin: string): Promise<Recording> {
  if (row.source_kind === "sample") {
    const sample = sampleBySlug(row.sample_slug ?? "");
    if (!sample) throw new RunError("That sample is not available.");
    const local = path.join(process.cwd(), "public", sample.video);
    const bytes = await readFile(local)
      .then((buffer) => new Uint8Array(buffer))
      .catch(async () => {
        const response = await fetch(new URL(sample.video, origin));
        if (!response.ok) {
          console.error(
            `[process-transfer] sample fetch ${response.status} from ${origin}`,
          );
          throw new RunError("The sample Recording could not be loaded.");
        }
        return new Uint8Array(await response.arrayBuffer());
      });
    return { bytes, mediaType: "video/mp4", title: sample.title };
  }
  if (!row.recording_path) throw new RunError("The Run has no Recording.");
  const bytes = await download(row.recording_path).catch((error) => {
    console.error("[process-transfer] could not download a Recording", error);
    throw new RunError("The Recording could not be read from storage.");
  });
  return { bytes, mediaType: row.recording_type ?? "video/mp4" };
}

/*
 * What the Watch model fills: the Watch, with each moment's time written as
 * MM:SS. Video models place moments far better as a clock than as a count
 * of seconds (asked for seconds, Gemini drifted 40 s late by the end of a
 * two-minute call).
 */
const watchCallSchema = watchSchema.extend({
  observations: z.array(
    observationSchema.omit({ at: true }).extend({
      time: z
        .string()
        .describe("MM:SS from the start of the video, e.g. 01:07"),
    }),
  ),
});
type WatchCall = z.infer<typeof watchCallSchema>;

/** "01:07" → 67; "1:02:03" → 3723; "75" or "75.5" → seconds as given. */
function clockSeconds(time: string): number | null {
  const parts = time.trim().split(":");
  if (parts.length > 3 || parts.some((part) => !/^\d+(\.\d+)?$/.test(part))) {
    return null;
  }
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

function cleanWatch(call: WatchCall, seconds: number | null): Watch {
  const observations: Observation[] = call.observations
    .flatMap(({ time, ...rest }) => {
      const at = clockSeconds(time);
      return at === null ? [] : [{ ...rest, at }];
    })
    .filter((item) => seconds === null || item.at <= seconds + 1)
    .sort((a, b) => a.at - b.at);
  const last = observations.at(-1)?.at ?? 0;
  return {
    title: call.title.trim().slice(0, 140) || "Untitled Recording",
    durationSeconds: seconds ?? Math.max(call.durationSeconds, last),
    participants: call.participants,
    observations,
  };
}

/** The Watch stage: one call to a model that takes video. */
export async function watchRecording(
  ctx: RunContext,
  row: RunRow,
  origin: string,
): Promise<Watch> {
  const recording = await readRecording(row, origin);
  if (recording.bytes.byteLength > LIMITS.uploadBytes) {
    throw new RunError(
      `The Recording is larger than ${Math.round(LIMITS.uploadBytes / 1024 / 1024)} MB.`,
    );
  }
  const seconds = mp4DurationSeconds(recording.bytes);
  // An upload's length is the only bound on what the model is sent; one that
  // cannot be read is refused before any call.
  if (seconds === null && row.source_kind === "upload") {
    throw new RunError(
      "The Recording's length cannot be read; upload an MP4 or MOV.",
    );
  }
  if (seconds !== null && seconds > LIMITS.uploadSeconds) {
    throw new RunError(
      `The Recording is ${Math.round(seconds / 60)} minutes long; the demo takes up to ${LIMITS.uploadSeconds / 60}.`,
    );
  }
  const call = await generate(ctx, {
    purpose: "watch",
    label: "Watch the Recording",
    model: row.models.watch,
    schema: watchCallSchema,
    instructions: WATCH_INSTRUCTIONS,
    content: [
      { type: "text", text: watchPrompt({ title: recording.title, seconds }) },
      {
        type: "file",
        data: recording.bytes,
        mediaType: recording.mediaType,
      },
    ],
    maxOutputTokens: 32_000,
  });
  return cleanWatch(call, seconds);
}
