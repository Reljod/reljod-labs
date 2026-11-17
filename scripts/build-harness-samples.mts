/**
 * Writes the Harness's sample Schedules and remittance advice to
 * `public/harness/samples/` from the sample book, so their lines and
 * amounts agree with what a Workspace is seeded with:
 *
 *   schedule-pelican-shoal.csv          clean Schedule (ER-1001)
 *   schedule-calloway-bight.xlsx        4% employer share and a stranger (ER-1005)
 *   remittance-advice-pelican-shoal.txt the payment for the clean Schedule
 *
 * The XLSX parts are built by hand and zipped with fflate, as in
 * `build-client-manager-xlsx.mts`. Safe to re-run; the output is
 * byte-identical.
 *
 *   node --experimental-strip-types scripts/build-harness-samples.mts
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
// Node runs this file as is, so the import names the `.ts` file; tsc only checks it.
// @ts-expect-error TS5097: an import ending in .ts needs allowImportingTsExtensions.
import * as book from "../src/features/harness/domain/pipelines/sample-book.ts";

const { linesTotal, ROSTER_EMPLOYERS, UPLOAD_SCHEDULES } = book;
type SampleLine = (typeof UPLOAD_SCHEDULES)["clean"]["lines"][number];

const OUT = join(import.meta.dirname, "../public/harness/samples");
const SPECIMEN =
  "SPECIMEN - fictional contribution Schedule for the Harbour Bank & Trust demo. Not a real employer or person.";

const employerOf = (code: string) => {
  const employer = ROSTER_EMPLOYERS.find((item) => item.code === code);
  if (!employer) throw new Error(`No employer ${code}`);
  return employer;
};

const fixed = (value: number) => value.toFixed(2);

function sums(lines: SampleLine[]) {
  const add = (pick: (line: SampleLine) => number) =>
    Math.round(lines.reduce((sum, line) => sum + pick(line), 0) * 100) / 100;
  return {
    earnings: add((line) => line.earningsKyd),
    employee: add((line) => line.employeeKyd),
    employer: add((line) => line.employerKyd),
    voluntary: add((line) => line.voluntaryKyd),
  };
}

// CSV ---------------------------------------------------------------------------------

async function writeCsv() {
  const { employerCode, lines } = UPLOAD_SCHEDULES.clean;
  const employer = employerOf(employerCode);
  const total = sums(lines);
  const rows = [
    `# ${SPECIMEN}`,
    `# Employer: ${employer.name} (${employer.code})`,
    "# Contribution month: last month (give the month when you start the Run if it is another)",
    "member_no,member_name,earnings_kyd,employee_kyd,employer_kyd,voluntary_kyd",
    ...lines.map((line) =>
      [
        line.memberNo,
        `"${line.memberName}"`,
        fixed(line.earningsKyd),
        fixed(line.employeeKyd),
        fixed(line.employerKyd),
        fixed(line.voluntaryKyd),
      ].join(","),
    ),
    [
      "Total",
      "",
      fixed(total.earnings),
      fixed(total.employee),
      fixed(total.employer),
      fixed(total.voluntary),
    ].join(","),
  ];
  await writeFile(
    join(OUT, "schedule-pelican-shoal.csv"),
    `${rows.join("\n")}\n`,
  );
}

// XLSX --------------------------------------------------------------------------------

type Cell = string | number | null;

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

function cellXml(value: Cell, column: number, row: number, bold: boolean) {
  if (value === null) return "";
  const ref = `${columnName(column)}${row}`;
  if (typeof value === "number") {
    return `<c r="${ref}" s="${bold ? 1 : 2}"><v>${value}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"${bold ? ' s="1"' : ""}><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

async function writeXlsx() {
  const { employerCode, lines } = UPLOAD_SCHEDULES.wrongRate;
  const employer = employerOf(employerCode);
  const total = sums(lines);
  const header = [
    "Member number",
    "Member name",
    "Gross earnings (CI$)",
    "Employee contribution (CI$)",
    "Employer contribution (CI$)",
    "Voluntary (CI$)",
  ];
  const rows: { cells: Cell[]; bold?: boolean }[] = [
    { cells: [SPECIMEN], bold: true },
    { cells: [`Employer: ${employer.name} (${employer.code})`] },
    { cells: ["Contribution month: last month"] },
    { cells: [] },
    { cells: header, bold: true },
    ...lines.map((line) => ({
      cells: [
        line.memberNo,
        line.memberName,
        line.earningsKyd,
        line.employeeKyd,
        line.employerKyd,
        line.voluntaryKyd,
      ] as Cell[],
    })),
    {
      cells: [
        "Total",
        null,
        total.earnings,
        total.employee,
        total.employer,
        total.voluntary,
      ],
      bold: true,
    },
  ];
  const sheetRows = rows
    .map((row, index) => {
      const number = index + 1;
      return `<row r="${number}">${row.cells.map((value, column) => cellXml(value, column, number, Boolean(row.bold))).join("")}</row>`;
    })
    .join("");
  const widths = [16, 30, 20, 26, 26, 16];
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:F${rows.length}"/><cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("")}</cols><sheetData>${sheetRows}</sheetData></worksheet>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="4" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const parts: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Schedule" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": styles,
    "xl/worksheets/sheet1.xml": sheet,
  };
  const mtime = new Date("2026-11-01T09:00:00Z");
  const zip = zipSync(
    Object.fromEntries(
      Object.entries(parts).map(([name, xml]) => [
        name,
        [strToU8(xml), { mtime }],
      ]),
    ),
    { level: 9 },
  );
  await writeFile(join(OUT, "schedule-calloway-bight.xlsx"), zip);
}

// Remittance advice ------------------------------------------------------------------------

async function writeAdvice() {
  const { employerCode, lines } = UPLOAD_SCHEDULES.clean;
  const employer = employerOf(employerCode);
  const text = `SPECIMEN - fictional remittance advice for the Harbour Bank & Trust demo. Not a real employer or payment.

REMITTANCE ADVICE

From: ${employer.name} (${employer.code})
To: Pensions Operations Desk, Harbour Bank & Trust
Contribution month: last month
Reference: ${employer.code} pension contributions
Amount: CI$${linesTotal(lines).toLocaleString("en-US", { minimumFractionDigits: 2 })}
Paid by: bank transfer, by the 15th as required
Lines on the Schedule: ${lines.length}

Please apply this payment to the contribution Schedule we sent for the same month.
Contact: ${employer.contactEmail}
`;
  await writeFile(join(OUT, "remittance-advice-pelican-shoal.txt"), text);
}

await writeCsv();
await writeXlsx();
await writeAdvice();
console.log(`Wrote the Harness sample Schedules to ${OUT}`);
