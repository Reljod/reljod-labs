/**
 * Writes the synthetic angel portfolio workbook for the Client Manager demo
 * to `fixtures/client-manager/rafael-okoro/angel-portfolio.xlsx`. The Office
 * Open XML parts are built by hand and zipped with fflate, so no spreadsheet
 * library is needed. Run `pnpm render:client-manager-samples` afterwards to
 * copy it to `public/`.
 *
 *   node --experimental-strip-types scripts/build-client-manager-xlsx.mts
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";

const OUT = join(
  import.meta.dirname,
  "../fixtures/client-manager/rafael-okoro/angel-portfolio.xlsx",
);

type Cell = string | number | null;
type Row = { cells: Cell[]; style?: number };

const STYLE = { plain: 0, bold: 1, money: 2, title: 3, note: 4 } as const;

const HEADER = [
  "Company",
  "Sector",
  "Date invested",
  "Amount invested (M$)",
  "Instrument",
  "Key terms",
  "Stake %",
  "Status",
  "Valuation basis",
  "Estimated value (M$)",
  "Notes",
];

const INVESTMENTS: Cell[][] = [
  [
    "Pallas Bio Ltd",
    "Diagnostics",
    "2022-03-14",
    250000,
    "Seed preferred (SAFE converted Sep 2023)",
    "SAFE valuation cap M$10M",
    2.1,
    "Active: raising Series A, has asked Rafael to lead",
    "Seed round Sep 2023 at M$14M post-money",
    294000,
    "Series A target M$20M; lead ticket requested M$1.5M; term sheet expected Q1 2027",
  ],
  [
    "Brightwater Robotics Ltd",
    "Warehouse robotics",
    "2022-09-05",
    150000,
    "Seed preferred",
    "M$0.85 per share, 1x non-participating preference",
    1.4,
    "Active",
    "Series A Jun 2025 at M$32M post-money",
    448000,
    "Lumen Freight customer; conflict disclosed to the Lumen board on 9 Sep 2022",
  ],
  [
    "Fennick Pay Ltd",
    "Payments",
    "2023-01-20",
    100000,
    "Convertible note",
    "8% simple interest, cap M$12M, matures 20 Jan 2027",
    "n/a until conversion",
    "Active: note outstanding",
    "Principal plus accrued interest",
    130400,
    "Converts at next qualified round; if none by maturity, choose repayment or conversion at cap",
  ],
  [
    "Tallis Learning Ltd",
    "Education",
    "2023-11-09",
    75000,
    "SAFE",
    "Valuation cap M$6M, 20% discount",
    "n/a until conversion",
    "Impaired: runway to Feb 2027, seeking a buyer",
    "Written down 50% by Okoro Ventures, Jun 2026",
    37500,
    "Possible loss relief claim if the company fails",
  ],
];

const rows: Row[] = [
  {
    cells: ["Okoro Ventures Ltd: angel portfolio (company no. MC-0533190)"],
    style: STYLE.title,
  },
  {
    cells: [
      "Owner and director: Rafael Okoro. Company secretary: Dr Ada Okoro. As at 31 October 2026. All amounts in Meridian dollars (M$).",
    ],
    style: STYLE.note,
  },
  { cells: [] },
  { cells: HEADER, style: STYLE.bold },
  ...INVESTMENTS.map((cells) => ({ cells })),
  {
    cells: [
      "Total",
      null,
      null,
      INVESTMENTS.reduce((sum, row) => sum + Number(row[3]), 0),
      null,
      null,
      null,
      null,
      null,
      INVESTMENTS.reduce((sum, row) => sum + Number(row[9]), 0),
      null,
    ],
    style: STYLE.bold,
  },
  { cells: [] },
  {
    cells: [
      "Funded by director's loan from Rafael Okoro (M$585,000 at 30 Jun 2026). Estimated values are the owner's own marks, not independent valuations.",
    ],
    style: STYLE.note,
  },
  {
    cells: [
      "SPECIMEN. Synthetic document for the Reljod Labs Client Manager demo. Not a real record.",
    ],
    style: STYLE.note,
  },
];

const MONEY_COLUMNS = new Set([3, 9]);

function escapeXml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function columnName(index: number) {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

function cellXml(
  value: Cell,
  column: number,
  row: number,
  rowStyle: number | undefined,
) {
  if (value === null) return "";
  const ref = `${columnName(column)}${row}`;
  if (typeof value === "number") {
    const money = MONEY_COLUMNS.has(column);
    const style =
      rowStyle === STYLE.bold ? STYLE.bold : money ? STYLE.money : 0;
    return `<c r="${ref}"${style ? ` s="${style}"` : ""}><v>${value}</v></c>`;
  }
  const style = rowStyle ? ` s="${rowStyle}"` : "";
  return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

const sheetRows = rows
  .map((row, rowIndex) => {
    const number = rowIndex + 1;
    const cells = row.cells
      .map((value, column) => cellXml(value, column, number, row.style))
      .join("");
    return `<row r="${number}">${cells}</row>`;
  })
  .join("");

const widths = [26, 20, 14, 20, 36, 40, 18, 40, 38, 20, 70];
const lastRef = `${columnName(HEADER.length - 1)}${rows.length}`;

const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:${lastRef}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths
  .map(
    (width, index) =>
      `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`,
  )
  .join("")}</cols><sheetData>${sheetRows}</sheetData></worksheet>`;

const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF5B6672"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="3" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

const parts: Record<string, string> = {
  "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
  "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
  "docProps/core.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Okoro Ventures Ltd angel portfolio (SPECIMEN)</dc:title><dc:creator>Reljod Labs synthetic data</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">2026-10-31T09:00:00Z</dcterms:created></cp:coreProperties>`,
  "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Angel portfolio" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  "xl/styles.xml": styles,
  "xl/worksheets/sheet1.xml": sheet,
};

// A fixed timestamp keeps the zip byte-identical across runs.
const mtime = new Date("2026-10-31T09:00:00Z");
const zip = zipSync(
  Object.fromEntries(
    Object.entries(parts).map(([name, xml]) => [
      name,
      [strToU8(xml), { mtime }],
    ]),
  ),
  { level: 9 },
);
await writeFile(OUT, zip);
console.log(`Wrote ${OUT} (${zip.byteLength} bytes)`);
