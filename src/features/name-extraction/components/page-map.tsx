"use client";

import { type CSSProperties, memo } from "react";
import { LEAD, PAGE_READ, PAGE_READING, type PageMap } from "./plain";
import { cx } from "./ui";

/** One colour per reader agent slot, cycling; the lead agent reads in brass. */
export const READER_COLORS = [
  "#6fa0dc",
  "#5cc8b0",
  "#b49cf0",
  "#f08f6f",
  "#9ad16b",
  "#f2c14e",
  "#6fd0ef",
  "#e88fc0",
];
export const LEAD_COLOR = "#d9a84e";

export const readerColor = (slot: number) =>
  slot === LEAD ? LEAD_COLOR : READER_COLORS[slot % READER_COLORS.length];

/** Columns of the map: a short file gets big pages, a long one a dense wall. */
export function mapColumns(total: number) {
  if (total <= 12) return { wide: total, narrow: Math.min(total, 6) };
  if (total <= 50) return { wide: 10, narrow: 10 };
  if (total <= 120) return { wide: 25, narrow: 12 };
  if (total <= 260) return { wide: 30, narrow: 16 };
  return { wide: 40, narrow: 20 };
}

/**
 * The Document as a wall of page tiles: grey until read, washed in a
 * reader's colour while it reads them, paper once read. A brass notch marks
 * pages with names; a page where a name was just found flashes.
 */
export const PageTiles = memo(function PageTiles({
  map,
  density,
  hot,
  total,
}: {
  map: PageMap;
  density: Uint16Array;
  /** Pages where a name was found a moment ago. */
  hot: ReadonlySet<number>;
  total: number;
}) {
  const columns = mapColumns(total);
  const tiles = [];
  for (let index = 0; index < total; index++) {
    const state = map.state[index];
    const reading = state === PAGE_READING;
    const names = density[index] ?? 0;
    tiles.push(
      <div
        key={index}
        data-page={index + 1}
        className={cx(
          "sv-tile relative aspect-[3/4] rounded-[2px] transition-[background-color,box-shadow] duration-500",
          state === PAGE_READ
            ? "bg-paper/90"
            : reading
              ? "sv-scan"
              : "bg-paper/[0.07] ring-1 ring-paper/10 ring-inset",
          hot.has(index + 1) && "sv-hot",
        )}
        style={
          reading
            ? ({
                "--scan": readerColor(map.reader[index]),
                animationDelay: `${(index % 20) * 45}ms`,
              } as CSSProperties)
            : undefined
        }
      >
        {names > 0 && state === PAGE_READ ? (
          <span
            className="absolute inset-x-[18%] bottom-[14%] rounded-full bg-brass"
            style={{ height: names > 2 ? "22%" : names > 1 ? "15%" : "9%" }}
          />
        ) : null}
      </div>,
    );
  }
  return (
    <div
      role="img"
      aria-label={`${map.read} of ${total} pages read`}
      className="sv-map grid gap-[3px] sm:gap-1"
      style={
        {
          "--cols-wide": columns.wide,
          "--cols-narrow": columns.narrow,
          maxWidth: total <= 12 ? `${columns.wide * 4.5}rem` : undefined,
        } as CSSProperties
      }
    >
      {tiles}
    </div>
  );
});
