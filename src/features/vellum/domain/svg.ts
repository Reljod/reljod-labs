/**
 * A Drawing as a standalone SVG document: what the Ruler rasterizes and what
 * "Download SVG" saves. The page draws the same marks with React (to animate
 * them), from the same geometry helpers, so what is measured is what is seen.
 */
import {
  type Drawing,
  FONT_STACKS,
  type Mark,
  rotation,
  TEXT_ANCHOR,
  textBaseline,
} from "./drawing";

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

/** Text for an XML attribute or element. A Drawing's text is the model's, so it is always escaped. */
export const escapeXml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => XML_ESCAPES[char] ?? char);

const paint = (value: string | null) => value ?? "none";

function turned(mark: Mark) {
  const transform = rotation(mark);
  return transform ? ` transform="${transform}"` : "";
}

function markSvg(mark: Mark): string {
  switch (mark.kind) {
    case "box":
      return `<rect x="${mark.x}" y="${mark.y}" width="${mark.w}" height="${mark.h}" rx="${mark.radius}" fill="${paint(mark.fill)}" stroke="${paint(mark.stroke)}" stroke-width="${mark.strokeWidth}"${turned(mark)}/>`;
    case "ellipse":
      return `<ellipse cx="${mark.x + mark.w / 2}" cy="${mark.y + mark.h / 2}" rx="${mark.w / 2}" ry="${mark.h / 2}" fill="${paint(mark.fill)}" stroke="${paint(mark.stroke)}" stroke-width="${mark.strokeWidth}"${turned(mark)}/>`;
    case "line":
      return `<line x1="${mark.x1}" y1="${mark.y1}" x2="${mark.x2}" y2="${mark.y2}" stroke="${mark.color}" stroke-width="${mark.width}" stroke-linecap="round"/>`;
    case "text":
      return `<text x="${mark.x}" y="${textBaseline(mark)}" font-family="${escapeXml(FONT_STACKS[mark.family])}" font-size="${mark.size}" font-weight="${mark.weight}"${mark.italic ? ' font-style="italic"' : ""} letter-spacing="${mark.letterSpacing}" text-anchor="${TEXT_ANCHOR[mark.align]}" fill="${mark.color}"${turned(mark)} xml:space="preserve">${escapeXml(mark.text)}</text>`;
  }
}

/** The whole Drawing, at `scale` pixels per Sheet unit. */
export function drawingToSvg(drawing: Drawing, scale = 1): string {
  const width = Math.round(drawing.width * scale);
  const height = Math.round(drawing.height * scale);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${drawing.width} ${drawing.height}">`,
    `<rect width="${drawing.width}" height="${drawing.height}" fill="${drawing.background}"/>`,
    ...drawing.marks.map(markSvg),
    "</svg>",
  ].join("");
}
