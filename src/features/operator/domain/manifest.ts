import { isValidContainer, normaliseContainer } from "./iso6346";

/**
 * A Manifest: the cargo list a Task comes with, as text. CSV as the samples
 * are written, or the same columns pulled out of a PDF (two or more spaces,
 * or tabs, between them). Parsing never throws; what it could not read is in
 * `problems`.
 */

export type ManifestRow = {
  /** Normalised to 11 characters: no spaces, upper case. */
  container: string;
  isoType: string;
  seal: string;
  grossKg: number;
  pol: string;
  consignee: string;
  goods: string;
  haz: string;
};

export type ParsedManifest = {
  vessel?: string;
  voyage?: string;
  lines: ManifestRow[];
  problems: string[];
};

export const MANIFEST_MAX_ROWS = 60;

/** container, iso_type, seal, gross_kg, pol, consignee, haz, goods. */
const COLUMNS = 8;

/** One CSV line into cells: commas, with simple double quotes (`""` is a quote). */
function splitCsv(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      cells.push(cell);
      cell = "";
    } else {
      cell += ch;
    }
  }
  cells.push(cell);
  return cells.map((c) => c.trim());
}

/** Cells of one line, whichever way the columns are separated. */
function cellsOf(line: string): string[] {
  const spaced = line
    .trim()
    .split(/\t+| {2,}/)
    .map((c) => c.trim());
  // Text from a PDF: columns far apart. An empty hazard column vanishes, so
  // seven cells is a full row too.
  if (spaced.length >= COLUMNS - 1 && !line.includes('"')) {
    if (spaced.length === COLUMNS - 1) spaced.splice(6, 0, "");
    return spaced;
  }
  if (line.includes(",")) return splitCsv(line);
  return spaced;
}

export function parseManifest(text: string): ParsedManifest {
  const parsed: ParsedManifest = { lines: [], problems: [] };
  if (typeof text !== "string") {
    parsed.problems.push("The manifest is not text.");
    return parsed;
  }
  let extra = 0;
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) return;
    const meta =
      /^(vessel|voyage)\s*[,:=\t]\s*(.*)$/i.exec(line) ??
      /^(vessel|voyage) {2,}(.*)$/i.exec(line);
    if (meta) {
      const value = meta[2].replace(/^"|"$/g, "").trim().toUpperCase();
      if (meta[1].toLowerCase() === "vessel") parsed.vessel = value;
      else parsed.voyage = value;
      return;
    }
    const cells = cellsOf(line);
    if (/^container$/i.test(cells[0] ?? "")) return;
    const at = `Line ${index + 1}`;
    if (cells.length < COLUMNS) {
      parsed.problems.push(
        `${at}: expected ${COLUMNS} columns, found ${cells.length}.`,
      );
      return;
    }
    if (parsed.lines.length >= MANIFEST_MAX_ROWS) {
      extra += 1;
      return;
    }
    const [container, isoType, seal, kg, pol, consignee, haz] = cells;
    // Goods is last, so commas left unquoted in it are put back.
    const goods = cells.slice(COLUMNS - 1).join(", ");
    const row: ManifestRow = {
      container: normaliseContainer(container),
      isoType: isoType.toUpperCase(),
      seal: seal.toUpperCase(),
      grossKg: Number(kg.replace(/[\s,]/g, "")),
      pol: pol.toUpperCase(),
      consignee: consignee.toUpperCase(),
      goods: goods.toUpperCase(),
      haz: haz === "-" ? "" : haz.toUpperCase(),
    };
    if (!Number.isFinite(row.grossKg) || kg.trim() === "") {
      parsed.problems.push(`${at}: gross weight "${kg}" is not a number.`);
      row.grossKg = 0;
    }
    if (!isValidContainer(row.container)) {
      parsed.problems.push(
        `${at}: container "${container}" fails the ISO 6346 check.`,
      );
    }
    parsed.lines.push(row);
  });
  if (extra > 0) {
    parsed.problems.push(
      `Only the first ${MANIFEST_MAX_ROWS} rows are kept; ${extra} more were dropped.`,
    );
  }
  return parsed;
}
