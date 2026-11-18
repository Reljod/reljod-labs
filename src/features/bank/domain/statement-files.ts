import { type BankDate, formatDate } from "./dates";
import { formatMinor } from "./money";
import { formatAccountNumber } from "./numbers";
import type { StatementBody } from "./views";

/**
 * A Statement as files the browser builds and saves: CSV for a spreadsheet,
 * PDF to print. Pure functions, no DOM and no dependency. Every PDF carries
 * a SPECIMEN watermark: Tidewater Bank is fictional and its money is play.
 */

// CSV ------------------------------------------------------------------------

/** 123450 → "1234.50"; a spreadsheet reads it as a number. */
export function plainDecimal(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(minor));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * One text cell, RFC 4180 quoted. A cell a spreadsheet would run as a
 * formula (starting with =, +, -, @, a tab or a carriage return) is
 * prefixed with an apostrophe so it stays text.
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const amountCell = (minor: number) => (minor === 0 ? "" : plainDecimal(minor));

export function statementCsv(body: StatementBody): string {
  const rows: string[][] = [
    ["Date", "Description", "Money in", "Money out", "Balance"],
    [
      body.periodStart,
      csvCell("Opening balance"),
      "",
      "",
      plainDecimal(body.openingBalance),
    ],
    ...body.lines.map((line) => [
      line.date,
      csvCell(line.description),
      amountCell(line.moneyIn),
      amountCell(line.moneyOut),
      plainDecimal(line.balance),
    ]),
    [
      body.periodEnd,
      csvCell("Closing balance"),
      plainDecimal(body.totalIn),
      plainDecimal(body.totalOut),
      plainDecimal(body.closingBalance),
    ],
  ];
  return `${rows.map((row) => row.join(",")).join("\r\n")}\r\n`;
}

// PDF: text --------------------------------------------------------------------

/** The characters WinAnsiEncoding puts in 0x80–0x9F. */
const WIN_ANSI_EXTRA: Record<string, number> = {
  "€": 0x80,
  "‚": 0x82,
  ƒ: 0x83,
  "„": 0x84,
  "…": 0x85,
  "†": 0x86,
  "‡": 0x87,
  ˆ: 0x88,
  "‰": 0x89,
  Š: 0x8a,
  "‹": 0x8b,
  Œ: 0x8c,
  Ž: 0x8e,
  "‘": 0x91,
  "’": 0x92,
  "“": 0x93,
  "”": 0x94,
  "•": 0x95,
  "–": 0x96,
  "—": 0x97,
  "˜": 0x98,
  "™": 0x99,
  š: 0x9a,
  "›": 0x9b,
  œ: 0x9c,
  ž: 0x9e,
  Ÿ: 0x9f,
};

/**
 * Text as a "byte string" in WinAnsiEncoding: every char code is one byte
 * (0–255). Anything WinAnsi cannot show becomes "?".
 */
export function toWinAnsi(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 63;
    if ((code >= 32 && code <= 126) || (code >= 160 && code <= 255)) {
      out += char;
    } else {
      const extra = WIN_ANSI_EXTRA[char];
      out += extra === undefined ? "?" : String.fromCharCode(extra);
    }
  }
  return out;
}

/** A PDF literal string's body: (, ) and \ escaped. Takes a WinAnsi byte string. */
export const pdfEscape = (bytes: string) => bytes.replace(/[()\\]/g, "\\$&");

/** Helvetica's advance widths for 32–126, in 1/1000 em (the Adobe AFM). */
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278,
  278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584,
  584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556,
  833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278,
  278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222,
  500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500,
  500, 334, 260, 334, 584,
];

/**
 * The width in points of a WinAnsi byte string set in Helvetica. Digits are
 * 556 and "," and "." 278 in both Helvetica and Helvetica-Bold, so amounts
 * line up whichever weight they are set in.
 */
export function textWidth(bytes: string, size: number): number {
  let units = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    const code = bytes.charCodeAt(index);
    units += HELVETICA[code - 32] ?? 556;
  }
  return (units * size) / 1000;
}

/** Cuts a WinAnsi byte string to fit `max` points, ending "...". */
function fit(bytes: string, size: number, max: number): string {
  if (textWidth(bytes, size) <= max) return bytes;
  let cut = bytes;
  while (cut.length > 0 && textWidth(`${cut}...`, size) > max) {
    cut = cut.slice(0, -1);
  }
  return `${cut.trimEnd()}...`;
}

// PDF: layout ------------------------------------------------------------------

const PAGE_W = 595;
const PAGE_H = 842;
const LEFT = 50;
const RIGHT = 545;
const SIZE = 9;
const ROW = 14;
const FIRST_ROW_Y = 664;
const LAST_ROW_Y = 78;
/** Table rows that fit on one page. */
export const ROWS_PER_PAGE = Math.floor((FIRST_ROW_Y - LAST_ROW_Y) / ROW) + 1;
/** Rows the totals take at the end: a gap and three lines. */
const TOTAL_ROWS = 4;

const COLUMNS = {
  date: LEFT,
  description: 118,
  descriptionMax: 192,
  moneyIn: 380,
  moneyOut: 462,
  balance: RIGHT,
};

type Row = {
  date: string;
  description: string;
  moneyIn: string;
  moneyOut: string;
  balance: string;
  bold?: boolean;
};

/** One page's content-stream operators, written through these few helpers. */
class Page {
  ops: string[] = [];

  text(x: number, y: number, raw: string, size = SIZE, bold = false) {
    const bytes = toWinAnsi(raw);
    this.ops.push(
      `BT /${bold ? "F2" : "F1"} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${pdfEscape(bytes)}) Tj ET`,
    );
  }

  right(edge: number, y: number, raw: string, size = SIZE, bold = false) {
    if (!raw) return;
    this.text(edge - textWidth(toWinAnsi(raw), size), y, raw, size, bold);
  }

  /** Text cut to fit `max` points. */
  fitted(x: number, y: number, raw: string, max: number, size = SIZE) {
    const bytes = fit(toWinAnsi(raw), size, max);
    this.ops.push(
      `BT /F1 ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${pdfEscape(bytes)}) Tj ET`,
    );
  }

  rule(y: number, width = 0.5) {
    this.ops.push(`${width} w ${LEFT} ${y} m ${RIGHT} ${y} l S`);
  }
}

const SPECIMEN = "SPECIMEN";

function watermark(page: Page) {
  const size = 96;
  const width = textWidth(SPECIMEN, size);
  const c = Math.SQRT1_2;
  // Centred on the page, turned 45 degrees.
  const x = PAGE_W / 2 - (width / 2) * c;
  const y = PAGE_H / 2 - (width / 2) * c;
  page.ops.push(
    `q 0.88 g BT /F2 ${size} Tf ${c.toFixed(4)} ${c.toFixed(4)} ${(-c).toFixed(4)} ${c.toFixed(4)} ${x.toFixed(2)} ${y.toFixed(2)} Tm (${SPECIMEN}) Tj ET Q`,
  );
}

const money = (minor: number) => (minor === 0 ? "" : formatMinor(minor));
const day = (date: BankDate) => formatDate(date);

function header(page: Page, body: StatementBody) {
  page.text(LEFT, 790, body.bankName, 18, true);
  page.right(RIGHT, 790, "Statement", 18, true);
  page.text(
    LEFT,
    774,
    "Fictional bank, play money (Meridian florin, MRF).",
    8,
  );
  page.text(LEFT, 746, body.customerName, 10, true);
  page.fitted(LEFT, 732, body.customerAddress, 240, 9);
  page.text(320, 746, "Account", 8, true);
  page.text(
    380,
    746,
    `${formatAccountNumber(body.accountNumber)}  ${body.accountName}`,
    9,
  );
  page.text(320, 732, "Period", 8, true);
  page.text(380, 732, `${day(body.periodStart)} to ${day(body.periodEnd)}`, 9);
  const y = 690;
  page.text(COLUMNS.date, y, "Date", SIZE, true);
  page.text(COLUMNS.description, y, "Description", SIZE, true);
  page.right(COLUMNS.moneyIn, y, "Money in", SIZE, true);
  page.right(COLUMNS.moneyOut, y, "Money out", SIZE, true);
  page.right(COLUMNS.balance, y, "Balance", SIZE, true);
  page.rule(y - 6, 1);
}

function row(page: Page, y: number, line: Row) {
  page.text(COLUMNS.date, y, line.date, SIZE, line.bold);
  if (line.bold) page.text(COLUMNS.description, y, line.description, SIZE, true);
  else
    page.fitted(
      COLUMNS.description,
      y,
      line.description,
      COLUMNS.descriptionMax,
    );
  page.right(COLUMNS.moneyIn, y, line.moneyIn, SIZE, line.bold);
  page.right(COLUMNS.moneyOut, y, line.moneyOut, SIZE, line.bold);
  page.right(COLUMNS.balance, y, line.balance, SIZE, line.bold);
}

/** How many pages a Statement of `lines` lines takes. */
export function statementPageCount(lines: number): number {
  const rows = lines + 1; // the opening balance
  const full = Math.max(1, Math.ceil(rows / ROWS_PER_PAGE));
  const onLast = rows - (full - 1) * ROWS_PER_PAGE;
  return onLast + TOTAL_ROWS > ROWS_PER_PAGE ? full + 1 : full;
}

function layout(body: StatementBody): Page[] {
  const rows: Row[] = [
    {
      date: day(body.periodStart),
      description: "Opening balance",
      moneyIn: "",
      moneyOut: "",
      balance: formatMinor(body.openingBalance),
      bold: true,
    },
    ...body.lines.map((line) => ({
      date: day(line.date),
      description: line.description,
      moneyIn: money(line.moneyIn),
      moneyOut: money(line.moneyOut),
      balance: formatMinor(line.balance),
    })),
  ];
  const count = statementPageCount(body.lines.length);
  const pages: Page[] = [];
  for (let index = 0; index < count; index += 1) {
    const page = new Page();
    watermark(page);
    page.ops.push("0 g");
    header(page, body);
    const slice = rows.slice(
      index * ROWS_PER_PAGE,
      (index + 1) * ROWS_PER_PAGE,
    );
    let y = FIRST_ROW_Y;
    for (const line of slice) {
      row(page, y, line);
      y -= ROW;
    }
    if (index === count - 1) {
      page.rule(y + ROW - 5);
      y -= ROW;
      row(page, y, {
        date: "",
        description: "Total money in and out",
        moneyIn: formatMinor(body.totalIn),
        moneyOut: formatMinor(body.totalOut),
        balance: "",
        bold: true,
      });
      y -= ROW;
      row(page, y, {
        date: day(body.periodEnd),
        description: "Closing balance",
        moneyIn: "",
        moneyOut: "",
        balance: formatMinor(body.closingBalance),
        bold: true,
      });
    }
    page.rule(56, 0.5);
    page.text(
      LEFT,
      44,
      `${body.bankName}. A SPECIMEN statement: not a real bank document.`,
      7,
    );
    page.right(RIGHT, 44, `Page ${index + 1} of ${count}`, 8);
    pages.push(page);
  }
  return pages;
}

// PDF: file --------------------------------------------------------------------

/** A byte string (every char code 0–255) as bytes. */
function bytesOf(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code > 255) throw new Error("A PDF chunk must be bytes.");
    out[index] = code;
  }
  return out;
}

/**
 * A valid, text-only PDF of a Statement: A4, Helvetica, a header, the lines
 * with right-aligned amounts, "Page n of m", totals and the closing balance
 * on the last page, and a SPECIMEN watermark on every page. The xref offsets
 * are counted in bytes as the chunks are written.
 */
export function statementPdf(body: StatementBody): Uint8Array {
  const pages = layout(body);
  const objects: string[] = [];
  const kids = pages.map((_, index) => `${5 + index * 2} 0 R`).join(" ");
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objects.push(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  );
  objects.push(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  );
  pages.forEach((page, index) => {
    const content = page.ops.join("\n");
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + index * 2} 0 R >>`,
    );
    objects.push(
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    );
  });

  const chunks: Uint8Array[] = [];
  let length = 0;
  const write = (text: string) => {
    const bytes = bytesOf(text);
    chunks.push(bytes);
    length += bytes.length;
  };
  // The binary comment tells tools the file is not plain text.
  write("%PDF-1.4\n%âãÏÓ\n");
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(length);
    write(`${index + 1} 0 obj\n${object}\nendobj\n`);
  });
  const xref = length;
  write(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (const offset of offsets) {
    write(`${String(offset).padStart(10, "0")} 00000 n \n`);
  }
  write(
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
  );

  const file = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    file.set(chunk, at);
    at += chunk.length;
  }
  return file;
}

/** "tidewater-1000000427-2026-10.pdf". */
export function statementFileName(
  body: Pick<StatementBody, "accountNumber" | "periodStart">,
  extension: "pdf" | "csv",
): string {
  return `tidewater-${body.accountNumber}-${body.periodStart.slice(0, 7)}.${extension}`;
}
