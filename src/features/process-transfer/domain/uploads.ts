import type { Owner } from "@/features/access/domain/owner";
import { LIMITS, UPLOAD_TYPES, type UploadType } from "./limits";

/*
 * Where an uploaded Recording lives in the private bucket, and what may be
 * uploaded. The browser's file name never reaches a Storage key: the key is
 * the Owner's prefix, a fresh uuid and the extension of the declared type.
 */

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** `host:<uuid>` → `host-<uuid>`: a Storage-safe folder per Owner. */
export function ownerPrefix(owner: Owner): string {
  return `recordings/${owner.replace(":", "-")}`;
}

export function isUploadType(type: string): type is UploadType {
  return Object.hasOwn(UPLOAD_TYPES, type);
}

export function recordingPath(
  owner: Owner,
  type: UploadType,
  id: string,
): string {
  return `${ownerPrefix(owner)}/${id}.${UPLOAD_TYPES[type]}`;
}

/** The upload type a path was made for, when it is one of this Owner's Recordings. */
export function ownRecordingType(
  owner: Owner,
  path: string,
): UploadType | null {
  const prefix = ownerPrefix(owner).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const extensions = Object.values(UPLOAD_TYPES).join("|");
  const match = new RegExp(`^${prefix}/${UUID}\\.(${extensions})$`).exec(path);
  if (!match) return null;
  const extension = match[1];
  return (
    (Object.keys(UPLOAD_TYPES) as UploadType[]).find(
      (type) => UPLOAD_TYPES[type] === extension,
    ) ?? null
  );
}

/** Why an upload is refused, or null. */
export function uploadProblem(input: {
  name: unknown;
  size: unknown;
  type: unknown;
}): string | null {
  if (typeof input.type !== "string" || !isUploadType(input.type)) {
    return "Upload an MP4 or MOV video.";
  }
  if (
    typeof input.size !== "number" ||
    !Number.isFinite(input.size) ||
    input.size <= 0
  ) {
    return "That file is empty.";
  }
  if (input.size > LIMITS.uploadBytes) {
    return `A Recording may be at most ${Math.round(LIMITS.uploadBytes / 1024 / 1024)} MB; that one is ${(input.size / 1024 / 1024).toFixed(1)} MB.`;
  }
  if (typeof input.name !== "string" || input.name.trim() === "") {
    return "The file has no name.";
  }
  return null;
}

/** A file name to show, never to build a path from. */
export function displayName(name: string): string {
  const clean = name
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return (clean || "Recording").slice(0, 120);
}

/**
 * The duration of an MP4 or MOV from its `mvhd` box, or null when it cannot
 * be read (another container, or a box this does not understand).
 */
export function mp4DurationSeconds(bytes: Uint8Array): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = (at: number) =>
    String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  const walk = (start: number, end: number): number | null => {
    let at = start;
    while (at + 8 <= end) {
      let size = view.getUint32(at);
      let header = 8;
      if (size === 1) {
        if (at + 16 > end) return null;
        size = Number(view.getBigUint64(at + 8));
        header = 16;
      } else if (size === 0) {
        size = end - at;
      }
      if (size < header || at + size > end) return null;
      const kind = type(at + 4);
      if (kind === "moov") return walk(at + header, at + size);
      if (kind === "mvhd") {
        const body = at + header;
        const version = bytes[body];
        if (version === 1) {
          if (body + 32 > end) return null;
          const scale = view.getUint32(body + 20);
          const duration = Number(view.getBigUint64(body + 24));
          return scale > 0 && duration > 0 ? duration / scale : null;
        }
        if (body + 20 > end) return null;
        const scale = view.getUint32(body + 12);
        const duration = view.getUint32(body + 16);
        // Fragmented MP4s leave the duration 0: their length cannot be read here.
        return scale > 0 && duration > 0 ? duration / scale : null;
      }
      at += size;
    }
    return null;
  };
  return walk(0, bytes.byteLength);
}

/** How far the movie header may sit from its longest track: 2 s, or 5% of it. */
const LENGTH_TOLERANCE = { seconds: 2, share: 0.05 };

/**
 * The lowest average bitrate a real Recording is taken at, in bits per
 * second. A call with speech alone, in the leanest codec, runs above this;
 * a file whose declared length implies less is not a real recording of that
 * length, so its headers are not trusted.
 */
export const MIN_RECORDING_BITS_PER_SECOND = 8_000;

type Track = {
  /** From `tkhd`, in the movie's time scale. */
  header: number | null;
  /** From `mdhd`, in the track's own time scale. */
  media: number | null;
  /** The sample table (`stts`) summed, in the track's time scale. */
  samples: number | null;
  /** Samples counted by `stts`, and declared by `stsz`. */
  timedSamples: number | null;
  sizedSamples: number | null;
};

type Boxes = {
  movie: { scale: number; duration: number } | null;
  tracks: Track[];
  fragmented: boolean;
};

/** The boxes of an MP4 or MOV that declare how long it is, or null when it has no `moov`. */
const MAX_BOX_DEPTH = 8;

function readBoxes(bytes: Uint8Array): Boxes | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = (at: number) =>
    String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  const u32 = (at: number) => view.getUint32(at);
  const u64 = (at: number) => Number(view.getBigUint64(at));
  const found: Boxes = { movie: null, tracks: [], fragmented: false };
  let sawMoov = false;
  /** Thrown by the walk on a box that runs past its parent. */
  const BROKEN = new Error("A box runs past its parent");
  let track: Track | null = null;
  let mediaScale = 0;

  const walk = (start: number, end: number, depth: number) => {
    // A real MP4 nests moov > trak > mdia > minf > stbl: five levels. A file
    // nesting deeper is refused, never walked until the stack overflows.
    if (depth > MAX_BOX_DEPTH) throw BROKEN;
    let at = start;
    while (at + 8 <= end) {
      let size = u32(at);
      let header = 8;
      if (size === 1) {
        if (at + 16 > end) throw BROKEN;
        size = u64(at + 8);
        header = 16;
      } else if (size === 0) {
        size = end - at;
      }
      if (size < header || at + size > end) throw BROKEN;
      const kind = type(at + 4);
      const body = at + header;
      const stop = at + size;
      const has = (bytesNeeded: number) => body + bytesNeeded <= stop;
      if (kind === "moof" || kind === "mvex") found.fragmented = true;
      if (kind === "moov" && depth === 0) {
        sawMoov = true;
        walk(body, stop, depth + 1);
      } else if (kind === "trak") {
        track = {
          header: null,
          media: null,
          samples: null,
          timedSamples: null,
          sizedSamples: null,
        };
        mediaScale = 0;
        walk(body, stop, depth + 1);
        found.tracks.push(track);
        track = null;
      } else if (
        kind === "mdia" ||
        kind === "minf" ||
        kind === "stbl" ||
        kind === "edts"
      ) {
        walk(body, stop, depth + 1);
      } else if (kind === "mvhd") {
        const v1 = bytes[body] === 1;
        if (!has(v1 ? 32 : 20)) throw BROKEN;
        found.movie = v1
          ? { scale: u32(body + 20), duration: u64(body + 24) }
          : { scale: u32(body + 12), duration: u32(body + 16) };
      } else if (kind === "tkhd" && track) {
        const v1 = bytes[body] === 1;
        if (!has(v1 ? 36 : 24)) throw BROKEN;
        const duration = v1 ? u64(body + 28) : u32(body + 20);
        // All ones means "unknown".
        const unknown = v1 ? duration >= 2 ** 64 - 1 : duration === 0xffffffff;
        track.header = unknown ? null : duration;
      } else if (kind === "mdhd" && track) {
        const v1 = bytes[body] === 1;
        if (!has(v1 ? 32 : 20)) throw BROKEN;
        mediaScale = v1 ? u32(body + 20) : u32(body + 12);
        const duration = v1 ? u64(body + 24) : u32(body + 16);
        track.media = mediaScale > 0 ? duration / mediaScale : null;
      } else if (kind === "stts" && track) {
        if (!has(8)) throw BROKEN;
        const entries = u32(body + 4);
        if (!has(8 + entries * 8)) throw BROKEN;
        let ticks = 0;
        let count = 0;
        for (let entry = 0; entry < entries; entry++) {
          const samples = u32(body + 8 + entry * 8);
          count += samples;
          ticks += samples * u32(body + 12 + entry * 8);
        }
        track.timedSamples = count;
        // The track's time scale comes from `mdhd`, which precedes `minf`.
        track.samples = mediaScale > 0 ? ticks / mediaScale : null;
      } else if (kind === "stsz" && track) {
        if (!has(12)) throw BROKEN;
        track.sizedSamples = u32(body + 8);
      }
      at = stop;
    }
  };
  try {
    walk(0, bytes.byteLength, 0);
  } catch (error) {
    if (error === BROKEN) return null;
    throw error;
  }
  return sawMoov ? found : null;
}

export type RecordingLength = { seconds: number } | { refusal: string };

/**
 * How long a Recording is, read from every box that declares it, or why its
 * length is not trusted. The movie header (`mvhd`) alone is one number a file
 * can set to anything, so this also reads each track's header (`tkhd`), its
 * media header (`mdhd`) and its sample table (`stts`), each in its own time
 * scale, and takes the longest. It refuses a file whose movie header and
 * longest track disagree by more than the tolerance, whose sample tables
 * disagree on the number of samples, that is fragmented (its samples live in
 * fragments this does not read), or whose length implies a bitrate under
 * `MIN_RECORDING_BITS_PER_SECOND`.
 */
export function recordingLength(bytes: Uint8Array): RecordingLength {
  const unreadable = {
    refusal: "The Recording's length cannot be read; upload an MP4 or MOV.",
  };
  const boxes = readBoxes(bytes);
  if (!boxes) return unreadable;
  if (boxes.fragmented) {
    return {
      refusal:
        "The Recording is a fragmented MP4, whose length cannot be checked; export it as a regular MP4 or MOV.",
    };
  }
  const positive = (value: number | null): value is number =>
    value !== null && Number.isFinite(value) && value > 0;
  const movieScale = boxes.movie?.scale ?? 0;
  const movie =
    boxes.movie && movieScale > 0 && boxes.movie.duration > 0
      ? boxes.movie.duration / movieScale
      : null;
  const trackLengths: number[] = [];
  for (const track of boxes.tracks) {
    if (
      track.timedSamples !== null &&
      track.sizedSamples !== null &&
      track.timedSamples !== track.sizedSamples
    ) {
      return {
        refusal:
          "The Recording's sample tables disagree, so its length cannot be trusted.",
      };
    }
    const header =
      track.header !== null && movieScale > 0
        ? track.header / movieScale
        : null;
    trackLengths.push(...[header, track.media, track.samples].filter(positive));
  }
  const declared = [movie, ...trackLengths].filter(positive);
  if (declared.length === 0) return unreadable;
  const seconds = Math.max(...declared);
  if (movie !== null && trackLengths.length > 0) {
    const longestTrack = Math.max(...trackLengths);
    const tolerance = Math.max(
      LENGTH_TOLERANCE.seconds,
      LENGTH_TOLERANCE.share * longestTrack,
    );
    if (Math.abs(movie - longestTrack) > tolerance) {
      return {
        refusal:
          "The Recording's headers disagree about how long it is, so its length cannot be trusted.",
      };
    }
  }
  if ((bytes.byteLength * 8) / seconds < MIN_RECORDING_BITS_PER_SECOND) {
    return {
      refusal:
        "The Recording is too small for the length it declares, so its length cannot be trusted.",
    };
  }
  return { seconds };
}
