import { describe, expect, it } from "vitest";
import { LIMITS } from "./limits";
import {
  displayName,
  mp4DurationSeconds,
  ownerPrefix,
  ownRecordingType,
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
