/**
 * A canned Pass for the stubbed end-to-end suite (`cannedDraftsman`):
 * a few marks that sit roughly where any screen has a header, a title and a
 * button, so the stream, the drawing and the Ruler all run with no model.
 */
import type { ModelDrawing } from "./drawing";

export function stubDrawing(sheetHeight: number, pass: number): ModelDrawing {
  const h = sheetHeight;
  const shift = pass > 1 ? 4 : 0;
  return {
    palette: [
      { hex: "#ffffff", role: "page" },
      { hex: "#14213d", role: "ink" },
      { hex: "#1d4e89", role: "brand" },
    ],
    typeScale: [
      { size: 48, weight: 700, family: "sans", role: "headline" },
      { size: 20, weight: 400, family: "sans", role: "body" },
    ],
    background: "#ffffff",
    marks: [
      {
        kind: "box",
        id: "header-bg",
        x: 0,
        y: 0,
        w: 1000,
        h: Math.round(h * 0.1),
        fill: "#1d4e89",
        stroke: null,
        strokeWidth: 0,
        radius: 0,
        rotate: 0,
      },
      {
        kind: "text",
        id: "title",
        x: 60 + shift,
        y: Math.round(h * 0.2),
        text: "Specimen",
        size: 48,
        weight: 700,
        color: "#14213d",
        align: "left",
        family: "sans",
        italic: false,
        letterSpacing: 0,
        rotate: 0,
      },
      {
        kind: "line",
        id: "rule",
        x1: 60,
        y1: Math.round(h * 0.32),
        x2: 940,
        y2: Math.round(h * 0.32),
        color: "#14213d",
        width: 2,
      },
      {
        kind: "ellipse",
        id: "dot",
        x: 860,
        y: Math.round(h * 0.18),
        w: 60,
        h: 60,
        fill: "#d9a84e",
        stroke: null,
        strokeWidth: 0,
        rotate: 0,
      },
      {
        kind: "box",
        id: "btn",
        x: 60,
        y: Math.round(h * 0.8),
        w: 880,
        h: Math.round(h * 0.08),
        fill: "#14213d",
        stroke: null,
        strokeWidth: 0,
        radius: 12,
        rotate: 0,
      },
    ],
  };
}
