/** Formatting and export helpers for Sieve's UI. Pure. */
import { type ExtractedName, MODELS, type ModelId } from "../domain/contract";

export function usd(value: number) {
  if (value === 0) return "$0.00";
  if (Math.abs(value) < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

export function tokens(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

export function duration(ms: number) {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
}

export function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function modelLabel(id: string) {
  return MODELS[id as ModelId]?.label ?? id;
}

export function modelPrice(id: string) {
  const price = MODELS[id as ModelId];
  return price
    ? `$${price.input} in ($${price.cacheRead} cached) / $${price.output} out per M tokens`
    : "";
}

/** The pages a Name appears on, sorted and unique. */
export function pagesOf(name: ExtractedName) {
  return [...new Set(name.mentions.map((mention) => mention.page))].sort(
    (a, b) => a - b,
  );
}

/** "1–3, 7, 9–10" from a sorted page list. */
export function pageRanges(pages: number[]) {
  const parts: string[] = [];
  let start = pages[0];
  let last = pages[0];
  for (const page of pages.slice(1)) {
    if (page === last + 1) {
      last = page;
      continue;
    }
    parts.push(start === last ? `${start}` : `${start}–${last}`);
    start = page;
    last = page;
  }
  if (start !== undefined)
    parts.push(start === last ? `${start}` : `${start}–${last}`);
  return parts.join(", ");
}

/**
 * One CSV cell. Text from a Document is untrusted, so a cell that a
 * spreadsheet would read as a formula gets a leading apostrophe.
 */
function cell(value: string | number) {
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** The Register as CSV, one row per Name. */
export function namesCsv(names: ExtractedName[], reviewBelow: number) {
  const header = [
    "canonical",
    "type",
    "aliases",
    "roles",
    "mentions",
    "pages",
    "confidence",
    "in_doubt",
    "found_by",
    "note",
  ];
  const rows = names.map((name) =>
    [
      name.canonical,
      name.type,
      name.aliases.join("; "),
      name.roles.join("; "),
      name.mentions.length,
      pagesOf(name).join(" "),
      name.confidence.toFixed(2),
      name.confidence < reviewBelow ? "yes" : "no",
      name.foundBy.join("; "),
      name.note ?? "",
    ]
      .map(cell)
      .join(","),
  );
  return `${[header.join(","), ...rows].join("\r\n")}\r\n`;
}

/** Has the browser save text as a file. */
export function downloadText(text: string, fileName: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** A file name from a Document title: letters, digits and dashes only. */
export function fileStem(title: string) {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "document"
  );
}

/** A running clock: "42s", then "3m 43s". */
export function clockText(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}
