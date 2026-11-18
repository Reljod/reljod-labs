import { describe, expect, it } from "vitest";
import {
  csvCell,
  plainDecimal,
  pdfEscape,
  statementCsv,
  statementPageCount,
  statementPdf,
  textWidth,
  toWinAnsi,
} from "./statement-files";
import type { StatementBody, StatementLine } from "./views";

function body(lineCount: number): StatementBody {
  const lines: StatementLine[] = [];
  let balance = 100_000;
  for (let index = 0; index < lineCount; index += 1) {
    const moneyIn = index % 2 === 0 ? 2_550 : 0;
    const moneyOut = index % 2 === 0 ? 0 : 1_000;
    balance += moneyIn - moneyOut;
    lines.push({
      date: "2026-10-05",
      description: `Line ${index + 1} at Harbour Market (Pier 4)`,
      moneyIn,
      moneyOut,
      balance,
    });
  }
  return {
    bankName: "Tidewater Bank",
    customerName: "Mara Voss",
    customerAddress: "12 Quay Street, Port Meridia",
    accountNumber: "1000000427",
    accountName: "Everyday",
    periodStart: "2026-10-01",
    periodEnd: "2026-10-31",
    openingBalance: 100_000,
    closingBalance: balance,
    totalIn: lines.reduce((sum, line) => sum + line.moneyIn, 0),
    totalOut: lines.reduce((sum, line) => sum + line.moneyOut, 0),
    lines,
  };
}

const latin1 = (bytes: Uint8Array) => {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text;
};

describe("statementCsv", () => {
  it("writes a header, the opening balance, each line and the closing totals", () => {
    const csv = statementCsv(body(2));
    const rows = csv.trimEnd().split("\r\n");
    expect(rows[0]).toBe("Date,Description,Money in,Money out,Balance");
    expect(rows[1]).toBe("2026-10-01,Opening balance,,,1000.00");
    expect(rows[2]).toBe(
      "2026-10-05,Line 1 at Harbour Market (Pier 4),25.50,,1025.50",
    );
    expect(rows[3]).toBe(
      "2026-10-05,Line 2 at Harbour Market (Pier 4),,10.00,1015.50",
    );
    expect(rows[4]).toBe("2026-10-31,Closing balance,25.50,10.00,1015.50");
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("quotes commas, quotes and line breaks (RFC 4180)", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a, b")).toBe('"a, b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
  });

  it("keeps a cell that looks like a formula as text", () => {
    expect(csvCell("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-2")).toBe("'-2");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell('=HYPERLINK("x",1)')).toBe(`"'=HYPERLINK(""x"",1)"`);
    const statement = body(1);
    statement.lines[0] = {
      ...(statement.lines[0] as StatementLine),
      description: "=cmd|' /C calc'!A0",
    };
    expect(statementCsv(statement)).toContain(",'=cmd|' /C calc'!A0,");
  });

  it("writes amounts as plain decimals, sign kept", () => {
    expect(plainDecimal(123_450)).toBe("1234.50");
    expect(plainDecimal(5)).toBe("0.05");
    expect(plainDecimal(-1_000)).toBe("-10.00");
    expect(plainDecimal(0)).toBe("0.00");
  });
});

describe("statementPdf", () => {
  it("is a PDF from the first byte to %%EOF", () => {
    const text = latin1(statementPdf(body(5)));
    expect(text.startsWith("%PDF-1.")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text).toContain("(SPECIMEN) Tj");
  });

  it.each([
    [5, 1],
    [120, 3],
  ])("puts %i lines on %i page(s), each numbered and watermarked", (lines, pages) => {
    expect(statementPageCount(lines)).toBe(pages);
    const text = latin1(statementPdf(body(lines)));
    expect(text.match(/\/Type \/Page\b(?!s)/g)).toHaveLength(pages);
    expect(text).toContain(`/Count ${pages}`);
    expect(text.match(/\(SPECIMEN\) Tj/g)).toHaveLength(pages);
    expect(text).toContain(`(Page ${pages} of ${pages}) Tj`);
    expect(text).toContain("(Closing balance) Tj");
  });

  it("points every xref offset at its object, and startxref at the table", () => {
    const text = latin1(statementPdf(body(120)));
    const startxref = Number(text.match(/startxref\n(\d+)\n%%EOF/)?.[1]);
    expect(text.slice(startxref, startxref + 4)).toBe("xref");
    const table = text.slice(startxref).split("\n");
    const count = Number(table[1]?.split(" ")[1]);
    expect(count).toBeGreaterThan(5);
    for (let object = 1; object < count; object += 1) {
      const entry = table[2 + object] ?? "";
      expect(entry).toMatch(/^\d{10} 00000 n $/);
      const offset = Number(entry.slice(0, 10));
      expect(text.slice(offset, offset + `${object} 0 obj`.length)).toBe(
        `${object} 0 obj`,
      );
    }
  });

  it("gives each content stream its exact byte length", () => {
    const text = latin1(statementPdf(body(5)));
    for (const match of text.matchAll(
      /<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g,
    )) {
      expect(match[2]?.length).toBe(Number(match[1]));
    }
  });

  it("escapes parentheses and backslashes, and replaces what WinAnsi cannot show", () => {
    expect(pdfEscape("a (b) \\ c")).toBe("a \\(b\\) \\\\ c");
    expect(toWinAnsi("Café – 5€ 漢")).toBe(
      `Café ${String.fromCharCode(0x96)} 5${String.fromCharCode(0x80)} ?`,
    );
    const statement = body(1);
    statement.customerName = "Zoë (née Ålund) 漢字";
    const text = latin1(statementPdf(statement));
    expect(text).toContain("(Zoë \\(née Ålund\\) ??) Tj");
  });

  it("measures amounts with Helvetica's digit widths", () => {
    expect(textWidth("1,234.50", 1000)).toBe(6 * 556 + 2 * 278);
  });
});
