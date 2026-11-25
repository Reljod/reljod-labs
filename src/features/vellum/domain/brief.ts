/**
 * What the Draftsman is told. Pure text builders, so a test can read them.
 * The visitor sends images and numbers; only this file writes words for the
 * model, so nothing a visitor types reaches it as an instruction.
 */
import type { Note } from "./api";
import { type Drawing, SHEET_WIDTH } from "./drawing";

export const INSTRUCTIONS = `You are the Draftsman. You redraw a screenshot of a screen as a vector Drawing, as exactly as you can, so that code can render it and measure it against the original pixel by pixel.

The Sheet:
- The Sheet is ${SHEET_WIDTH} units wide; its height is given. (0,0) is the top-left of the screenshot.
- You get the screenshot twice: clean, and "squared up" with a labelled grid every 100 units (fine lines every 50). Read positions and sizes off the grid. Measure; do not guess.

What to answer:
- palette: the screen's colours, most used first. Read exact hex values from the pixels.
- typeScale: every distinct text style, largest first, with its size in Sheet units.
- background: the colour behind everything.
- marks, painted in order, back to front: big panels and bars first, then cards, then their contents, then text on top.
  - box: x, y, w, h, fill and/or stroke, radius for rounded corners. Use boxes for panels, buttons, cards, bars, chips, dividers thicker than 3 units, and the cells of anything like a QR code.
  - ellipse: x, y, w, h of its bounding box. Use for circles, dots, avatars.
  - line: thin rules and dividers, chart lines.
  - text: ONE visual line per mark. y is the top of the line box, size is the font size in Sheet units (cap height is about 0.7 of it). Copy the words exactly, including case, punctuation and numbers. Choose family sans, serif or mono by the letterforms; weight 400 regular, 500 medium, 600 semibold, 700 bold, 800+ black. For align center, x is the centre; for right, x is the right edge.
- rotate: degrees clockwise about the mark's centre, for anything drawn at an angle (a tilted card and the text on it each get the same angle). 0 otherwise.
- Give every mark a short, stable id that says what it is (header-bg, title, btn-buy, qr-3-7).
- Icons and pictures: approximate them with a few boxes and ellipses in their main colours. Never skip a region: an empty area of the wrong colour costs more than a rough shape.

Be exhaustive and precise. Fonts are system fonts, so match size, weight and position rather than the exact face. Do not describe the screen in prose; answer only with the Drawing.`;

const r = (value: number) => Math.round(value);

/** The words that go with the images of a Pass. */
export function passBrief(input: {
  pass: number;
  sheetHeight: number;
  previous?: Drawing;
  likeness?: number;
  notes?: Note[];
}): string {
  const sheet = `The Sheet is ${SHEET_WIDTH} × ${input.sheetHeight} units.`;
  if (input.pass === 1 || !input.previous)
    return `${sheet}\n\nPass 1. Images: the screenshot, then the same screenshot squared up. Draw it.`;

  const notes = (input.notes ?? []).map(
    (note) =>
      `- x ${r(note.x)}–${r(note.x + note.w)}, y ${r(note.y)}–${r(note.y + note.h)}: the screenshot averages ${note.original} here, your Drawing ${note.drawn}; likeness ${Math.round(note.likeness * 100)}%.`,
  );
  const measured =
    input.likeness === undefined
      ? ""
      : ` The Ruler measured your last Drawing at ${Math.round(input.likeness * 100)}% likeness.`;
  return [
    sheet,
    "",
    `Pass ${input.pass}. Images: the screenshot, the screenshot squared up, then your last Drawing as code rendered it (same size).${measured}`,
    notes.length > 0
      ? `Where the Ruler found the biggest differences:\n${notes.join("\n")}`
      : "",
    "",
    "Your last Drawing, as JSON:",
    JSON.stringify({
      background: input.previous.background,
      marks: input.previous.marks,
    }),
    "",
    "Answer with a complete, corrected Drawing. Compare the rendering with the screenshot region by region: fix positions, sizes, colours, missing and extra marks. Keep the id of every mark you keep, so the change can be followed; give new marks new ids.",
  ]
    .filter((line, index, all) => line !== "" || all[index - 1] !== "")
    .join("\n");
}
