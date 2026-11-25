/**
 * The Drawing grammar, `vellum.drawing/1`: what the Draftsman may answer with.
 *
 * A Drawing is data, never markup. The model fills `modelDrawingSchema` (kept
 * loose so a strict structured-output mode accepts it), and `sanitizeDrawing`
 * turns whatever came back into a `Drawing` this app can trust: colours are
 * six-digit hex, every number is finite and clamped to the Sheet, text is
 * bounded. The page and the Ruler only ever see a sanitized Drawing.
 */
import { z } from "zod";

export const DRAWING_VERSION = "vellum.drawing/1";

/** Every Sheet is this many units wide; its height follows the screenshot. */
export const SHEET_WIDTH = 1000;

export const FAMILIES = ["sans", "serif", "mono"] as const;
export type Family = (typeof FAMILIES)[number];

export const ALIGNS = ["left", "center", "right"] as const;
export type Align = (typeof ALIGNS)[number];

/** The CSS font stacks each family is drawn with, on the page and in the Ruler's raster alike. */
export const FONT_STACKS: Record<Family, string> = {
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: "ui-monospace, Menlo, Consolas, monospace",
};

// The model's side: loose types, every field required (strict mode), nulls allowed.

const swatchSchema = z.object({
  hex: z.string().describe("#rrggbb"),
  role: z.string().describe("What the colour is for, in two or three words"),
});

const typeStepSchema = z.object({
  size: z.number().describe("Font size in Sheet units"),
  weight: z.number().describe("100 to 900"),
  family: z.enum(FAMILIES),
  role: z.string().describe("e.g. headline, body, label"),
});

const boxSchema = z.object({
  kind: z.literal("box"),
  id: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  fill: z.string().nullable().describe("#rrggbb or null for none"),
  stroke: z.string().nullable().describe("#rrggbb or null for none"),
  strokeWidth: z.number(),
  radius: z.number(),
  rotate: z
    .number()
    .describe("Degrees clockwise about the mark's centre, usually 0"),
});

const ellipseSchema = z.object({
  kind: z.literal("ellipse"),
  id: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  fill: z.string().nullable(),
  stroke: z.string().nullable(),
  strokeWidth: z.number(),
  rotate: z
    .number()
    .describe("Degrees clockwise about the mark's centre, usually 0"),
});

const lineSchema = z.object({
  kind: z.literal("line"),
  id: z.string(),
  x1: z.number(),
  y1: z.number(),
  x2: z.number(),
  y2: z.number(),
  color: z.string(),
  width: z.number(),
});

const textSchema = z.object({
  kind: z.literal("text"),
  id: z.string(),
  x: z
    .number()
    .describe("Left edge for left, centre for center, right edge for right"),
  y: z.number().describe("Top of the line box"),
  text: z.string().describe("One visual line, exactly as shown"),
  size: z.number(),
  weight: z.number(),
  color: z.string(),
  align: z.enum(ALIGNS),
  family: z.enum(FAMILIES),
  italic: z.boolean(),
  letterSpacing: z
    .number()
    .describe("Extra space between letters in Sheet units, usually 0"),
  rotate: z
    .number()
    .describe("Degrees clockwise about the mark's centre, usually 0"),
});

export const modelMarkSchema = z.discriminatedUnion("kind", [
  boxSchema,
  ellipseSchema,
  lineSchema,
  textSchema,
]);

export const modelDrawingSchema = z.object({
  palette: z
    .array(swatchSchema)
    .describe("The screen's colours, most used first, 3 to 10 of them"),
  typeScale: z
    .array(typeStepSchema)
    .describe("The distinct text styles, largest first"),
  background: z.string().describe("#rrggbb of the page behind everything"),
  marks: z
    .array(modelMarkSchema)
    .describe("Every shape and line of text, painted in order: back to front"),
});

export type ModelDrawing = z.infer<typeof modelDrawingSchema>;
export type ModelMark = z.infer<typeof modelMarkSchema>;

// The app's side: what a sanitized Drawing holds.

export type Swatch = { hex: string; role: string };
export type TypeStep = {
  size: number;
  weight: number;
  family: Family;
  role: string;
};

export type BoxMark = {
  kind: "box";
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  radius: number;
  rotate: number;
};
export type EllipseMark = {
  kind: "ellipse";
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  rotate: number;
};
export type LineMark = {
  kind: "line";
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
};
export type TextMark = {
  kind: "text";
  id: string;
  x: number;
  y: number;
  text: string;
  size: number;
  weight: number;
  color: string;
  align: Align;
  family: Family;
  italic: boolean;
  letterSpacing: number;
  rotate: number;
};
export type Mark = BoxMark | EllipseMark | LineMark | TextMark;
export type MarkKind = Mark["kind"];

export type Drawing = {
  version: typeof DRAWING_VERSION;
  width: number;
  height: number;
  palette: Swatch[];
  typeScale: TypeStep[];
  background: string;
  marks: Mark[];
};

export const DRAWING_LIMITS = {
  marks: 600,
  palette: 12,
  typeScale: 12,
  textLength: 200,
  roleLength: 40,
  idLength: 40,
  /** How far outside the Sheet a mark may start, in units. */
  bleed: 50,
} as const;

/** The Sheet's height for a screenshot of this size. */
export function sheetHeight(pixelWidth: number, pixelHeight: number) {
  if (!(pixelWidth > 0) || !(pixelHeight > 0)) return SHEET_WIDTH;
  return Math.max(
    100,
    Math.min(4000, Math.round((SHEET_WIDTH * pixelHeight) / pixelWidth)),
  );
}

const HEX = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i;

/** A colour as `#rrggbb`, or `null` when it is not one. */
export function cleanHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = HEX.exec(value.trim());
  if (!match?.[1]) return null;
  const digits =
    match[1].length === 3
      ? [...match[1]].map((digit) => digit + digit).join("")
      : match[1];
  return `#${digits.toLowerCase()}`;
}

const finite = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

/** Rounded to a tenth of a unit: enough for a Sheet, and short in JSON. */
const tenth = (value: number) => Math.round(value * 10) / 10;

const cleanText = (value: unknown, max: number) =>
  typeof value === "string"
    ? // Control characters would only confuse the raster; the text is drawn as text, never parsed.
      // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point.
      value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max)
    : "";

const cleanId = (value: unknown, index: number) => {
  const id = cleanText(value, DRAWING_LIMITS.idLength).replace(
    /[^a-zA-Z0-9_-]/g,
    "",
  );
  return id || `m${index}`;
};

const cleanWeight = (value: unknown) =>
  Math.round(clamp(finite(value, 400), 100, 900) / 100) * 100;

/** Degrees in -180..180, to a tenth. */
const cleanRotate = (value: unknown) => {
  const turned = (((finite(value) % 360) + 540) % 360) - 180;
  return tenth(Math.abs(turned) < 0.05 ? 0 : turned);
};

const oneOf = <T extends string>(
  allowed: readonly T[],
  value: unknown,
  fallback: T,
): T => (allowed.includes(value as T) ? (value as T) : fallback);

type Bounds = { width: number; height: number };

function cleanMark(raw: unknown, index: number, sheet: Bounds): Mark | null {
  if (typeof raw !== "object" || raw === null) return null;
  const mark = raw as Record<string, unknown>;
  const { bleed } = DRAWING_LIMITS;
  const x = (value: unknown) =>
    tenth(clamp(finite(value), -bleed, sheet.width + bleed));
  const y = (value: unknown) =>
    tenth(clamp(finite(value), -bleed, sheet.height + bleed));
  const size = (value: unknown, max: number) =>
    tenth(clamp(finite(value), 0, max));
  const id = cleanId(mark.id, index);

  switch (mark.kind) {
    case "box":
    case "ellipse": {
      const fill = cleanHex(mark.fill);
      const stroke = cleanHex(mark.stroke);
      if (!fill && !stroke) return null;
      const base = {
        id,
        x: x(mark.x),
        y: y(mark.y),
        w: size(mark.w, sheet.width + 2 * bleed),
        h: size(mark.h, sheet.height + 2 * bleed),
        fill,
        stroke,
        strokeWidth: stroke
          ? tenth(clamp(finite(mark.strokeWidth, 1), 0, 40))
          : 0,
        rotate: cleanRotate(mark.rotate),
      };
      if (base.w <= 0 || base.h <= 0) return null;
      if (mark.kind === "ellipse") return { kind: "ellipse", ...base };
      return {
        kind: "box",
        ...base,
        radius: tenth(
          clamp(finite(mark.radius), 0, Math.min(base.w, base.h) / 2),
        ),
      };
    }
    case "line": {
      const color = cleanHex(mark.color);
      if (!color) return null;
      return {
        kind: "line",
        id,
        x1: x(mark.x1),
        y1: y(mark.y1),
        x2: x(mark.x2),
        y2: y(mark.y2),
        color,
        width: tenth(clamp(finite(mark.width, 1), 0.5, 40)),
      };
    }
    case "text": {
      const text = cleanText(mark.text, DRAWING_LIMITS.textLength);
      if (!text.trim()) return null;
      return {
        kind: "text",
        id,
        x: x(mark.x),
        y: y(mark.y),
        text,
        size: tenth(clamp(finite(mark.size, 16), 4, 400)),
        weight: cleanWeight(mark.weight),
        color: cleanHex(mark.color) ?? "#000000",
        align: oneOf(ALIGNS, mark.align, "left"),
        family: oneOf(FAMILIES, mark.family, "sans"),
        italic: mark.italic === true,
        letterSpacing: tenth(clamp(finite(mark.letterSpacing), -5, 40)),
        rotate: cleanRotate(mark.rotate),
      };
    }
    default:
      return null;
  }
}

/**
 * Whatever the model sent (whole, or a part of a stream), as a Drawing the app
 * can draw. Marks that cannot be drawn are dropped; ids are made unique.
 */
export function sanitizeDrawing(raw: unknown, sheet: Bounds): Drawing {
  const source =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>)
      : {};
  const palette: Swatch[] = [];
  for (const swatch of Array.isArray(source.palette) ? source.palette : []) {
    const hex = cleanHex((swatch as Swatch | null)?.hex);
    if (!hex || palette.some((known) => known.hex === hex)) continue;
    palette.push({
      hex,
      role: cleanText((swatch as Swatch).role, DRAWING_LIMITS.roleLength),
    });
    if (palette.length >= DRAWING_LIMITS.palette) break;
  }
  const typeScale: TypeStep[] = [];
  for (const step of Array.isArray(source.typeScale) ? source.typeScale : []) {
    if (typeof step !== "object" || step === null) continue;
    const value = step as Record<string, unknown>;
    typeScale.push({
      size: tenth(clamp(finite(value.size, 16), 4, 400)),
      weight: cleanWeight(value.weight),
      family: oneOf(FAMILIES, value.family, "sans"),
      role: cleanText(value.role, DRAWING_LIMITS.roleLength),
    });
    if (typeScale.length >= DRAWING_LIMITS.typeScale) break;
  }
  const marks: Mark[] = [];
  const seen = new Set<string>();
  const rawMarks = Array.isArray(source.marks) ? source.marks : [];
  for (const [index, raw] of rawMarks.entries()) {
    const mark = cleanMark(raw, index, sheet);
    if (!mark) continue;
    let id = mark.id;
    for (let n = 2; seen.has(id); n++) id = `${mark.id}-${n}`;
    seen.add(id);
    marks.push({ ...mark, id });
    if (marks.length >= DRAWING_LIMITS.marks) break;
  }
  return {
    version: DRAWING_VERSION,
    width: sheet.width,
    height: sheet.height,
    palette,
    typeScale,
    background: cleanHex(source.background) ?? "#ffffff",
    marks,
  };
}

/** One mark, sanitized on its own: for marks that arrive one at a time from a stream. */
export function sanitizeMark(
  raw: unknown,
  index: number,
  sheet: Bounds,
): Mark | null {
  return cleanMark(raw, index, sheet);
}

/** Where the baseline of a text mark sits: its line box top plus most of its size. */
export const textBaseline = (mark: TextMark) => mark.y + mark.size * 0.8;

export const TEXT_ANCHOR: Record<Align, "start" | "middle" | "end"> = {
  left: "start",
  center: "middle",
  right: "end",
};

/** How many marks of each kind a Drawing has. */
export function countMarks(marks: readonly Mark[]) {
  const counts: Record<MarkKind, number> = {
    box: 0,
    ellipse: 0,
    line: 0,
    text: 0,
  };
  for (const mark of marks) counts[mark.kind]++;
  return counts;
}

/** The SVG transform that turns a mark about its centre, or undefined when it is not turned. */
export function rotation(mark: Mark): string | undefined {
  if (mark.kind === "line" || mark.rotate === 0) return undefined;
  const { x, y } = markCentre(mark);
  return `rotate(${mark.rotate} ${tenth(x)} ${tenth(y)})`;
}

/** The centre of a mark, for the pen to travel to. */
export function markCentre(mark: Mark): { x: number; y: number } {
  switch (mark.kind) {
    case "line":
      return { x: (mark.x1 + mark.x2) / 2, y: (mark.y1 + mark.y2) / 2 };
    case "text":
      return { x: mark.x, y: mark.y + mark.size / 2 };
    default:
      return { x: mark.x + mark.w / 2, y: mark.y + mark.h / 2 };
  }
}
