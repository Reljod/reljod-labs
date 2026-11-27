import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LIMITS } from "./limits";
import {
  displayName,
  MIN_RECORDING_BITS_PER_SECOND,
  mp4DurationSeconds,
  ownerPrefix,
  ownRecordingType,
  recordingLength,
  recordingPath,
  uploadProblem,
} from "./uploads";

const HOST = "host:11111111-2222-4333-8444-555555555555" as const;
const GUEST = "guest:99999999-2222-4333-8444-555555555555" as const;
const ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("recording paths", () => {
  it("builds the key from the Owner, a uuid and the declared type", () => {
    expect(recordingPath(HOST, "video/quicktime", ID)).toBe(
      `recordings/host-11111111-2222-4333-8444-555555555555/${ID}.mov`,
    );
    expect(ownerPrefix("e2e")).toBe("recordings/e2e");
  });

  it("accepts only the caller's own keys, in the exact shape", () => {
    const path = recordingPath(HOST, "video/mp4", ID);
    expect(ownRecordingType(HOST, path)).toBe("video/mp4");
    expect(ownRecordingType(GUEST, path)).toBeNull();
    for (const bad of [
      `${path}/../x.mp4`,
      `recordings/host-11111111-2222-4333-8444-555555555555/../guest-99999999-2222-4333-8444-555555555555/${ID}.mp4`,
      `recordings/host-11111111-2222-4333-8444-555555555555/${ID}.exe`,
      `recordings/host-11111111-2222-4333-8444-555555555555/${ID}.webm`,
      `recordings/guest-99999999-2222-4333-8444-555555555555/${ID}.mp4`,
      `recordings/host-11111111-2222-4333-8444-555555555555/../guest-99999999-2222-4333-8444-555555555555/${ID}.mp4`,
      `recordings/host-11111111-2222-4333-8444-555555555555/not-a-uuid.mp4`,
      `/${path}`,
      `${path}\n`,
    ]) {
      expect(ownRecordingType(HOST, bad)).toBeNull();
    }
  });
});

describe("uploadProblem", () => {
  it("accepts a video within the cap", () => {
    expect(
      uploadProblem({ name: "call.mp4", size: 1024, type: "video/mp4" }),
    ).toBeNull();
  });

  it("refuses other types, empty and oversized files", () => {
    expect(
      uploadProblem({ name: "a.mp4", size: 10, type: "application/pdf" }),
    ).toMatch(/MP4/);
    expect(
      uploadProblem({ name: "a.mp4", size: 0, type: "video/mp4" }),
    ).toMatch(/empty/);
    expect(
      uploadProblem({
        name: "a.mp4",
        size: LIMITS.uploadBytes + 1,
        type: "video/mp4",
      }),
    ).toMatch(/at most 18 MB/);
    expect(
      uploadProblem({ name: "a", size: Number.NaN, type: "video/mp4" }),
    ).toMatch(/empty/);
    expect(
      uploadProblem({ name: "a.webm", size: 10, type: "video/webm" }),
    ).toMatch(/MP4 or MOV/);
  });

  it("does not trust inherited keys as types", () => {
    expect(
      uploadProblem({ name: "a", size: 10, type: "constructor" }),
    ).not.toBeNull();
  });
});

describe("displayName", () => {
  it("strips control characters and caps the length", () => {
    expect(displayName("  my\u0000 call‮.mp4 ")).toBe("my call.mp4");
    expect(displayName("")).toBe("Recording");
    expect(displayName("x".repeat(300))).toHaveLength(120);
  });
});

function box(type: string, body: Uint8Array) {
  const out = new Uint8Array(8 + body.length);
  new DataView(out.buffer).setUint32(0, out.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(body, 8);
  return out;
}

function mvhd(scale: number, duration: number) {
  const body = new Uint8Array(100);
  const view = new DataView(body.buffer);
  view.setUint32(12, scale);
  view.setUint32(16, duration);
  return box("mvhd", body);
}

function join(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** A version 0 `tkhd` whose duration is in the movie's time scale. */
function tkhd(duration: number) {
  const body = new Uint8Array(84);
  new DataView(body.buffer).setUint32(20, duration);
  return box("tkhd", body);
}

function mdhd(scale: number, duration: number) {
  const body = new Uint8Array(24);
  const view = new DataView(body.buffer);
  view.setUint32(12, scale);
  view.setUint32(16, duration);
  return box("mdhd", body);
}

/** One run of `count` samples, each `delta` ticks long. */
function stts(count: number, delta: number) {
  const body = new Uint8Array(16);
  const view = new DataView(body.buffer);
  view.setUint32(4, 1);
  view.setUint32(8, count);
  view.setUint32(12, delta);
  return box("stts", body);
}

function stsz(count: number) {
  const body = new Uint8Array(12);
  new DataView(body.buffer).setUint32(8, count);
  return box("stsz", body);
}

/** A track `seconds` long by every header, unless a part says otherwise. */
function trak(input: {
  header: number;
  mediaScale: number;
  media: number;
  samples: number;
  delta: number;
  sized?: number;
}) {
  return box(
    "trak",
    join(
      tkhd(input.header),
      box(
        "mdia",
        join(
          mdhd(input.mediaScale, input.media),
          box(
            "minf",
            box(
              "stbl",
              join(
                stts(input.samples, input.delta),
                stsz(input.sized ?? input.samples),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

/** A 1 MB file: `ftyp`, the `moov` and enough `mdat` for a real bitrate. */
function movie(...children: Uint8Array[]) {
  return join(
    box("ftyp", new Uint8Array(16)),
    box("moov", join(...children)),
    box("mdat", new Uint8Array(1024 * 1024)),
  );
}

/** A 60 s video track at 30 fps in a 90 kHz time scale; the movie scale is 1000. */
const honestTrack = {
  header: 60_000,
  mediaScale: 90_000,
  media: 60 * 90_000,
  samples: 1800,
  delta: 3000,
};

describe("recordingLength", () => {
  it("reads a file whose headers agree", () => {
    expect(
      recordingLength(movie(mvhd(1000, 60_000), trak(honestTrack))),
    ).toEqual({ seconds: 60 });
  });

  it("refuses boxes nested past any real MP4's depth, without overflowing the stack", () => {
    let nested = trak(honestTrack);
    for (let level = 0; level < 20_000; level++) nested = box("edts", nested);
    const length = recordingLength(
      movie(mvhd(1000, 60_000), box("trak", nested)),
    );
    expect(length).toEqual({ refusal: expect.any(String) });
  });

  it("takes the longest declared length, within the tolerance", () => {
    const length = recordingLength(
      movie(mvhd(1000, 60_000), trak({ ...honestTrack, header: 61_000 })),
    );
    expect(length).toEqual({ seconds: 61 });
  });

  it("refuses a movie header that understates its tracks", () => {
    // Says 1 minute; the track runs 20.
    const length = recordingLength(
      movie(
        mvhd(1000, 60_000),
        trak({
          header: 1_200_000,
          mediaScale: 90_000,
          media: 1200 * 90_000,
          samples: 36_000,
          delta: 3000,
        }),
      ),
    );
    expect(length).toEqual({ refusal: expect.stringMatching(/disagree/) });
  });

  it("counts the sample table even when every header understates it", () => {
    // Every header says 60 s, but 20 minutes of samples are timed.
    const length = recordingLength(
      movie(
        mvhd(1000, 60_000),
        trak({ ...honestTrack, samples: 36_000, sized: 36_000 }),
      ),
    );
    expect(length).toEqual({ refusal: expect.stringMatching(/disagree/) });
  });

  it("refuses sample tables that disagree on the number of samples", () => {
    const length = recordingLength(
      movie(mvhd(1000, 60_000), trak({ ...honestTrack, sized: 36_000 })),
    );
    expect(length).toEqual({ refusal: expect.stringMatching(/sample tables/) });
  });

  it("refuses a fragmented MP4", () => {
    const length = recordingLength(
      join(
        movie(
          mvhd(1000, 60_000),
          trak(honestTrack),
          box("mvex", new Uint8Array(8)),
        ),
        box("moof", new Uint8Array(8)),
      ),
    );
    expect(length).toEqual({ refusal: expect.stringMatching(/fragmented/) });
  });

  it("refuses a length the file is too small to hold", () => {
    // 60 s in a 1 kB file is about 140 bit/s.
    const tiny = join(
      box("ftyp", new Uint8Array(16)),
      box("moov", join(mvhd(1000, 60_000), trak(honestTrack))),
      box("mdat", new Uint8Array(512)),
    );
    expect(tiny.byteLength * 8).toBeLessThan(
      60 * MIN_RECORDING_BITS_PER_SECOND,
    );
    expect(recordingLength(tiny)).toEqual({
      refusal: expect.stringMatching(/too small/),
    });
  });

  it("refuses a file with no movie box or no length", () => {
    expect(recordingLength(new Uint8Array([1, 2, 3]))).toEqual({
      refusal: expect.stringMatching(/cannot be read/),
    });
    expect(recordingLength(movie(mvhd(1000, 0)))).toEqual({
      refusal: expect.stringMatching(/cannot be read/),
    });
  });

  it("accepts every shipped sample Recording", () => {
    const folder = path.join(process.cwd(), "public/process-transfer/samples");
    const videos = readdirSync(folder).filter((name) => name.endsWith(".mp4"));
    expect(videos.length).toBeGreaterThan(0);
    for (const name of videos) {
      const bytes = new Uint8Array(readFileSync(path.join(folder, name)));
      const length = recordingLength(bytes);
      expect(length, name).toHaveProperty("seconds");
      const seconds = (length as { seconds: number }).seconds;
      expect(seconds, name).toBeCloseTo(mp4DurationSeconds(bytes) ?? 0, 0);
    }
  });
});

describe("mp4DurationSeconds", () => {
  it("reads the movie header", () => {
    const ftyp = box("ftyp", new Uint8Array(16));
    const moov = box("moov", mvhd(1000, 95_500));
    const file = new Uint8Array(ftyp.length + moov.length);
    file.set(ftyp);
    file.set(moov, ftyp.length);
    expect(mp4DurationSeconds(file)).toBe(95.5);
  });

  it("gives up on a zero duration (fragmented MP4) or a zero time scale", () => {
    expect(mp4DurationSeconds(box("moov", mvhd(1000, 0)))).toBeNull();
    expect(mp4DurationSeconds(box("moov", mvhd(0, 5000)))).toBeNull();
  });

  it("gives up on anything else", () => {
    expect(mp4DurationSeconds(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(mp4DurationSeconds(box("free", new Uint8Array(4)))).toBeNull();
  });
});
