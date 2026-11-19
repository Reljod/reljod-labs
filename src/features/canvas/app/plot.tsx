/** @jsxImportSource preact */
import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { MapRegion, ViewRecord } from "../domain/payload";
import type { Encoding, ParamValues, ViewKind } from "../domain/view";
import type { Theme } from "./colors";

/** What every chart of the App is handed, and the pieces they share. */

export type Act = {
  /** The Parameters' values as the Controls show them now. */
  values: ParamValues;
  /** The spec's own values. */
  defaults: ParamValues;
  /** False in a snapshot and on a Host that cannot call tools. */
  enabled: boolean;
  set: (changes: ParamValues) => void;
};

export type ChartProps<K extends ViewKind = ViewKind> = {
  view: ViewRecord;
  encoding: Extract<Encoding, { kind: K }>;
  width: number;
  theme: Theme;
  /** Stable colour slots for series names: colour follows the entity. */
  slots: (names: string[]) => Record<string, number>;
  act: Act;
  regions?: MapRegion[];
};

/** The width of an element, kept current. Zero until it is measured. */
export function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setWidth(Math.floor(element.clientWidth));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Which mark is hovered or reached with the arrow keys. */
export function useActive(count: number) {
  const [active, setActive] = useState<number | null>(null);
  const onKeyDown = (event: KeyboardEvent) => {
    const last = count - 1;
    let next: number | null | undefined;
    if (event.key === "ArrowRight" || event.key === "ArrowDown")
      next = active === null ? 0 : Math.min(last, active + 1);
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      next = active === null ? last : Math.max(0, active - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    else if (event.key === "Escape") next = null;
    if (next === undefined || count === 0) return;
    event.preventDefault();
    setActive(next);
  };
  return {
    active: active !== null && active < count ? active : null,
    setActive,
    onKeyDown,
  };
}

export type TipData = {
  /** Where the mark is, in the chart's own pixels. */
  x: number;
  y?: number;
  title: string;
  rows: { color?: string; name?: string; value: string }[];
};

/** The one tooltip of a chart: values lead, a short stroke keys each series. */
export function Tip({ tip, width }: { tip: TipData | null; width: number }) {
  if (!tip) return null;
  const side =
    tip.x > width / 2
      ? { right: `${Math.max(0, width - tip.x + 12)}px` }
      : { left: `${Math.max(0, tip.x + 12)}px` };
  return (
    <div
      class="tip"
      style={{ ...side, top: `${Math.max(4, (tip.y ?? 4) - 8)}px` }}
    >
      <b>{tip.title}</b>
      {tip.rows.map((row) => (
        <div key={`${row.name}:${row.value}`}>
          {row.color ? (
            <span class="key stroke" style={{ borderColor: row.color }} />
          ) : null}
          {row.name ? <span>{row.name}</span> : null}
          <strong>{row.value}</strong>
        </div>
      ))}
    </div>
  );
}

/** The same words as the tooltip, for a screen reader following the arrow keys. */
export function TipSpoken({ tip }: { tip: TipData | null }) {
  return (
    <p class="sr" aria-live="polite">
      {tip
        ? `${tip.title}: ${tip.rows.map((row) => `${row.name ? `${row.name} ` : ""}${row.value}`).join(", ")}`
        : ""}
    </p>
  );
}

export function Legend({
  items,
  stroke,
}: {
  items: { name: string; color: string }[];
  stroke?: boolean;
}) {
  return (
    <ul class="legend">
      {items.map((item) => (
        <li key={item.name}>
          <span
            class={stroke ? "key stroke" : "key"}
            style={
              stroke ? { borderColor: item.color } : { background: item.color }
            }
          />
          {item.name}
        </li>
      ))}
    </ul>
  );
}

/** The scale legend of a sequential ramp: least to most, in steps. */
export function Ramp({
  colors,
  low,
  high,
  label,
}: {
  colors: readonly string[];
  low: string;
  high: string;
  label?: string;
}) {
  return (
    <div class="ramp">
      {label ? <span>{label}</span> : null}
      <span>{low}</span>
      <i aria-hidden="true">
        {colors.map((color) => (
          <b key={color} style={{ background: color }} />
        ))}
      </i>
      <span>{high}</span>
    </div>
  );
}

export function Empty({ children }: { children: ComponentChildren }) {
  return <p class="empty">{children}</p>;
}

/** The line above a plot: what the value axis measures, and the legend. */
export function PlotTop({
  title,
  children,
}: {
  title?: string;
  children?: ComponentChildren;
}) {
  return (
    <div class="plot-top">
      <span>{title}</span>
      {children}
    </div>
  );
}

/**
 * A bar from its baseline to its data end, rounded only at the data end.
 * `cross` is where it starts across the band, `base` and `end` run along the
 * value axis. Vertical bars swap nothing; horizontal ones swap x and y.
 */
export function barPath(
  cross: number,
  base: number,
  end: number,
  thick: number,
  radius: number,
  horizontal = false,
) {
  const sign = end >= base ? 1 : -1;
  const r = Math.max(0, Math.min(radius, thick / 2, Math.abs(end - base)));
  const point = (across: number, along: number) =>
    horizontal
      ? `${along.toFixed(1)},${across.toFixed(1)}`
      : `${across.toFixed(1)},${along.toFixed(1)}`;
  const far = cross + thick;
  return `M${point(cross, base)}L${point(cross, end - sign * r)}Q${point(cross, end)} ${point(cross + r, end)}L${point(far - r, end)}Q${point(far, end)} ${point(far, end - sign * r)}L${point(far, base)}Z`;
}

export const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));

export const truncate = (text: string, chars: number) =>
  text.length > chars ? `${text.slice(0, Math.max(1, chars - 1))}…` : text;

/** An x position for a label of a known width that keeps it inside [0, width]. */
export const keepInside = (x: number, labelWidth: number, width: number) =>
  clamp(x, labelWidth / 2, Math.max(labelWidth / 2, width - labelWidth / 2));
