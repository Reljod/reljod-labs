import type { RateLimiter } from "@/platform/rate/limiter";
import type { AskAnswer, WalkEvent } from "../domain/api";
import type { Footage } from "./footage";

/**
 * What the Floorwalk service needs from the outside world. The container
 * (`container.ts`) wires the real adapters; tests and the stubbed e2e suite
 * hand in fakes.
 */

/** The private bucket footage is uploaded to and read back from. */
export interface FootageStore {
  /** A one-time URL the browser PUTs a file to. */
  uploadUrl(path: string): Promise<string>;
  /** The file, or null when it is not there (expired, never uploaded). */
  download(path: string): Promise<Uint8Array | null>;
  /** Removes expired uploads; best effort, never throws. */
  sweep(): Promise<void>;
}

/** The model that watches footage: one Walk, as checked events. */
export interface Walker {
  walk(footage: Footage, signal?: AbortSignal): AsyncGenerator<WalkEvent>;
  ask(
    footage: Footage,
    question: string,
    signal?: AbortSignal,
  ): Promise<AskAnswer>;
  /** The model id shown on the page. */
  readonly model: string;
}

export type SpendKind = "walk" | "ask" | "upload";

export type FloorwalkPorts = {
  store: FootageStore;
  walker: Walker;
  rate: RateLimiter<SpendKind>;
  /** Runs work after the answer is sent (`after` in Next; inline in tests). */
  later: (work: () => Promise<void>) => void;
  /** A fresh upload id. */
  newId: () => string;
};
