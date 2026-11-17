/**
 * Slims a real Run's Audit trail into a Replay the page can ship as static
 * JSON and play without spending anything. Pure; the eval script records.
 */
import type { RunEvent } from "./contract";

/** Tool output, code, stdout and stderr are cut to about this many characters. */
export const REPLAY_TEXT_CAP = 600;
/** A thought or log line is cut to this. */
export const REPLAY_NOTE_CAP = 2000;
/** The events of a Replay stay under about this many bytes of JSON. */
export const REPLAY_EVENTS_BUDGET = 520_000;

type Seq = RunEvent & { seq: number };

export function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** A tool input as is when small, else its JSON cut to a string. */
function slimInput(input: unknown): unknown {
  const json = JSON.stringify(input ?? null);
  return json.length > REPLAY_TEXT_CAP ? cut(json, REPLAY_TEXT_CAP) : input;
}

function slimOne(event: Seq): Seq {
  switch (event.type) {
    case "tool":
      return {
        ...event,
        input: slimInput(event.input),
        ...(event.output !== undefined
          ? { output: cut(event.output, REPLAY_TEXT_CAP) }
          : {}),
      };
    case "code":
      return {
        ...event,
        code: cut(event.code, REPLAY_TEXT_CAP),
        stdout: cut(event.stdout, REPLAY_TEXT_CAP),
        stderr: cut(event.stderr, REPLAY_TEXT_CAP),
      };
    case "thought":
    case "log":
      return { ...event, text: cut(event.text, REPLAY_NOTE_CAP) };
    default:
      return event;
  }
}

/**
 * A `names` event written by a Reader merge: the next event that is not a
 * gate is the spawn_readers call it closed.
 */
function isReaderMerge(events: Seq[], index: number) {
  for (let i = index + 1; i < events.length; i++) {
    const next = events[i];
    if (next.type === "gate") continue;
    return next.type === "tool" && next.tool === "spawn_readers";
  }
  return false;
}

const size = (events: Seq[]) => JSON.stringify(events).length;

/**
 * Every event, slimmed: long texts cut; of the `names` events only the last
 * one, plus the Reader merges in order while the trail stays under `budget`.
 */
export function slimEvents(
  events: Seq[],
  budget = REPLAY_EVENTS_BUDGET,
): Seq[] {
  const slim = events.map(slimOne);
  let last = -1;
  for (let i = slim.length - 1; i >= 0; i--)
    if (slim[i].type === "names") {
      last = i;
      break;
    }
  const keep = slim.map((event, i) => event.type !== "names" || i === last);
  let used = size(slim.filter((_, i) => keep[i]));
  for (let i = 0; i < slim.length; i++) {
    if (keep[i] || slim[i].type !== "names" || !isReaderMerge(slim, i))
      continue;
    const extra = JSON.stringify(slim[i]).length + 1;
    if (used + extra > budget) break;
    keep[i] = true;
    used += extra;
  }
  return slim.filter((_, i) => keep[i]);
}
