import { type CellStyle, COLS, GEOMETRY, ROWS, type Screen } from "./types";

/** The Screen as text, as markup and as pixels. No DOM: strings only. */

/** 24 strings of 80 characters. */
export function screenText(screen: Screen): string[] {
  return screen.cells.map((row) => row.map((cell) => cell.ch).join(""));
}

const STYLE_CLASS: Record<CellStyle, string> = {
  normal: "",
  bright: " s-bright",
  dim: " s-dim",
  reverse: " s-reverse",
  error: " s-error",
  field: " s-field",
};

function escapeChar(ch: string): string {
  switch (ch) {
    case " ":
      return "&nbsp;";
    case "&":
      return "&amp;";
    case "<":
      return "&lt;";
    case ">":
      return "&gt;";
    case '"':
      return "&quot;";
    default:
      return ch;
  }
}

/**
 * The terminal's inner HTML: 24 row divs of 80 fixed-size cells, for a
 * container with class `hm-term` styled by `TERMINAL_CSS`.
 */
export function screenHtml(screen: Screen): string {
  return screen.cells
    .map((row, r) => {
      const cells = row
        .map((cell, c) => {
          const cur =
            screen.cursor?.row === r && screen.cursor.col === c ? " cur" : "";
          return `<span class="c${STYLE_CLASS[cell.style]}${cur}">${escapeChar(cell.ch)}</span>`;
        })
        .join("");
      return `<div class="r">${cells}</div>`;
    })
    .join("");
}

/** The cell under a viewport point, or null outside the grid. */
export function cellAt(
  x: number,
  y: number,
): { row: number; col: number } | null {
  const col = Math.floor((x - GEOMETRY.originX) / GEOMETRY.cellW);
  const row = Math.floor((y - GEOMETRY.originY) / GEOMETRY.cellH);
  if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return null;
  return { row, col };
}

/** The centre of a cell, in viewport pixels. */
export function pointOf(row: number, col: number): { x: number; y: number } {
  return {
    x: GEOMETRY.originX + col * GEOMETRY.cellW + GEOMETRY.cellW / 2,
    y: GEOMETRY.originY + row * GEOMETRY.cellH + GEOMETRY.cellH / 2,
  };
}

const G = GEOMETRY;
const STRIP_TOP = G.originY + ROWS * G.cellH + 5;

export const TERMINAL_CSS = `
.hm-term {
  position: relative;
  box-sizing: border-box;
  width: ${G.width}px;
  height: ${G.height}px;
  padding: ${G.originY}px 0 0 ${G.originX}px;
  overflow: hidden;
  background: #020a04;
  color: #33e06a;
  font-family: "IBM Plex Mono", "DejaVu Sans Mono", "Liberation Mono", Menlo, Consolas, monospace;
  font-size: 19px;
  font-weight: 500;
  cursor: default;
  user-select: none;
  text-shadow: 0 0 4px rgba(51, 224, 106, 0.45);
}
.hm-term .r {
  width: ${COLS * G.cellW}px;
  height: ${G.cellH}px;
  white-space: nowrap;
  overflow: hidden;
}
.hm-term .c {
  display: inline-block;
  box-sizing: border-box;
  width: ${G.cellW}px;
  height: ${G.cellH}px;
  line-height: ${G.cellH}px;
  vertical-align: top;
  text-align: center;
  overflow: hidden;
}
.hm-term .s-bright { color: #d8ffe4; }
.hm-term .s-dim { color: #1f8f45; text-shadow: none; }
.hm-term .s-reverse { background: #33e06a; color: #020a04; text-shadow: none; }
.hm-term .s-error { background: #ff5a4d; color: #1a0200; text-shadow: none; }
.hm-term .s-field { color: #d8ffe4; text-decoration: underline; text-underline-offset: 3px; }
.hm-term .cur { animation: hm-blink 1s steps(1, end) infinite; }
@keyframes hm-blink {
  0% { background: #d8ffe4; color: #020a04; text-shadow: none; }
  50% { background: transparent; color: inherit; }
}
.hm-term::after {
  content: "HM3270  LU MRDT0417  PORT AUTHORITY OF MERIDIA  SPECIMEN";
  position: absolute;
  left: ${G.originX}px;
  top: ${STRIP_TOP}px;
  width: ${COLS * G.cellW}px;
  height: ${G.height - STRIP_TOP - 6}px;
  line-height: ${G.height - STRIP_TOP - 6}px;
  border-top: 1px solid #14592b;
  color: #1f8f45;
  font-size: 12px;
  letter-spacing: 1px;
  text-shadow: none;
}
`;
