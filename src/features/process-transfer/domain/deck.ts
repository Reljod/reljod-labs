import { z } from "zod";

/*
 * A Deck in two forms. The Deck plan is what a model writes: slides as words.
 * The Deck is the plan laid out: every element with a position, a size and an
 * entrance. The preview in the browser, the Checks and the PPTX file are all
 * made from the same Deck, so what was checked is what is downloaded.
 *
 * Geometry is in slide pixels on a 1280 x 720 canvas (16:9). One slide pixel
 * is 9525 EMU in the PPTX.
 */

export const SLIDE_W = 1280;
export const SLIDE_H = 720;
export const EMU_PER_PX = 9525;

export const SLIDE_KINDS = [
  "title",
  "overview",
  "roles",
  "step",
  "decision",
  "exceptions",
  "summary",
  "questions",
] as const;
export type SlideKind = (typeof SLIDE_KINDS)[number];

export const slidePlanSchema = z.object({
  id: z.string().describe("p1, p2, ... in order"),
  kind: z.enum(SLIDE_KINDS),
  title: z.string(),
  subtitle: z.string().nullable(),
  bullets: z.array(z.string()),
  stepId: z
    .string()
    .nullable()
    .describe("The Process step a 'step' or 'decision' slide shows, else null"),
  notes: z.string().describe("Speaker notes: what to say on this slide"),
});
export type SlidePlan = z.infer<typeof slidePlanSchema>;

export const deckPlanSchema = z.object({
  title: z.string(),
  slides: z.array(slidePlanSchema),
});
export type DeckPlan = z.infer<typeof deckPlanSchema>;

/** How an element arrives on its slide. */
export type Animation = {
  effect: "fade" | "wipe" | "rise" | "zoom";
  /** `click` waits for the presenter; `after` follows the one before; `with` starts alongside it. */
  trigger: "click" | "after" | "with";
  /** 1-based, the order elements arrive in on their slide. */
  order: number;
  durationMs: number;
  delayMs: number;
};

export type ElementRole =
  | "title"
  | "subtitle"
  | "body"
  | "number"
  | "label"
  | "callout"
  | "screenshot"
  | "footer"
  | "decoration";

type ElementBase = {
  id: string;
  role: ElementRole;
  x: number;
  y: number;
  w: number;
  h: number;
  animation: Animation | null;
};

export type TextRun = { text: string; bold?: boolean; color?: string };
export type Paragraph = {
  runs: TextRun[];
  bullet?: boolean;
  level?: number;
  /** Extra space above the paragraph, slide pixels; ignored on the first. */
  gapBefore?: number;
};

export type TextElement = ElementBase & {
  type: "text";
  paragraphs: Paragraph[];
  /** Points, as PowerPoint counts them. */
  fontSize: number;
  font: "heading" | "body" | "mono";
  /** `#rrggbb` */
  color: string;
  align: "left" | "center" | "right";
  valign: "top" | "middle" | "bottom";
  /** Line height as a multiple of the font size. */
  lineHeight: number;
  /** Inner margin on every side, slide pixels. */
  padding: number;
  fill: string | null;
};

export type ShapeElement = ElementBase & {
  type: "shape";
  shape: "rect" | "roundRect" | "ellipse" | "line" | "chevron";
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
};

/** A frame of the Recording, captured in the browser at `frameAt` seconds. */
export type ImageElement = ElementBase & {
  type: "image";
  frameAt: number;
  alt: string;
};

export type SlideElement = TextElement | ShapeElement | ImageElement;

export type Transition = {
  type: "fade" | "push" | "wipe" | "none";
  durationMs: number;
};

export type Slide = {
  id: string;
  /** The Deck plan slide this was laid out from. */
  planId: string;
  kind: SlideKind;
  stepId: string | null;
  background: string;
  transition: Transition;
  /** Back to front. */
  elements: SlideElement[];
  notes: string;
};

export type DeckTheme = {
  fonts: { heading: string; body: string; mono: string };
  colors: {
    background: string;
    surface: string;
    ink: string;
    muted: string;
    accent: string;
    accentSoft: string;
    highlight: string;
    warn: string;
  };
};

export type Deck = {
  title: string;
  theme: DeckTheme;
  slides: Slide[];
};
