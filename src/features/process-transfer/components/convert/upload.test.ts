import { describe, expect, it } from "vitest";
import { durationProblem, fileProblem, videoType } from "./upload";

const limits = { uploadBytes: 18 * 1024 * 1024, uploadSeconds: 600 };

describe("videoType", () => {
  it("falls back to the extension when the browser gives no type", () => {
    expect(videoType({ name: "call.MOV", type: "" })).toBe("video/quicktime");
    expect(videoType({ name: "call.mp4", type: "video/mp4" })).toBe(
      "video/mp4",
    );
    expect(videoType({ name: "notes.txt", type: "" })).toBe("");
  });
});

describe("fileProblem", () => {
  it("refuses other types, empty files and files over the cap", () => {
    expect(
      fileProblem({ name: "a.pdf", type: "application/pdf", size: 10 }, limits),
    ).toBe("Choose an MP4 or MOV video.");
    expect(
      fileProblem({ name: "a.mp4", type: "video/mp4", size: 0 }, limits),
    ).toBe("That file is empty.");
    expect(
      fileProblem(
        { name: "a.mp4", type: "video/mp4", size: 20 * 1024 * 1024 },
        limits,
      ),
    ).toBe("That file is 20.0 MB; a Recording may be at most 18.0 MB.");
    expect(
      fileProblem({ name: "a.webm", type: "video/webm", size: 1024 }, limits),
    ).toBe("Choose an MP4 or MOV video.");
  });
});

describe("durationProblem", () => {
  it("refuses long calls and lets an unreadable length through to the server", () => {
    expect(durationProblem(601, limits)).toBe(
      "That Recording is 10 m 1 s long; the demo takes calls up to 10 m.",
    );
    expect(durationProblem(300, limits)).toBeNull();
    expect(durationProblem(null, limits)).toBeNull();
  });
});
