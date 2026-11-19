import { describe, expect, it } from "vitest";
import {
  cleanHex,
  countMarks,
  DRAWING_LIMITS,
  modelDrawingSchema,
  rotation,
  sanitizeDrawing,
  sheetHeight,
} from "./drawing";
import { stubDrawing } from "./stub";
import { drawingToSvg, escapeXml } from "./svg";

const sheet = { width: 1000, height: 600 };

describe("the Drawing grammar", () => {
  it("sizes the Sheet from the screenshot", () => {
    expect(sheetHeight(1280, 720)).toBe(563);
    expect(sheetHeight(390, 844)).toBe(2164);
    expect(sheetHeight(0, 10)).toBe(1000);
  });

  it("reads colours only as hex", () => {
    expect(cleanHex("#ABCDEF")).toBe("#abcdef");
    expect(cleanHex("fff")).toBe("#ffffff");
    expect(cleanHex("red")).toBeNull();
    expect(cleanHex("#12345")).toBeNull();
    expect(cleanHex('#fff" onload="x')).toBeNull();
    expect(cleanHex(null)).toBeNull();
  });

  it("the stub is a valid model answer", () => {
    expect(modelDrawingSchema.safeParse(stubDrawing(600, 1)).success).toBe(
      true,
    );
  });

  it("drops what cannot be drawn and clamps what can", () => {
    const drawing = sanitizeDrawing(
      {
        palette: [
          { hex: "#FFF", role: "page" },
          { hex: "#fff", role: "dup" },
          { hex: "nope" },
        ],
        background: "javascript:alert(1)",
        marks: [
          {
            kind: "box",
            id: "a",
            x: -9999,
            y: 10,
            w: 50,
            h: 50,
            fill: "#000000",
            stroke: null,
            strokeWidth: 0,
            radius: 999,
            rotate: 0,
          },
          {
            kind: "box",
            id: "invisible",
            x: 0,
            y: 0,
            w: 10,
            h: 10,
            fill: null,
            stroke: null,
          },
          { kind: "box", id: "flat", x: 0, y: 0, w: 0, h: 10, fill: "#000" },
          {
            kind: "text",
            id: "a",
            x: 10,
            y: 10,
            text: "Hi\u0000 there",
            size: 9000,
            weight: 650,
            color: "blue",
            align: "middle",
            family: "comic",
          },
          { kind: "text", id: "empty", text: "   " },
          { kind: "script", id: "x" },
          {
            kind: "line",
            id: "l",
            x1: 0,
            y1: 0,
            x2: Number.NaN,
            y2: 5,
            color: "#123456",
            width: 0,
          },
          {
            kind: "ellipse",
            id: "e",
            x: 1,
            y: 1,
            w: 10,
            h: 10,
            fill: "#00ff00",
            rotate: 370,
          },
        ],
      },
      sheet,
    );
    expect(drawing.palette).toEqual([{ hex: "#ffffff", role: "page" }]);
    expect(drawing.background).toBe("#ffffff");
    expect(drawing.marks.map((mark) => mark.id)).toEqual([
      "a",
      "a-2",
      "l",
      "e",
    ]);
    const [box, text, line, ellipse] = drawing.marks;
    expect(box).toMatchObject({
      kind: "box",
      x: -DRAWING_LIMITS.bleed,
      radius: 25,
    });
    expect(text).toMatchObject({
      kind: "text",
      text: "Hi  there",
      size: 400,
      weight: 700,
      color: "#000000",
      align: "left",
      family: "sans",
    });
    expect(line).toMatchObject({ kind: "line", x2: 0, width: 0.5 });
    expect(ellipse).toMatchObject({ kind: "ellipse", rotate: 10 });
  });

  it("caps the number of marks", () => {
    const marks = Array.from(
      { length: DRAWING_LIMITS.marks + 50 },
      (_, index) => ({
        kind: "box",
        id: `b${index}`,
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        fill: "#000000",
      }),
    );
    expect(sanitizeDrawing({ marks }, sheet).marks).toHaveLength(
      DRAWING_LIMITS.marks,
    );
  });

  it("counts marks by kind and turns them about their centre", () => {
    const drawing = sanitizeDrawing(stubDrawing(600, 1), sheet);
    expect(countMarks(drawing.marks)).toEqual({
      box: 2,
      ellipse: 1,
      line: 1,
      text: 1,
    });
    const turned = sanitizeDrawing(
      {
        marks: [
          {
            kind: "box",
            id: "card",
            x: 0,
            y: 0,
            w: 100,
            h: 50,
            fill: "#ff0000",
            rotate: -6,
          },
        ],
      },
      sheet,
    ).marks[0];
    expect(turned && rotation(turned)).toBe("rotate(-6 50 25)");
  });
});

describe("the SVG of a Drawing", () => {
  it("escapes the model's text, so it can never become markup", () => {
    expect(escapeXml(`<script>"x"&'y'</script>`)).toBe(
      "&lt;script&gt;&quot;x&quot;&amp;&apos;y&apos;&lt;/script&gt;",
    );
    const drawing = sanitizeDrawing(
      {
        marks: [
          {
            kind: "text",
            id: "t",
            x: 0,
            y: 0,
            text: '</text><image href="x"/>',
            size: 10,
            weight: 400,
            color: "#000",
          },
        ],
      },
      sheet,
    );
    const svg = drawingToSvg(drawing);
    expect(svg).not.toContain("<image");
    expect(svg).toContain("&lt;/text&gt;&lt;image");
  });

  it("is sized by its scale and painted on its background", () => {
    const svg = drawingToSvg(sanitizeDrawing(stubDrawing(600, 1), sheet), 0.5);
    expect(svg).toMatch(
      /^<svg [^>]*width="500" height="300" viewBox="0 0 1000 600"/,
    );
    expect(svg).toContain('<rect width="1000" height="600" fill="#ffffff"/>');
  });
});
