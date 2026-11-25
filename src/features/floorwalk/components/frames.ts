"use client";

/**
 * Grabs still frames from the footage for the Finding cards: one hidden video
 * per source, seeked one request at a time, drawn to a small canvas with the
 * Finding's box. Same-origin Samples and local object URLs only, so the
 * canvas is never tainted.
 */
type Job = {
  at: number;
  box: readonly number[] | null;
  color: string;
  resolve: (url: string | null) => void;
};

const grabbers = new Map<string, Grabber>();

class Grabber {
  private video: HTMLVideoElement;
  private queue: Job[] = [];
  private busy = false;
  private cache = new Map<string, string | null>();

  constructor(src: string) {
    this.video = document.createElement("video");
    this.video.muted = true;
    this.video.preload = "auto";
    this.video.playsInline = true;
    this.video.src = src;
  }

  grab(
    at: number,
    box: readonly number[] | null,
    color: string,
  ): Promise<string | null> {
    const key = `${at.toFixed(2)}|${box?.join(",")}|${color}`;
    // Only good frames are cached; a failed grab is tried again next time.
    const cached = this.cache.get(key);
    if (cached) return Promise.resolve(cached);
    return new Promise((resolve) => {
      this.queue.push({
        at,
        box,
        color,
        resolve: (url) => {
          if (url) this.cache.set(key, url);
          resolve(url);
        },
      });
      void this.next();
    });
  }

  private async next() {
    if (this.busy) return;
    const job = this.queue.shift();
    if (!job) return;
    this.busy = true;
    try {
      job.resolve(await this.capture(job));
    } catch {
      job.resolve(null);
    } finally {
      this.busy = false;
      void this.next();
    }
  }

  private async capture({ at, box, color }: Job): Promise<string | null> {
    const v = this.video;
    if (v.readyState < 1)
      await new Promise<void>((resolve, reject) => {
        v.addEventListener("loadedmetadata", () => resolve(), { once: true });
        v.addEventListener("error", () => reject(new Error("video")), {
          once: true,
        });
      });
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      v.addEventListener(
        "seeked",
        () => {
          // Wait for the seeked frame to be decoded, where the browser can say so.
          if ("requestVideoFrameCallback" in v)
            v.requestVideoFrameCallback(() => done());
          else done();
        },
        { once: true },
      );
      v.currentTime = Math.min(
        Math.max(0, at),
        Math.max(0, (v.duration || at) - 0.05),
      );
      window.setTimeout(done, 8000);
    });
    return paintFrame(v, box, color);
  }
}

/**
 * Draws the video's current frame with the box lit and outlined, or null when
 * there is no decoded frame yet (a blank canvas would read as black).
 */
export function paintFrame(
  v: HTMLVideoElement,
  box: readonly number[] | null,
  color: string,
): string | null {
  if (v.readyState < 2 || !v.videoWidth) return null;
  const width = 480;
  const height = Math.round((width * v.videoHeight) / v.videoWidth);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  if (!g) return null;
  g.drawImage(v, 0, 0, width, height);
  // A frame that is all but black was not decoded: no thumbnail, try again later.
  const sample = g.getImageData(0, 0, width, height).data;
  let light = 0;
  for (let i = 0; i < sample.length; i += 4 * 97)
    light += (sample[i] ?? 0) + (sample[i + 1] ?? 0) + (sample[i + 2] ?? 0);
  if (light / (sample.length / (4 * 97)) < 24) return null;
  if (box) {
    const [top, left, bottom, right] = box as [number, number, number, number];
    const rect: [number, number, number, number] = [
      left * width,
      top * height,
      (right - left) * width,
      (bottom - top) * height,
    ];
    g.fillStyle = "rgba(20,33,61,0.35)";
    g.fillRect(0, 0, width, height);
    g.save();
    g.beginPath();
    g.rect(...rect);
    g.clip();
    g.drawImage(v, 0, 0, width, height);
    g.restore();
    g.strokeStyle = color;
    g.lineWidth = 4;
    g.strokeRect(...rect);
  }
  return canvas.toDataURL("image/jpeg", 0.82);
}

export function grabFrame(
  src: string,
  at: number,
  box: readonly number[] | null,
  color: string,
) {
  let grabber = grabbers.get(src);
  if (!grabber) {
    grabber = new Grabber(src);
    grabbers.set(src, grabber);
  }
  return grabber.grab(at, box, color);
}
