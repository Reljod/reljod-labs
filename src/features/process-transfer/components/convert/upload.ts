"use client";

import { UPLOAD_TYPES } from "../../domain/limits";
import { bytes, seconds } from "../format";

/*
 * The browser half of an upload: check the file before anything is sent,
 * read its length from the video's own metadata, then PUT it to the signed
 * URL with progress. The server checks size and type again.
 */

export const ACCEPT = [
  ...Object.keys(UPLOAD_TYPES),
  ...Object.values(UPLOAD_TYPES).map((extension) => `.${extension}`),
].join(",");

/** Some browsers leave `file.type` empty for .mov; fall back to the extension. */
export function videoType(file: Pick<File, "name" | "type">): string {
  if (file.type) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase();
  const match = Object.entries(UPLOAD_TYPES).find(
    ([, value]) => value === extension,
  );
  return match ? match[0] : "";
}

/** Why the file cannot be sent, before reading its length; null when it can. */
export function fileProblem(
  file: Pick<File, "name" | "type" | "size">,
  limits: { uploadBytes: number },
): string | null {
  if (!Object.hasOwn(UPLOAD_TYPES, videoType(file))) {
    return "Choose an MP4 or MOV video.";
  }
  if (file.size <= 0) return "That file is empty.";
  if (file.size > limits.uploadBytes) {
    return `That file is ${bytes(file.size)}; a Recording may be at most ${bytes(limits.uploadBytes)}.`;
  }
  return null;
}

/** Why the Recording is too long, or null. */
export function durationProblem(
  duration: number | null,
  limits: { uploadSeconds: number },
): string | null {
  if (duration === null) return null;
  if (duration > limits.uploadSeconds) {
    return `That Recording is ${seconds(duration)} long; the demo takes calls up to ${seconds(limits.uploadSeconds)}.`;
  }
  return null;
}

/** The video's length in seconds from its metadata, or null if the browser cannot read it. */
export function readDuration(
  file: File,
  timeoutMs = 10_000,
): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    const finish = (value: number | null) => {
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    video.onloadedmetadata = () =>
      finish(Number.isFinite(video.duration) ? video.duration : null);
    video.onerror = () => finish(null);
    video.src = url;
  });
}

/** PUTs the file to a signed Storage URL. XHR rather than fetch: fetch cannot report upload progress. */
export function putFile(
  url: string,
  file: File,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.setRequestHeader("content-type", videoType(file));
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    request.onload = () =>
      request.status >= 200 && request.status < 300
        ? resolve()
        : reject(new Error(`The upload was refused (${request.status}).`));
    request.onerror = () =>
      reject(
        new Error("The upload stopped. Check the connection and try again."),
      );
    request.onabort = () => reject(new Error("The upload was cancelled."));
    signal?.addEventListener("abort", () => request.abort(), { once: true });
    request.send(file);
  });
}
