import type { TurnEvent } from "./api";
import { cleanHeadline, cleanNext, cleanPost, cleanVoice } from "./brief";
import type { Inject } from "./scenario";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * Turns the Room's growing output into events, each part once and only when
 * it is complete: a voice when the next one starts (or the headline does),
 * the headline when the posts start, a post when the next one or the whisper
 * starts, the whisper when `next` starts. `final` flushes the rest and always
 * ends with the next Inject, which `cleanNext` keeps to the Engine's list.
 */
export function roomReporter(candidates: Inject[]) {
  let voices = 0;
  let headline = false;
  let posts = 0;
  let whisper = false;
  return (partial: unknown, final: boolean): TurnEvent[] => {
    const events: TurnEvent[] = [];
    if (!isRecord(partial)) {
      if (final)
        events.push({ t: "next", inject: cleanNext(null, candidates) });
      return events;
    }
    const list = Array.isArray(partial.voices) ? partial.voices : [];
    const voicesDone = final || "headline" in partial;
    const ready = voicesDone ? list.length : Math.max(0, list.length - 1);
    for (; voices < ready && voices < 4; voices++) {
      const voice = cleanVoice(list[voices]);
      if (voice) events.push({ t: "voice", voice });
    }
    if (!headline && (final || "posts" in partial)) {
      headline = true;
      const value = cleanHeadline(partial.headline);
      if (value) events.push({ t: "headline", headline: value });
    }
    const postList = Array.isArray(partial.posts) ? partial.posts : [];
    const postsDone = final || "whisper" in partial;
    const postReady = postsDone
      ? postList.length
      : Math.max(0, postList.length - 1);
    for (; posts < postReady && posts < 2; posts++) {
      const post = cleanPost(postList[posts]);
      if (post) events.push({ t: "post", post });
    }
    if (!whisper && (final || "next" in partial)) {
      whisper = true;
      const text =
        typeof partial.whisper === "string"
          ? partial.whisper.trim().replace(/\s+/g, " ").slice(0, 200)
          : "";
      if (text) events.push({ t: "whisper", text });
    }
    if (final)
      events.push({ t: "next", inject: cleanNext(partial.next, candidates) });
    return events;
  };
}
