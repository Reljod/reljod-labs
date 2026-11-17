import type { Paragraph, TextElement } from "./deck";

/*
 * How text wraps, estimated without a browser or PowerPoint. The layout uses
 * it to size boxes and the Checks use the same function to decide whether a
 * box holds its text, so the two can never disagree. Widths come from Arial's
 * advance table (1000 units per em); Georgia is wider, so headings are scaled
 * up, and every estimate is padded so that "fits" here means it fits in
 * PowerPoint with room to spare.
 */

const ARIAL: Record<string, number> = {};
const ARIAL_BOLD: Record<string, number> = {};

function table(
  target: Record<string, number>,
  chars: string,
  widths: number[],
) {
  [...chars].forEach((char, index) => {
    target[char] = widths[index];
  });
}

table(
  ARIAL,
  "abcdefghijklmnopqrstuvwxyz",
  [
    556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
    556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500,
  ],
);
table(
  ARIAL,
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  [
    667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
  ],
);
table(
  ARIAL,
  " !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~",
  [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278,
    278, 278, 278, 584, 584, 584, 556, 1015, 278, 278, 278, 469, 556, 333, 334,
    260, 334, 584,
  ],
);
table(
  ARIAL_BOLD,
  "abcdefghijklmnopqrstuvwxyz",
  [
    556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
    611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500,
  ],
);
table(
  ARIAL_BOLD,
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  [
    722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
  ],
);
table(
  ARIAL_BOLD,
  " !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~",
  [
    278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278,
    278, 333, 333, 584, 584, 584, 611, 975, 333, 278, 333, 584, 556, 333, 389,
    280, 389, 584,
  ],
);
for (const target of [ARIAL, ARIAL_BOLD]) {
  for (const digit of "0123456789") target[digit] = 556;
  Object.assign(target, {
    "·": 278,
    "•": 350,
    "–": 556,
    "—": 1000,
    "…": 1000,
    "‘": 222,
    "’": 222,
    "“": 333,
    "”": 333,
    "■": 604,
    "→": 1000,
  });
}

/** Anything not in the table: wide, so an unknown glyph never under-counts. */
const UNKNOWN = 700;

/** Georgia runs wider than Arial; these scale Arial's table up to it. */
const HEADING_SCALE = { regular: 1.12, bold: 1.2 };
/** Consolas and its stand-ins are at most 0.6 em a glyph. */
const MONO_EM = 600;
/** Every estimate is padded by this much, so PowerPoint always has room. */
const SAFETY = 1.03;

export type FontRole = TextElement["font"];

/** Points to slide pixels: the slide is 13.33 in wide at 96 px an inch. */
export function ptToPx(pt: number): number {
  return (pt * 4) / 3;
}

/** The pitch of one line, slide pixels. */
export function linePx(fontSize: number, lineHeight: number): number {
  return ptToPx(fontSize) * lineHeight;
}

/** How far a bulleted paragraph is indented, slide pixels; the marker hangs in it. */
export function bulletIndent(fontSize: number): number {
  return Math.round(ptToPx(fontSize) * 1.1);
}

function charWidth(char: string, font: FontRole, bold: boolean): number {
  if (font === "mono") return MONO_EM;
  let width = (bold ? ARIAL_BOLD : ARIAL)[char];
  if (width === undefined) {
    // CJK and other full-width scripts take a whole em.
    width = (char.codePointAt(0) ?? 0) >= 0x2e80 ? 1000 : UNKNOWN;
  }
  if (font === "heading") {
    return width * (bold ? HEADING_SCALE.bold : HEADING_SCALE.regular);
  }
  return width;
}

type Glyph = { char: string; bold: boolean };

function glyphs(paragraph: Paragraph): Glyph[][] {
  // A newline inside a run breaks the line, as a vertical tab does in PowerPoint.
  const lines: Glyph[][] = [[]];
  for (const run of paragraph.runs) {
    for (const char of run.text) {
      if (char === "\n") lines.push([]);
      else lines[lines.length - 1].push({ char, bold: Boolean(run.bold) });
    }
  }
  return lines;
}

function wrapCount(
  line: Glyph[],
  font: FontRole,
  sizePx: number,
  maxWidth: number,
): number {
  const width = (glyph: Glyph) =>
    (charWidth(glyph.char, font, glyph.bold) / 1000) * sizePx * SAFETY;
  // Words with the space that follows them, as PowerPoint breaks them.
  const words: { width: number; space: number }[] = [];
  let current = { width: 0, space: 0 };
  let inSpace = false;
  for (const glyph of line) {
    if (glyph.char === " ") {
      current.space += width(glyph);
      inSpace = true;
    } else {
      if (inSpace) {
        words.push(current);
        current = { width: 0, space: 0 };
        inSpace = false;
      }
      current.width += width(glyph);
    }
  }
  words.push(current);
  let lines = 1;
  let used = 0;
  for (const word of words) {
    if (used > 0 && used + word.width > maxWidth) {
      lines += 1;
      used = 0;
    }
    if (used === 0 && word.width > maxWidth) {
      // A word longer than the line breaks mid-word.
      lines += Math.ceil(word.width / maxWidth) - 1;
      used = word.width % maxWidth;
    } else {
      used += word.width;
    }
    used += word.space;
  }
  return lines;
}

export type TextMeasure = {
  /** Lines each paragraph takes. */
  paragraphLines: number[];
  lines: number;
  /** The height the box needs, padding included, slide pixels. */
  height: number;
};

type Measurable = Pick<
  TextElement,
  "paragraphs" | "fontSize" | "font" | "lineHeight" | "padding" | "w"
>;

/** How many lines the text takes in a box `w` wide, and the height it needs. */
export function measureText(element: Measurable): TextMeasure {
  const sizePx = ptToPx(element.fontSize);
  const pitch = linePx(element.fontSize, element.lineHeight);
  const inner = element.w - 2 * element.padding - 2;
  const paragraphLines = element.paragraphs.map((paragraph) => {
    const indent = paragraph.bullet ? bulletIndent(element.fontSize) : 0;
    const room = Math.max(1, inner - indent);
    return glyphs(paragraph).reduce(
      (sum, line) => sum + wrapCount(line, element.font, sizePx, room),
      0,
    );
  });
  const lines = paragraphLines.reduce((sum, count) => sum + count, 0);
  const gaps = element.paragraphs.reduce(
    (sum, paragraph, index) =>
      sum + (index > 0 ? (paragraph.gapBefore ?? 0) : 0),
    0,
  );
  return {
    paragraphLines,
    lines,
    height: Math.ceil(lines * pitch + gaps + 2 * element.padding),
  };
}

/** How many lines of this element's text its box has room for. */
export function linesThatFit(element: Measurable & { h: number }): number {
  const gaps = element.paragraphs.reduce(
    (sum, paragraph, index) =>
      sum + (index > 0 ? (paragraph.gapBefore ?? 0) : 0),
    0,
  );
  const room = element.h - 2 * element.padding - gaps;
  return Math.max(
    0,
    Math.floor((room + 0.5) / linePx(element.fontSize, element.lineHeight)),
  );
}

/** The words of a text element, for messages and alt text. */
export function plainText(element: Pick<TextElement, "paragraphs">): string {
  return element.paragraphs
    .map((paragraph) => paragraph.runs.map((run) => run.text).join(""))
    .join(" ");
}
