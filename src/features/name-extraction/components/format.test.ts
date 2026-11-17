import { describe, expect, it } from "vitest";
import type { ExtractedName } from "../domain/contract";
import { fileStem, namesCsv, pageRanges, pagesOf, tokens, usd } from "./format";

const ana: ExtractedName = {
  canonical: "Ana Lucía Ferreira-Vos",
  type: "person",
  aliases: ["A. Vos", 'Ana "AV" Vos'],
  roles: ["beneficial_owner"],
  mentions: [
    { page: 9, quote: "A. Vos" },
    { page: 2, quote: "Ana Lucía Ferreira-Vos" },
    { page: 3, quote: "Ferreira-Vos" },
    { page: 2, quote: "Ms Vos" },
  ],
  confidence: 0.5,
  foundBy: ["sweep", "reader"],
  note: "=HYPERLINK(1)",
};

describe("format", () => {
  it("lists a Name's pages once each, in order, and as ranges", () => {
    expect(pagesOf(ana)).toEqual([2, 3, 9]);
    expect(pageRanges([2, 3, 4, 9, 11, 12])).toBe("2–4, 9, 11–12");
    expect(pageRanges([])).toBe("");
  });

  it("writes the Register as CSV, quoting and defusing formulas", () => {
    const csv = namesCsv([ana], 0.6);
    const [header, row] = csv.trim().split("\r\n");
    expect(header.startsWith("canonical,type,aliases")).toBe(true);
    expect(row).toContain('"A. Vos; Ana ""AV"" Vos"');
    expect(row).toContain(",4,2 3 9,0.50,yes,");
    expect(row.endsWith("'=HYPERLINK(1)")).toBe(true);
  });

  it("formats money, tokens and file names", () => {
    expect(usd(0)).toBe("$0.00");
    expect(usd(0.0042)).toBe("$0.0042");
    expect(usd(1.5)).toBe("$1.50");
    expect(tokens(1530)).toBe("1.5k");
    expect(fileStem("KYC file: Orbis / 2026")).toBe("kyc-file-orbis-2026");
  });
});
