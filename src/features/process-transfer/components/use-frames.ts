"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type Frame,
  type Frames,
  type FrameUrls,
  frameKey,
} from "../domain/frames";
import { fitWidth, missingTimes, seekTime } from "./frame-times";

/** Frames are stored at most this wide: plenty for a slide or a page. */
const MAX_WIDTH = 1280;
const QUALITY = 0.8;
const METADATA_TIMEOUT_MS = 15_000;
const SEEK_TIMEOUT_MS = 8_000;

type Cache = {
  key: string;
  frames: Frames;
  urls: FrameUrls;
  /** The video could not be read at all; do not try again for this Run. */
  broken: boolean;
};

function once(
  target: HTMLVideoElement,
  event: string,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`No ${event} within ${timeoutMs} ms`));
    }, timeoutMs);
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("The video could not be read"));
    };
    const cleanup = () => {
      clearTimeout(timer);
      target.removeEventListener(event, onEvent);
      target.removeEventListener("error", onError);
    };
    target.addEventListener(event, onEvent, { once: true });
    target.addEventListener("error", onError, { once: true });
  });
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    // Throws a SecurityError on a tainted canvas (a video served without CORS).
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("The frame could not be encoded")),
      "image/jpeg",
      QUALITY,
    );
  });
}

/**
 * Captures stills of the Recording in the browser: a detached
 * `<video crossOrigin="anonymous">` seeks to each time and a canvas draws it.
 * Frames are cached per Run and only missing times are captured. If the video
 * cannot be read (gone, or a tainted canvas) the Run simply has no Frames and
 * the document and Deck build without screenshots.
 */
export function useFrames(runId: string | null, videoUrl: string | null) {
  const cache = useRef<Cache | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [urls, setUrls] = useState<FrameUrls>({});
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const key = runId && videoUrl ? `${runId}|${videoUrl}` : null;

  // A new Run (or no video) starts from nothing; old preview URLs are freed.
  useEffect(() => {
    cache.current = key ? { key, frames: {}, urls: {}, broken: false } : null;
    setUrls({});
    setProgress({ done: 0, total: 0 });
    return () => {
      const old = cache.current;
      if (old)
        for (const url of Object.values(old.urls)) URL.revokeObjectURL(url);
      cache.current = null;
    };
  }, [key]);

  const run = useCallback(
    async (times: number[]): Promise<Frames> => {
      const current = cache.current;
      if (!current || !videoUrl) return {};
      if (current.broken) return current.frames;
      const todo = missingTimes(times, current.frames);
      if (todo.length === 0) return current.frames;

      setProgress({ done: 0, total: todo.length });
      const video = document.createElement("video");
      video.crossOrigin = "anonymous";
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      const canvas = document.createElement("canvas");
      try {
        const ready = once(video, "loadedmetadata", METADATA_TIMEOUT_MS);
        video.src = videoUrl;
        await ready;
        const size = fitWidth(video.videoWidth, video.videoHeight, MAX_WIDTH);
        if (size.width === 0) throw new Error("The video has no picture");
        canvas.width = size.width;
        canvas.height = size.height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("No canvas");

        for (const [index, at] of todo.entries()) {
          if (cache.current !== current) break;
          const seeked = once(video, "seeked", SEEK_TIMEOUT_MS);
          video.currentTime = seekTime(at, video.duration);
          await seeked;
          context.drawImage(video, 0, 0, size.width, size.height);
          const blob = await toBlob(canvas);
          const frame: Frame = {
            bytes: new Uint8Array(await blob.arrayBuffer()),
            width: size.width,
            height: size.height,
            mime: "image/jpeg",
          };
          if (cache.current !== current) break;
          const name = frameKey(at);
          current.frames = { ...current.frames, [name]: frame };
          current.urls = { ...current.urls, [name]: URL.createObjectURL(blob) };
          setUrls(current.urls);
          setProgress({ done: index + 1, total: todo.length });
        }
      } catch {
        // Whatever was captured stays; the rest of the files build without it.
        const any = Object.keys(current.frames).length > 0;
        if (!any) current.broken = true;
      } finally {
        video.removeAttribute("src");
        video.load();
      }
      return current.frames;
    },
    [videoUrl],
  );

  /** Captures the times not captured yet, one capture at a time; resolves to every Frame so far. */
  const capture = useCallback(
    (times: number[]): Promise<Frames> => {
      const next = queue.current.then(
        () => run(times),
        () => run(times),
      );
      queue.current = next;
      return next;
    },
    [run],
  );

  return { urls, progress, capture };
}
