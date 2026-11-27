import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./env", () => ({
  env: {
    model: () => "test/model",
    reasoning: () => "low",
    aiGatewayApiKey: () => "",
  },
}));

import { stubDrawing } from "../domain/stub";
import { decodeImage, partialReporter, preparePass, runPass } from "./pass";

const PNG = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64")}`;
const sheet = { width: 1000, height: 563 };

describe("a Pass's images", () => {
  it("are decoded and checked against the type they claim", () => {
    expect(decodeImage(PNG).mediaType).toBe("image/png");
    const lying = `data:image/jpeg;base64,${PNG.split(",")[1]}`;
    expect(() => decodeImage(lying)).toThrow("isn't the image it says");
    const halfPng = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]).toString("base64")}`;
    expect(() => decodeImage(halfPng)).toThrow("isn't the image it says");
  });

  it("are all checked before anything is spent", () => {
    const base = {
      pass: 1,
      width: 1280,
      height: 720,
      screenshot: PNG,
      squared: PNG,
    };
    expect(preparePass(base).sheet).toEqual(sheet);
    expect(() =>
      preparePass({
        ...base,
        squared: "data:image/webp;base64,AAAAAAAAAAAAAAAA",
      }),
    ).toThrow();
  });
});

describe("the stream of a Pass", () => {
  it("reports each part once, and only when it is complete", () => {
    const report = partialReporter(sheet);
    const full = stubDrawing(563, 1);
    // Mid-palette: the last swatch may still be growing.
    expect(report({ palette: full.palette.slice(0, 2) }, false)).toEqual([
      { t: "swatch", swatch: full.palette[0] },
    ]);
    // The type scale has begun, so the palette is done.
    const next = report(
      { palette: full.palette, typeScale: [full.typeScale[0]] },
      false,
    );
    expect(next.map((event) => event.t)).toEqual(["swatch", "swatch"]);
    // Two marks in: only the first is complete; the background arrives with it.
    const marks = report({ ...full, marks: full.marks.slice(0, 2) }, false);
    expect(marks.map((event) => event.t)).toEqual([
      "type",
      "type",
      "background",
      "mark",
    ]);
    // The end flushes the rest, each once.
    const rest = report(full, true);
    expect(rest.filter((event) => event.t === "mark")).toHaveLength(
      full.marks.length - 1,
    );
    expect(report(full, true)).toEqual([]);
  });

  it("plays the stub with no model, ending with the whole Drawing", async () => {
    const prepared = preparePass({
      pass: 1,
      width: 1280,
      height: 720,
      screenshot: PNG,
      squared: PNG,
    });
    const events = [];
    for await (const event of runPass(prepared, {
      stub: true,
      signal: new AbortController().signal,
    }))
      events.push(event);
    expect(events[0]).toEqual({ t: "start", pass: 1, model: "stub" });
    const done = events.at(-1);
    expect(done?.t).toBe("done");
    if (done?.t === "done") expect(done.drawing.marks).toHaveLength(5);
    expect(events.filter((event) => event.t === "mark")).toHaveLength(5);
  });
});
