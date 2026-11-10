import { unzipSync } from "fflate";

/**
 * Just enough of Office Open XML to read a client's spreadsheets and Word
 * files as text, without a parser that executes or evaluates anything.
 * Formulas are read as their cached values.
 */

const MAX_UNZIPPED = 30 * 1024 * 1024;
const MAX_ROWS = 400;
const MAX_COLUMNS = 40;

function unzip(bytes: Uint8Array, wanted: (name: string) => boolean) {
  let total = 0;
  const files = unzipSync(bytes, {
    filter: (file) => {
      if (!wanted(file.name)) return false;
      total += file.originalSize;
      if (total > MAX_UNZIPPED)
        throw new Error("File is too large once unzipped");
      return true;
    },
  });
  const decoder = new TextDecoder();
  return Object.fromEntries(
    Object.entries(files).map(([name, data]) => [name, decoder.decode(data)]),
  );
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

export function decodeXml(text: string) {
  return text.replace(/&(#x?[0-9a-f]+|\w+);/gi, (match, entity: string) => {
    if (entity.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

function textRuns(xml: string) {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
    .map((match) => decodeXml(match[1] ?? ""))
    .join("");
}

/** `B12` → column index 1. */
function columnIndex(ref: string) {
  const letters = ref.replace(/[^A-Z]/gi, "").toUpperCase();
  let index = 0;
  for (const letter of letters)
    index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

function csvCell(value: string) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export type Sheet = { name: string; csv: string; rows: number };

export function readXlsx(bytes: Uint8Array): Sheet[] {
  const files = unzip(
    bytes,
    (name) =>
      name === "xl/workbook.xml" ||
      name === "xl/sharedStrings.xml" ||
      name === "xl/_rels/workbook.xml.rels" ||
      /^xl\/worksheets\/sheet\d+\.xml$/.test(name),
  );
  const shared = [
    ...(files["xl/sharedStrings.xml"] ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g),
  ].map((match) => textRuns(match[1] ?? ""));

  const rels = new Map(
    [
      ...(files["xl/_rels/workbook.xml.rels"] ?? "").matchAll(
        /<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g,
      ),
    ].map((match) => [match[1], match[2]]),
  );
  const declared = [
    ...(files["xl/workbook.xml"] ?? "").matchAll(
      /<sheet\b[^>]*\bname="([^"]*)"[^>]*\br:id="([^"]+)"/g,
    ),
  ].map((match) => {
    const target = rels.get(match[2] ?? "") ?? "";
    const path = target.startsWith("/")
      ? target.slice(1)
      : `xl/${target.replace(/^\.\//, "")}`;
    return { name: decodeXml(match[1] ?? "Sheet"), path };
  });
  const sheets =
    declared.length > 0
      ? declared
      : Object.keys(files)
          .filter((name) => name.startsWith("xl/worksheets/"))
          .sort()
          .map((path, index) => ({ name: `Sheet${index + 1}`, path }));

  return sheets.flatMap(({ name, path }) => {
    const xml = files[path];
    if (!xml) return [];
    const rows: string[][] = [];
    for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      if (rows.length >= MAX_ROWS) break;
      const cells: string[] = [];
      for (const cell of (row[1] ?? "").matchAll(
        /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,
      )) {
        const attributes = cell[1] ?? "";
        const body = cell[2] ?? "";
        const ref = /\br="([A-Z]+\d+)"/.exec(attributes)?.[1];
        const type = /\bt="(\w+)"/.exec(attributes)?.[1];
        const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "";
        let value: string;
        if (type === "s") value = shared[Number(raw)] ?? "";
        else if (type === "inlineStr") value = textRuns(body);
        else if (type === "b") value = raw === "1" ? "TRUE" : "FALSE";
        else value = decodeXml(raw);
        const column = ref ? columnIndex(ref) : cells.length;
        if (column >= MAX_COLUMNS) continue;
        while (cells.length < column) cells.push("");
        cells[column] = value.trim();
      }
      if (cells.some((cell) => cell !== "")) rows.push(cells);
    }
    return [
      {
        name,
        rows: rows.length,
        csv: rows.map((cells) => cells.map(csvCell).join(",")).join("\n"),
      },
    ];
  });
}

export function readDocx(bytes: Uint8Array): string {
  const files = unzip(bytes, (name) => name === "word/document.xml");
  const xml = files["word/document.xml"] ?? "";
  return [...xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)]
    .map((paragraph) =>
      [
        ...(paragraph[1] ?? "").matchAll(
          /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>/g,
        ),
      ]
        .map((match) => (match[1] !== undefined ? decodeXml(match[1]) : "\t"))
        .join(""),
    )
    .filter((line) => line.trim())
    .join("\n");
}

/** Plain CSV is read as is; only its size is capped. */
export function readCsv(text: string) {
  return text.split(/\r?\n/).slice(0, MAX_ROWS).join("\n");
}
