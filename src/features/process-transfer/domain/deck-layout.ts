import {
  type Animation,
  type Deck,
  type DeckPlan,
  type DeckTheme,
  type ImageElement,
  type Paragraph,
  type ShapeElement,
  SLIDE_H,
  SLIDE_W,
  type Slide,
  type SlideElement,
  type SlidePlan,
  type TextElement,
  type TextRun,
  type Transition,
} from "./deck";
import { linePx, measureText } from "./deck-text";
import { clock, type Process } from "./process";
import type { RuleSet } from "./rules";

export { linesThatFit, measureText, plainText } from "./deck-text";

/*
 * The layout engine: a Deck plan in words becomes a Deck with every element
 * placed on a 12-column grid inside the safe margin. One layout per slide
 * kind, a fixed type scale, one transition for the whole deck and entrances
 * in reading order.
 *
 * It never shrinks type. What does not fit on a slide continues on the next:
 * one plan slide may become several Deck slides sharing its `planId`, the
 * later ones marked "continued" in the kicker. Every gap comes from the
 * `layout.no-overlap` Parameter and no slide animates more than
 * `motion.budget` allows, so a plan inside the content Rules lays out without
 * failing a layout Rule. Two things still overflow and are left for the
 * Checks: a slide title longer than its two lines and a single bullet taller
 * than an empty slide. Words from the Process (a warning, a role, a branch)
 * that are taller than an empty slide on their own are cut at a word
 * boundary with an ellipsis, so the cut shows.
 */

/** The site's palette, in fonts every PowerPoint install has. */
export const DECK_THEME: DeckTheme = {
  fonts: { heading: "Georgia", body: "Arial", mono: "Consolas" },
  colors: {
    background: "#f5f1e8",
    surface: "#ffffff",
    ink: "#14213d",
    muted: "#4a4f5b",
    accent: "#1d4e89",
    accentSoft: "#d6e4f5",
    highlight: "#d9a84e",
    warn: "#b23a2b",
  },
};

/** The type scale, points. Nothing else is used. */
export const TYPE = {
  display: 44,
  title: 32,
  question: 24,
  number: 28,
  body: 20,
  card: 18,
  caption: 13,
  kicker: 12,
  footer: 11,
} as const;

const LEADING = { tight: 1.1, body: 1.3, label: 1.2 } as const;

/** One style for the whole deck, as Rule `motion.transition-on-every-slide` asks. */
export const DECK_TRANSITION: Transition = { type: "fade", durationMs: 500 };

const MIN_MARGIN = 64;
/** Animated elements per slide when Rule `motion.budget` is off. */
const DEFAULT_BUDGET = 7;
const ELLIPSIS = "…";

type Rect = { x: number; y: number; w: number; h: number };

export type Grid = {
  margin: number;
  /** The least space between two measured elements: the `layout.no-overlap` gap, never under 12 px. */
  gap: number;
  /** Left edge of a column, 0 to 11. */
  x: (col: number) => number;
  /** Width of `cols` columns with the gutters between them. */
  span: (cols: number) => number;
  right: number;
  kickerY: number;
  titleY: number;
  titleH: number;
  bodyTop: number;
  contentBottom: number;
  footerY: number;
  /** Spacing between list items, cards, a screenshot and its caption, and blocks. */
  space: { list: number; card: number; tight: number; block: number };
  /** Animated elements a slide may hold. */
  budget: number;
};

/**
 * The grid for the current Rules. The layout keeps at least a 64 px margin
 * even when the Rule asks for less, so a slide has air; a larger margin moves
 * everything in. Every space between elements is at least the overlap gap.
 */
export function deckGrid(rules: RuleSet): Grid {
  const param = (id: string, key: string) => {
    const rule = rules.get(id);
    return rule?.enabled ? rule.params[key] : undefined;
  };
  const margin = Math.max(MIN_MARGIN, param("layout.safe-area", "margin") ?? 0);
  const gap = Math.max(12, param("layout.no-overlap", "gap") ?? 0);
  const gutter = Math.max(24, gap);
  const col = (SLIDE_W - 2 * margin - 11 * gutter) / 12;
  const x = (index: number) => Math.round(margin + index * (col + gutter));
  const span = (cols: number) => Math.round(cols * col + (cols - 1) * gutter);
  const titleY = margin + 20 + Math.max(14, gap);
  const titleH = Math.ceil(2 * linePx(TYPE.title, LEADING.tight));
  const footerY = SLIDE_H - margin - 20;
  return {
    margin,
    gap,
    x,
    span,
    right: x(11) + span(1),
    kickerY: margin,
    titleY,
    titleH,
    bodyTop: titleY + titleH + Math.max(26, gap),
    contentBottom: footerY - Math.max(24, gap),
    footerY,
    space: {
      list: Math.max(14, gap),
      card: Math.max(16, gap),
      tight: Math.max(12, gap),
      block: Math.max(24, gap),
    },
    budget: param("motion.budget", "max") ?? DEFAULT_BUDGET,
  };
}

type TextStyle = {
  fontSize: number;
  font: TextElement["font"];
  color: string;
  lineHeight: number;
  align?: TextElement["align"];
  valign?: TextElement["valign"];
  padding?: number;
  fill?: string | null;
};

type Entrance = Omit<Animation, "order">;

const ENTER = {
  rise: (durationMs = 450): Entrance => ({
    effect: "rise",
    trigger: "after",
    durationMs,
    delayMs: 0,
  }),
  fade: (
    trigger: Animation["trigger"] = "after",
    durationMs = 500,
  ): Entrance => ({ effect: "fade", trigger, durationMs, delayMs: 0 }),
  wipe: (): Entrance => ({
    effect: "wipe",
    trigger: "after",
    durationMs: 500,
    delayMs: 0,
  }),
};

function run(text: string, extra: Omit<TextRun, "text"> = {}): TextRun {
  return { text, ...extra };
}

function para(runs: TextRun[] | string, extra: Omit<Paragraph, "runs"> = {}) {
  return {
    runs: typeof runs === "string" ? [run(runs)] : runs,
    ...extra,
  } satisfies Paragraph;
}

/** Collects one slide's elements, numbering them and their entrances. */
class SlideBuilder {
  readonly elements: SlideElement[] = [];
  private count = 0;
  private order = 0;

  constructor(readonly id: string) {}

  /** Entrances used so far. */
  get animated(): number {
    return this.order;
  }

  nextId(role: string) {
    this.count += 1;
    return `${this.id}-${role}-${this.count}`;
  }

  private animation(entrance: Entrance | null): Animation | null {
    if (!entrance) return null;
    this.order += 1;
    return { ...entrance, order: this.order };
  }

  text(
    role: TextElement["role"],
    rect: Rect,
    paragraphs: Paragraph[],
    style: TextStyle,
    entrance: Entrance | null = null,
  ): TextElement {
    const element: TextElement = {
      id: this.nextId(role),
      type: "text",
      role,
      ...rect,
      paragraphs,
      fontSize: style.fontSize,
      font: style.font,
      color: style.color,
      align: style.align ?? "left",
      valign: style.valign ?? "top",
      lineHeight: style.lineHeight,
      padding: style.padding ?? 0,
      fill: style.fill ?? null,
      animation: this.animation(entrance),
    };
    this.elements.push(element);
    return element;
  }

  shape(role: ShapeElement["role"], rect: Rect, fill: string): ShapeElement {
    const element: ShapeElement = {
      id: this.nextId(role),
      type: "shape",
      role,
      ...rect,
      shape: "rect",
      fill,
      stroke: null,
      strokeWidth: 0,
      animation: null,
    };
    this.elements.push(element);
    return element;
  }

  image(
    rect: Rect,
    frameAt: number,
    alt: string,
    entrance: Entrance,
  ): ImageElement {
    const element: ImageElement = {
      id: this.nextId("screenshot"),
      type: "image",
      role: "screenshot",
      ...rect,
      frameAt,
      alt,
      animation: this.animation(entrance),
    };
    this.elements.push(element);
    return element;
  }
}

/** The height a text block needs at width `w`. */
function fit(paragraphs: Paragraph[], style: TextStyle, w: number): number {
  return measureText({
    paragraphs,
    fontSize: style.fontSize,
    font: style.font,
    lineHeight: style.lineHeight,
    padding: style.padding ?? 0,
    w,
  }).height;
}

/** The height of `lines` lines of a style, padding included. */
function linesHigh(style: TextStyle, lines: number): number {
  return Math.ceil(
    lines * linePx(style.fontSize, style.lineHeight) + 2 * (style.padding ?? 0),
  );
}

/**
 * Words cut at a word boundary, with an ellipsis, so that `make(words)` is no
 * taller than `maxH`. Only for words the plan does not control.
 */
function clamp(
  text: string,
  make: (words: string) => Paragraph[],
  style: TextStyle,
  w: number,
  maxH: number,
): string {
  if (fit(make(text), style, w) <= maxH) return text;
  const words = text.split(/\s+/).filter(Boolean);
  const cut = (count: number) =>
    `${words
      .slice(0, Math.max(1, count))
      .join(" ")
      .replace(/[\s,;:.!?—–-]+$/, "")}${ELLIPSIS}`;
  let low = 1;
  let high = words.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (fit(make(cut(mid)), style, w) <= maxH) low = mid;
    else high = mid - 1;
  }
  return cut(low);
}

/** One slide of a plan slide, before its footer is added. */
type Draft = { b: SlideBuilder; plan: SlidePlan; footer: boolean };

type Context = {
  grid: Grid;
  theme: DeckTheme;
  process: Process;
  drafts: Draft[];
};

function styles(theme: DeckTheme) {
  const c = theme.colors;
  return {
    kicker: {
      fontSize: TYPE.kicker,
      font: "mono",
      color: c.accent,
      lineHeight: LEADING.label,
    },
    title: {
      fontSize: TYPE.title,
      font: "heading",
      color: c.ink,
      lineHeight: LEADING.tight,
    },
    lede: {
      fontSize: TYPE.body,
      font: "body",
      color: c.muted,
      lineHeight: LEADING.body,
    },
    body: {
      fontSize: TYPE.body,
      font: "body",
      color: c.ink,
      lineHeight: LEADING.body,
    },
    list: {
      fontSize: TYPE.card,
      font: "body",
      color: c.ink,
      lineHeight: LEADING.body,
    },
    card: {
      fontSize: TYPE.card,
      font: "body",
      color: c.ink,
      lineHeight: LEADING.body,
      padding: 20,
      fill: c.surface,
    },
    row: {
      fontSize: TYPE.body,
      font: "body",
      color: c.ink,
      lineHeight: LEADING.body,
      padding: 18,
      fill: c.surface,
    },
    caption: {
      fontSize: TYPE.caption,
      font: "body",
      color: c.muted,
      lineHeight: LEADING.label,
    },
    footer: {
      fontSize: TYPE.footer,
      font: "body",
      color: c.muted,
      lineHeight: LEADING.label,
    },
  } satisfies Record<string, TextStyle>;
}

const LEDE_LINES = 3;

/**
 * Starts a slide of a plan slide: kicker, title and, on the first, the
 * subtitle. A continuation says so in the kicker. Returns where the body starts.
 */
function page(
  ctx: Context,
  plan: SlidePlan,
  kicker: string,
  left: number,
  continued: boolean,
  number: string | null = null,
): { b: SlideBuilder; top: number } {
  const { grid, theme } = ctx;
  const s = styles(theme);
  const b = new SlideBuilder(`slide${ctx.drafts.length + 1}`);
  ctx.drafts.push({ b, plan, footer: true });
  const width = grid.right - left;
  if (number !== null) {
    b.text(
      "number",
      { x: grid.x(0), y: grid.kickerY, w: grid.span(1), h: grid.span(1) },
      [para(number)],
      {
        fontSize: TYPE.number,
        font: "heading",
        color: theme.colors.surface,
        lineHeight: 1,
        align: "center",
        valign: "middle",
        fill: theme.colors.accent,
      },
    );
  }
  const label = `${kicker}${continued ? "  ·  continued" : ""}`.toUpperCase();
  b.text(
    "label",
    { x: left, y: grid.kickerY, w: width, h: 20 },
    [para(clamp(label, (words) => [para(words)], s.kicker, width, 20))],
    s.kicker,
  );
  b.text(
    "title",
    { x: left, y: grid.titleY, w: width, h: grid.titleH },
    [para(plan.title)],
    s.title,
  );
  let top = grid.bodyTop;
  if (plan.subtitle && !continued) {
    // A subtitle is a lede: three lines at most, cut with an ellipsis after.
    const text = clamp(
      plan.subtitle,
      (words) => [para(words)],
      s.lede,
      width,
      linesHigh(s.lede, LEDE_LINES),
    );
    const paragraphs = [para(text)];
    const h = fit(paragraphs, s.lede, width);
    b.text("subtitle", { x: left, y: top, w: width, h }, paragraphs, s.lede);
    top += h + grid.space.block;
  }
  return { b, top };
}

/** Something that stacks down a column: its height, its entrances, and how to put it at `y`. */
type Item = {
  h: number;
  animated: number;
  place: (b: SlideBuilder, y: number) => void;
};

/** How many of `items` fit between `top` and `bottom`, `gap` apart, within `slots` entrances. */
function fitting(
  items: Item[],
  top: number,
  bottom: number,
  gap: number,
  slots: number,
): number {
  let y = top;
  let used = 0;
  let count = 0;
  for (const item of items) {
    if (y + item.h > bottom + 0.5 || used + item.animated > slots) break;
    y += item.h + gap;
    used += item.animated;
    count += 1;
  }
  return count;
}

/** Puts items down a column from `top`; returns the bottom of the last. */
function stack(
  b: SlideBuilder,
  items: Item[],
  top: number,
  gap: number,
): number {
  let y = top;
  for (const item of items) {
    item.place(b, y);
    y += item.h + gap;
  }
  return items.length > 0 ? y - gap : top;
}

/** A bullet as its own box, arriving on its own. */
function bulletItem(ctx: Context, text: string, x: number, w: number): Item {
  const s = styles(ctx.theme);
  const paragraphs = [para(text, { bullet: true })];
  const h = fit(paragraphs, s.body, w);
  return {
    h,
    animated: 1,
    place: (b, y) =>
      b.text("body", { x, y, w, h }, paragraphs, s.body, ENTER.rise()),
  };
}

/** Splits "Situation: handling" or "Situation — handling" into a bold head and the rest. */
function headAndRest(text: string): Paragraph[] {
  const match = text.match(/^(.{3,80}?)(?:\s[—–-]\s|:\s)(.+)$/);
  if (!match) return [para(text)];
  return [
    para([run(match[1], { bold: true })]),
    para(match[2], { gapBefore: 6 }),
  ];
}

const pad2 = (value: number) => String(value).padStart(2, "0");

function stepOf(process: Process, stepId: string | null) {
  const index = process.steps.findIndex((step) => step.id === stepId);
  return index < 0 ? null : { step: process.steps[index], index };
}

/** Pages a single list of items down one column until all are placed. */
function paginate(
  ctx: Context,
  plan: SlidePlan,
  kicker: string,
  items: Item[],
  gap: number,
  left = ctx.grid.x(0),
) {
  let rest = items;
  let index = 0;
  do {
    const { b, top } = page(ctx, plan, kicker, left, index > 0);
    const count = Math.max(
      Math.min(1, rest.length),
      fitting(rest, top, ctx.grid.contentBottom, gap, ctx.grid.budget),
    );
    stack(b, rest.slice(0, count), top, gap);
    rest = rest.slice(count);
    index += 1;
  } while (rest.length > 0);
}

function titleSlide(ctx: Context, plan: SlidePlan) {
  const { grid, theme, process } = ctx;
  const c = theme.colors;
  const s = styles(theme);
  const b = new SlideBuilder(`slide${ctx.drafts.length + 1}`);
  ctx.drafts.push({ b, plan, footer: false });
  const left = grid.x(0);
  const bandY = SLIDE_H - 160;
  b.shape(
    "decoration",
    { x: 0, y: bandY, w: SLIDE_W, h: SLIDE_H - bandY },
    c.accent,
  );
  b.shape("decoration", { x: 0, y: bandY - 4, w: SLIDE_W, h: 4 }, c.highlight);
  const kickerY = 196;
  const titleY = kickerY + 20 + grid.space.tight;
  b.text(
    "label",
    { x: left, y: kickerY, w: grid.span(8), h: 20 },
    [para("PROCESS HANDOVER")],
    {
      ...s.kicker,
      color: c.highlight,
    },
  );
  const titleStyle = {
    fontSize: TYPE.display,
    font: "heading",
    color: c.background,
    lineHeight: LEADING.tight,
  } satisfies TextStyle;
  const titleW = grid.span(10);
  const titleParas = [para(plan.title)];
  // Up to three lines; a longer title overflows its box and fails a Check.
  const titleH = Math.min(
    fit(titleParas, titleStyle, titleW),
    linesHigh(titleStyle, 3),
  );
  b.text(
    "title",
    { x: left, y: titleY, w: titleW, h: titleH },
    titleParas,
    titleStyle,
    ENTER.rise(600),
  );
  const lede = { ...s.lede, color: c.accentSoft };
  const subtitleW = grid.span(9);
  const subtitle = clamp(
    plan.subtitle ?? `${process.owner} hands over to ${process.receiver}`,
    (words) => [para(words)],
    lede,
    subtitleW,
    linesHigh(lede, 2),
  );
  const subtitleParas = [para(subtitle)];
  b.text(
    "subtitle",
    {
      x: left,
      y: titleY + titleH + grid.space.block,
      w: subtitleW,
      h: fit(subtitleParas, lede, subtitleW),
    },
    subtitleParas,
    lede,
    ENTER.fade(),
  );
  const decisions = process.steps.filter((step) => step.decision).length;
  const meta = [
    `${process.steps.length} steps`,
    decisions > 0 ? `${decisions} decision${decisions === 1 ? "" : "s"}` : null,
    process.frequency,
    ...plan.bullets,
  ]
    .filter((item): item is string => Boolean(item))
    .join("  ·  ")
    .toUpperCase();
  const metaStyle = { ...s.kicker, color: c.background } satisfies TextStyle;
  const metaW = grid.span(10);
  const metaText = clamp(
    meta,
    (words) => [para(words)],
    metaStyle,
    metaW,
    linesHigh(metaStyle, 3),
  );
  const metaParas = [para(metaText)];
  const metaH = fit(metaParas, metaStyle, metaW);
  b.text(
    "label",
    {
      x: left,
      y: Math.min(bandY + 40, SLIDE_H - grid.margin - metaH),
      w: metaW,
      h: metaH,
    },
    metaParas,
    metaStyle,
    ENTER.fade("after", 400),
  );
}

function stepSlide(ctx: Context, plan: SlidePlan) {
  const { grid, theme, process } = ctx;
  const c = theme.colors;
  const s = styles(theme);
  const found = stepOf(process, plan.stepId);
  const textX = grid.x(1);
  const number = found ? pad2(found.index + 1) : "·";
  const kicker = found
    ? `Step ${found.index + 1} of ${process.steps.length}  ·  ${found.step.actor}`
    : "Step";
  if (!found) {
    let rest = plan.bullets.map((bullet) =>
      bulletItem(ctx, bullet, textX, grid.right - textX),
    );
    let index = 0;
    do {
      const { b, top } = page(ctx, plan, kicker, textX, index > 0, number);
      const count = Math.max(
        Math.min(1, rest.length),
        fitting(rest, top, grid.contentBottom, grid.space.list, grid.budget),
      );
      stack(b, rest.slice(0, count), top, grid.space.list);
      rest = rest.slice(count);
      index += 1;
    } while (rest.length > 0);
    return;
  }
  const { step } = found;
  const mediaX = grid.x(7);
  const mediaW = grid.span(5);
  const textW = grid.span(6);
  const calloutStyle = {
    fontSize: TYPE.card,
    font: "body",
    color: c.ink,
    lineHeight: LEADING.body,
    padding: 14,
    fill: c.accentSoft,
  } satisfies TextStyle;
  const calloutParas = (words: string) => [
    para([run("Watch out  ", { bold: true, color: c.warn }), run(words)]),
  ];
  const captionText = [clock(step.at), step.actor, step.system]
    .filter((item): item is string => Boolean(item))
    .join("  ·  ");
  let rest = plan.bullets.map((bullet) =>
    bulletItem(ctx, bullet, textX, textW),
  );
  let index = 0;
  do {
    const { b, top } = page(ctx, plan, kicker, textX, index > 0, number);
    const room = grid.contentBottom - top;
    // The warning sits on the first slide only, across the foot of both columns.
    const callout =
      index === 0 && step.warning
        ? calloutParas(
            clamp(
              step.warning,
              calloutParas,
              calloutStyle,
              grid.right - textX,
              Math.floor(room * 0.4),
            ),
          )
        : null;
    const calloutH = callout
      ? fit(callout, calloutStyle, grid.right - textX)
      : 0;
    const calloutY = grid.contentBottom - calloutH;
    const caption = [
      para(
        clamp(
          captionText,
          (words) => [para(words)],
          s.caption,
          mediaW,
          linesHigh(s.caption, 2),
        ),
      ),
    ];
    const captionH = fit(caption, s.caption, mediaW);
    // The screenshot gives way to the callout: it keeps 16:9 and its left
    // edge and only gets smaller, never the type.
    const mediaBottom = callout
      ? calloutY - grid.space.card
      : grid.contentBottom;
    const imageH = Math.max(
      90,
      Math.min(
        Math.round((mediaW * 9) / 16),
        mediaBottom - top - grid.space.tight - captionH,
      ),
    );
    const imageW = Math.round((imageH * 16) / 9);
    const fixed = 2 + (callout ? 1 : 0);
    const bottom = callout ? calloutY - grid.space.card : grid.contentBottom;
    let count = fitting(
      rest,
      top,
      bottom,
      grid.space.list,
      grid.budget - fixed,
    );
    // A bullet that will not fit beside the warning goes on to the next
    // slide; one that fits on no slide is placed and left to the Checks.
    if (count === 0 && rest.length > 0 && !callout) count = 1;
    stack(b, rest.slice(0, count), top, grid.space.list);
    rest = rest.slice(count);
    b.image(
      { x: mediaX, y: top, w: imageW, h: imageH },
      step.at,
      `The recording at ${clock(step.at)}: ${step.title}`,
      ENTER.fade(),
    );
    b.text(
      "label",
      { x: mediaX, y: top + imageH + grid.space.tight, w: mediaW, h: captionH },
      caption,
      s.caption,
      ENTER.fade("with", 400),
    );
    if (callout) {
      b.text(
        "callout",
        { x: textX, y: calloutY, w: grid.right - textX, h: calloutH },
        callout,
        calloutStyle,
        ENTER.wipe(),
      );
    }
    index += 1;
  } while (rest.length > 0);
}

function overviewSlide(ctx: Context, plan: SlidePlan) {
  const { grid, theme, process } = ctx;
  const c = theme.colors;
  const s = styles(theme);
  const ledeW = grid.span(5);
  const listX = grid.x(5);
  const listW = grid.span(7);
  const rowGap = 4;
  // The steps read as a numbered table, so they sit closer than a list of points.
  const table = { ...s.list, lineHeight: LEADING.label } satisfies TextStyle;
  let lede = plan.bullets.map((bullet) =>
    bulletItem(ctx, bullet, grid.x(0), ledeW),
  );
  const rowOf = (text: string) => (number: string) =>
    para([run(number, { bold: true, color: c.accent }), run(`   ${text}`)]);
  let rows = process.steps.map((step, index) => {
    const make = (words: string) => [rowOf(words)(pad2(index + 1))];
    // A step title taller than the whole list area is cut, never the list.
    const title = clamp(
      step.title,
      make,
      table,
      listW,
      grid.contentBottom - grid.bodyTop,
    );
    return { paragraph: make(title)[0], h: fit(make(title), table, listW) };
  });
  // When the steps need more than one slide they are shared out evenly, so
  // no slide carries a stray row or two.
  let perPage = rows.length;
  let index = 0;
  do {
    const { b, top } = page(ctx, plan, "Overview", grid.x(0), index > 0);
    const room = grid.contentBottom - top;
    let taken = 0;
    let used = 0;
    for (const row of rows) {
      const next = used + (taken > 0 ? rowGap : 0) + row.h;
      if (next > room + 0.5 || taken >= perPage) break;
      used = next;
      taken += 1;
    }
    const ledeCount = fitting(
      lede,
      top,
      grid.contentBottom,
      grid.space.list,
      grid.budget - (taken > 0 ? 1 : 0),
    );
    if (taken === 0 && ledeCount === 0) taken = Math.min(1, rows.length);
    if (index === 0 && taken > 0 && taken < rows.length) {
      const pages = Math.ceil(rows.length / taken);
      perPage = Math.ceil(rows.length / pages);
      taken = perPage;
      used = rows
        .slice(0, taken)
        .reduce((sum, row, at) => sum + row.h + (at > 0 ? rowGap : 0), 0);
    }
    stack(b, lede.slice(0, ledeCount), top, grid.space.list);
    if (taken > 0) {
      const paragraphs = rows.slice(0, taken).map((row, at) => ({
        ...row.paragraph,
        gapBefore: at > 0 ? rowGap : 0,
      }));
      b.text(
        "body",
        { x: listX, y: top, w: listW, h: used },
        paragraphs,
        table,
        ENTER.fade(),
      );
    }
    lede = lede.slice(ledeCount);
    rows = rows.slice(taken);
    index += 1;
  } while (lede.length > 0 || rows.length > 0);
}

type Row = { section: "ROLES" | "SYSTEMS"; name: string; text: string };

function rolesSlide(ctx: Context, plan: SlidePlan) {
  const { grid, theme, process } = ctx;
  const c = theme.colors;
  const s = styles(theme);
  const none = (section: Row["section"]): Row => ({
    section,
    name: "None named",
    text: "the recording does not name one",
  });
  const roles: Row[] = process.roles.length
    ? process.roles.map((role) => ({
        section: "ROLES",
        name: role.name,
        text: role.responsibility,
      }))
    : [none("ROLES")];
  const systems: Row[] = process.systems.length
    ? process.systems.map((system) => ({
        section: "SYSTEMS",
        name: system.name,
        text: system.usedFor,
      }))
    : [none("SYSTEMS")];
  const labelH = 20 + grid.space.tight;
  const halfW = grid.span(6);
  const fullW = grid.right - grid.x(0);
  const bullets = plan.bullets.map((bullet) =>
    bulletItem(ctx, bullet, grid.x(0), fullW),
  );

  // Side by side when both tables fit on one slide: name over what it does.
  const stacked = (rows: Row[]) =>
    rows.flatMap((row, index) => [
      para([run(row.name, { bold: true })], { gapBefore: index > 0 ? 16 : 0 }),
      para([run(row.text, { color: c.muted })], { gapBefore: 2 }),
    ]);
  {
    const top = grid.bodyTop;
    const rolesH = fit(stacked(roles), s.list, halfW);
    const systemsH = fit(stacked(systems), s.list, halfW);
    const tablesH = labelH + Math.max(rolesH, systemsH);
    const bulletsH =
      bullets.reduce((sum, item) => sum + item.h, 0) +
      Math.max(0, bullets.length - 1) * grid.space.list;
    const ledeH = plan.subtitle
      ? fit([para(plan.subtitle)], s.lede, fullW) + grid.space.block
      : 0;
    const needed =
      ledeH + tablesH + (bullets.length ? grid.space.block + bulletsH : 0);
    if (
      needed <= grid.contentBottom - top &&
      2 + bullets.length <= grid.budget
    ) {
      const { b, top: bodyTop } = page(
        ctx,
        plan,
        "Roles and systems",
        grid.x(0),
        false,
      );
      for (const [col, heading, rows, h] of [
        [0, "ROLES", roles, rolesH],
        [6, "SYSTEMS", systems, systemsH],
      ] as const) {
        b.text(
          "label",
          { x: grid.x(col), y: bodyTop, w: halfW, h: 20 },
          [para(heading)],
          s.kicker,
        );
        b.text(
          "body",
          { x: grid.x(col), y: bodyTop + labelH, w: halfW, h },
          stacked([...rows]),
          s.list,
          ENTER.rise(500),
        );
      }
      stack(b, bullets, bodyTop + tablesH + grid.space.block, grid.space.list);
      return;
    }
  }

  // Otherwise one table across the slide, roles then systems, continuing
  // onto as many slides as it needs.
  const rowParas = (row: Row, words: string, first: boolean) => [
    para(
      [run(row.name, { bold: true }), run(`  —  ${words}`, { color: c.muted })],
      {
        gapBefore: first ? 0 : 12,
      },
    ),
  ];
  const queue = [...roles, ...systems].map((row) => {
    const text = clamp(
      row.text,
      (words) => rowParas(row, words, true),
      s.list,
      fullW,
      grid.contentBottom - grid.bodyTop - labelH,
    );
    return { row, text, h: fit(rowParas(row, text, true), s.list, fullW) };
  });
  const started = new Set<string>();
  let rest = bullets;
  let index = 0;
  while (queue.length > 0 || index === 0) {
    const { b, top } = page(
      ctx,
      plan,
      "Roles and systems",
      grid.x(0),
      index > 0,
    );
    let y = top;
    let placedAny = false;
    while (queue.length > 0 && b.animated < grid.budget) {
      const section = queue[0].row.section;
      const taken: typeof queue = [];
      let used = 0;
      for (const item of queue) {
        if (item.row.section !== section) break;
        const next = used + (taken.length ? 12 : 0) + item.h;
        if (y + labelH + next > grid.contentBottom + 0.5) break;
        used = next;
        taken.push(item);
      }
      if (taken.length === 0) {
        if (placedAny) break;
        taken.push(queue[0]);
        used = queue[0].h;
      }
      const heading = `${section}${started.has(section) ? " (CONTINUED)" : ""}`;
      started.add(section);
      b.text(
        "label",
        { x: grid.x(0), y, w: fullW, h: 20 },
        [para(heading)],
        s.kicker,
      );
      b.text(
        "body",
        { x: grid.x(0), y: y + labelH, w: fullW, h: used },
        taken.flatMap((item, at) => rowParas(item.row, item.text, at === 0)),
        s.list,
        ENTER.rise(500),
      );
      queue.splice(0, taken.length);
      y += labelH + used + grid.space.block;
      placedAny = true;
    }
    if (queue.length === 0) {
      const count = fitting(
        rest,
        y,
        grid.contentBottom,
        grid.space.list,
        grid.budget - b.animated,
      );
      stack(b, rest.slice(0, count), y, grid.space.list);
      rest = rest.slice(count);
    }
    index += 1;
    if (queue.length === 0 && rest.length === 0) break;
    if (queue.length === 0 && !placedAny && rest.length > 0) {
      // Bullets alone left: they continue as a list.
      paginate(ctx, plan, "Roles and systems", rest, grid.space.list);
      break;
    }
  }
}

function decisionSlide(ctx: Context, plan: SlidePlan) {
  const { grid, theme, process } = ctx;
  const c = theme.colors;
  const s = styles(theme);
  const found = stepOf(process, plan.stepId);
  const decision = found?.step.decision;
  const kicker = found ? `Decision  ·  Step ${found.index + 1}` : "Decision";
  if (!decision) {
    cardRows(ctx, plan, kicker, plan.bullets, null);
    return;
  }
  const qX = grid.x(0);
  const qW = grid.span(4);
  const cardX = grid.x(5);
  const cardW = grid.right - cardX;
  const room = grid.contentBottom - grid.bodyTop;
  const question = {
    fontSize: TYPE.question,
    font: "heading",
    color: c.surface,
    lineHeight: 1.2,
    padding: 24,
    valign: "middle",
    fill: c.accent,
  } satisfies TextStyle;
  const qParas = [
    para(
      clamp(
        decision.question,
        (words) => [para(words)],
        question,
        qW,
        linesHigh(question, 6),
      ),
    ),
  ];
  const qH = Math.max(120, fit(qParas, question, qW));
  const card = s.card;
  const cardParas = (when: string, then: string) => [
    para([run(when, { bold: true, color: c.accent })]),
    para(then, { gapBefore: 6 }),
  ];
  // Each card is as tall as its words; a branch taller than the whole body is cut.
  const cards = decision.branches.map((branch) => {
    const when = clamp(
      branch.when,
      (words) => cardParas(words, ""),
      card,
      cardW,
      room / 2,
    );
    const then = clamp(
      branch.then,
      (words) => cardParas(when, words),
      card,
      cardW,
      room,
    );
    const paragraphs = cardParas(when, then);
    return { paragraphs, h: Math.max(88, fit(paragraphs, card, cardW)) };
  });
  let bullets = plan.bullets.map((bullet) => bulletItem(ctx, bullet, qX, qW));
  let rest = cards;
  let index = 0;
  do {
    const { b, top } = page(ctx, plan, kicker, qX, index > 0);
    const bottom = grid.contentBottom;
    // Cards that fit, within the entrances left after the question.
    const slots = grid.budget - 1;
    let count = 0;
    let groupH = 0;
    for (const item of rest) {
      const next = groupH + (count > 0 ? grid.space.card : 0) + item.h;
      if (top + next > bottom + 0.5 || count + 1 > slots) break;
      groupH = next;
      count += 1;
    }
    if (count === 0 && rest.length > 0) {
      count = 1;
      groupH = rest[0].h;
    }
    const shown = rest.slice(0, count);
    rest = rest.slice(count);
    // The question and the branches share a centre line, so the line out of
    // the question meets the middle of the spine; with bullets under it the
    // question keeps to the top.
    const centred = bullets.length === 0;
    const qY = centred ? top + Math.max(0, Math.round((groupH - qH) / 2)) : top;
    let y = top + (centred ? Math.max(0, Math.round((qH - groupH) / 2)) : 0);
    const placed: Rect[] = shown.map((item) => {
      const rect = { x: cardX, y, w: cardW, h: item.h };
      y += item.h + grid.space.card;
      return rect;
    });
    b.text(
      "callout",
      { x: qX, y: qY, w: qW, h: qH },
      qParas,
      question,
      ENTER.fade("after", 450),
    );
    const bulletsTop = qY + qH + grid.space.list;
    const bulletCount = fitting(
      bullets,
      bulletsTop,
      bottom,
      grid.space.list,
      grid.budget - 1 - count,
    );
    stack(b, bullets.slice(0, bulletCount), bulletsTop, grid.space.list);
    bullets = bullets.slice(bulletCount);
    // Connectors behind the cards: one line out of the question, a spine
    // and a stub into each branch.
    const spineX = Math.round((qX + qW + cardX) / 2);
    const qMid = Math.round(qY + qH / 2);
    const mids = placed.map((rect) => Math.round(rect.y + rect.h / 2));
    const spineTop = Math.min(qMid, ...mids);
    const spineBottom = Math.max(qMid, ...mids);
    b.shape(
      "decoration",
      { x: qX + qW, y: qMid - 1, w: spineX - qX - qW, h: 2 },
      c.accent,
    );
    b.shape(
      "decoration",
      { x: spineX - 1, y: spineTop - 1, w: 2, h: spineBottom - spineTop + 2 },
      c.accent,
    );
    for (const mid of mids) {
      b.shape(
        "decoration",
        { x: spineX, y: mid - 1, w: cardX - spineX, h: 2 },
        c.accent,
      );
    }
    shown.forEach((item, at) => {
      b.text("body", placed[at], item.paragraphs, card, ENTER.rise());
    });
    index += 1;
    if (rest.length === 0 && bullets.length > 0) {
      // Bullets the question had no room for continue as a list.
      paginate(ctx, plan, kicker, bullets, grid.space.list);
      break;
    }
  } while (rest.length > 0);
}

function exceptionsSlide(ctx: Context, plan: SlidePlan) {
  const { grid, theme } = ctx;
  const s = styles(theme);
  const w = grid.span(6);
  const pairs: string[][] = [];
  for (let i = 0; i < plan.bullets.length; i += 2)
    pairs.push(plan.bullets.slice(i, i + 2));
  const rows: Item[] = pairs.map((pair) => {
    // Every card in a row is as tall as the fuller one.
    const h = Math.max(
      120,
      ...pair.map((bullet) => fit(headAndRest(bullet), s.card, w)),
    );
    return {
      h,
      animated: pair.length,
      place: (b, y) =>
        pair.forEach((bullet, col) => {
          b.text(
            "body",
            { x: grid.x(col * 6), y, w, h },
            headAndRest(bullet),
            s.card,
            ENTER.rise(),
          );
        }),
    };
  });
  paginate(ctx, plan, "Exceptions", rows, grid.space.card);
}

/** Full-width cards stacked down the slide, numbered. */
function cardRows(
  ctx: Context,
  plan: SlidePlan,
  kicker: string,
  bullets: string[],
  prefix: ((index: number) => string) | null,
) {
  const { grid, theme } = ctx;
  const c = theme.colors;
  const style = styles(theme).row;
  const w = grid.right - grid.x(0);
  const items: Item[] = bullets.map((bullet, index) => {
    const runs = prefix
      ? [
          run(`${prefix(index)}   `, { bold: true, color: c.accent }),
          run(bullet),
        ]
      : [run(bullet)];
    const paragraphs = [para(runs)];
    const h = fit(paragraphs, style, w);
    return {
      h,
      animated: 1,
      place: (b, y) =>
        b.text(
          "body",
          { x: grid.x(0), y, w, h },
          paragraphs,
          style,
          ENTER.rise(),
        ),
    };
  });
  paginate(ctx, plan, kicker, items, grid.space.list);
}

/** The footer and the progress track, once the number of slides is known. */
function footer(
  draft: Draft,
  index: number,
  total: number,
  ctx: Context,
  deckTitle: string,
): SlideElement[] {
  const { grid, theme } = ctx;
  const s = styles(theme);
  const b = draft.b;
  const trackX = grid.x(9);
  const trackW = grid.right - trackX;
  const trackY = grid.footerY + 8;
  const w = grid.span(8);
  const tail = `  ·  ${index + 1} / ${total}`;
  const title = clamp(
    deckTitle,
    (words) => [para(`${words}${tail}`)],
    s.footer,
    w,
    20,
  );
  const make = (
    role: SlideElement["role"],
    rect: Rect,
    fill: string,
  ): SlideElement => ({
    id: b.nextId(role),
    type: "shape",
    role,
    ...rect,
    shape: "rect",
    fill,
    stroke: null,
    strokeWidth: 0,
    animation: null,
  });
  return [
    make(
      "decoration",
      { x: trackX, y: trackY, w: trackW, h: 4 },
      theme.colors.accentSoft,
    ),
    make(
      "decoration",
      {
        x: trackX,
        y: trackY,
        w: Math.max(4, Math.round((trackW * (index + 1)) / total)),
        h: 4,
      },
      theme.colors.accent,
    ),
    {
      id: b.nextId("footer"),
      type: "text",
      role: "footer",
      x: grid.x(0),
      y: grid.footerY,
      w,
      h: 20,
      paragraphs: [para(`${title}${tail}`)],
      fontSize: s.footer.fontSize,
      font: s.footer.font,
      color: s.footer.color,
      align: "left",
      valign: "top",
      lineHeight: s.footer.lineHeight,
      padding: 0,
      fill: null,
      animation: null,
    },
  ];
}

/** Lays a Deck plan out. Pure: the same plan, Process and Rules always give the same Deck. */
export function layoutDeck(
  plan: DeckPlan,
  process: Process,
  rules: RuleSet,
): Deck {
  const ctx: Context = {
    grid: deckGrid(rules),
    theme: DECK_THEME,
    process,
    drafts: [],
  };
  for (const slide of plan.slides) {
    switch (slide.kind) {
      case "title":
        titleSlide(ctx, slide);
        break;
      case "overview":
        overviewSlide(ctx, slide);
        break;
      case "roles":
        rolesSlide(ctx, slide);
        break;
      case "step":
        stepSlide(ctx, slide);
        break;
      case "decision":
        decisionSlide(ctx, slide);
        break;
      case "exceptions":
        exceptionsSlide(ctx, slide);
        break;
      case "summary":
        cardRows(ctx, slide, "Summary", slide.bullets, (index) =>
          pad2(index + 1),
        );
        break;
      case "questions":
        cardRows(
          ctx,
          slide,
          "Open questions",
          slide.bullets,
          (index) => `Q${index + 1}`,
        );
        break;
    }
  }
  const total = ctx.drafts.length;
  return {
    title: plan.title,
    theme: DECK_THEME,
    slides: ctx.drafts.map((draft, index) => ({
      id: draft.b.id,
      planId: draft.plan.id,
      kind: draft.plan.kind,
      stepId: draft.plan.stepId,
      background:
        draft.plan.kind === "title"
          ? DECK_THEME.colors.ink
          : DECK_THEME.colors.background,
      transition: { ...DECK_TRANSITION },
      elements: draft.footer
        ? [...footer(draft, index, total, ctx, plan.title), ...draft.b.elements]
        : draft.b.elements,
      notes: draft.plan.notes.trim(),
    })),
  };
}

/** What a screenshot shows when its frame was not captured, in the PPTX and the preview alike. */
export function placeholderText(
  element: Pick<ImageElement, "frameAt">,
): string {
  return `Screenshot at ${clock(element.frameAt)}`;
}

/** How far a "rise" starts below its place, as a share of the slide's height (PowerPoint's `#ppt_y` offset). */
export const RISE_OFFSET = 0.05;

/** When each entrance plays, the way PowerPoint schedules it. */
export type EntranceTiming = {
  elementId: string;
  order: number;
  /** 0 for entrances that start with the slide, then one per click. */
  group: number;
  /** Start of the effect from the start of its group, delay included. */
  startMs: number;
  endMs: number;
  /** Index of the "par" the effect sits in within its group. */
  step: number;
};

/**
 * The entrance schedule of a slide. A `click` opens a new group; `after` opens
 * a new step that starts when the step before has finished; `with` joins the
 * current step. The PPTX timing tree and the browser player both read this.
 */
export function entranceSchedule(slide: Slide): EntranceTiming[] {
  const animated = slide.elements
    .filter((element) => element.animation)
    .sort((a, b) => (a.animation?.order ?? 0) - (b.animation?.order ?? 0));
  const timings: EntranceTiming[] = [];
  let group = 0;
  let step = -1;
  let stepStart = 0;
  let groupEnd = 0;
  for (const element of animated) {
    const animation = element.animation as Animation;
    const first = timings.length === 0;
    if (animation.trigger === "click") {
      group += 1;
      step = 0;
      stepStart = 0;
      groupEnd = 0;
    } else if (animation.trigger === "after" || first || step < 0) {
      step += 1;
      stepStart = groupEnd;
    }
    const startMs = stepStart + animation.delayMs;
    const endMs = startMs + animation.durationMs;
    groupEnd = Math.max(groupEnd, endMs);
    timings.push({
      elementId: element.id,
      order: animation.order,
      group,
      startMs,
      endMs,
      step,
    });
  }
  return timings;
}
