import { frameKey } from "../domain/frames";
import type { Process } from "../domain/process";
import type { DeckRound } from "../domain/run";

/*
 * Which stills of the Recording the document and the Deck need, so the
 * browser captures each one once. Pure, so it can be tested without a video.
 */

/** Every time the Steps and every Round's screenshots point at, one per Frame key, in order. */
export function frameTimes(
  process: Pick<Process, "steps"> | null,
  rounds: Pick<DeckRound, "deck">[],
  durationSeconds?: number,
): number[] {
  const times = new Map<string, number>();
  const take = (at: number) => {
    if (!Number.isFinite(at) || at < 0) return;
    const key = frameKey(at);
    if (!times.has(key)) times.set(key, Number(key));
  };
  for (const step of process?.steps ?? []) take(step.at);
  for (const round of rounds) {
    for (const slide of round.deck.slides) {
      for (const element of slide.elements) {
        if (element.type === "image") take(element.frameAt);
      }
    }
  }
  const sorted = [...times.values()].sort((a, b) => a - b);
  return durationSeconds && Number.isFinite(durationSeconds)
    ? sorted.filter((at) => at <= durationSeconds + 0.5)
    : sorted;
}

/** The times in `wanted` that have no Frame yet. */
export function missingTimes(
  wanted: number[],
  have: Record<string, unknown>,
): number[] {
  return wanted.filter((at) => !(frameKey(at) in have));
}

/** Scales a frame down to fit `maxWidth`, keeping its shape; never up. */
export function fitWidth(
  width: number,
  height: number,
  maxWidth: number,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  if (width <= maxWidth) return { width, height };
  return {
    width: maxWidth,
    height: Math.round((height * maxWidth) / width),
  };
}

/** Where to seek for a time: inside the video, a hair before its end so a frame decodes. */
export function seekTime(at: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return Math.max(0, at);
  return Math.min(Math.max(0, at), Math.max(0, duration - 0.05));
}
