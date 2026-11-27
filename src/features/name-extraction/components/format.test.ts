import { describe, expect, it } from "vitest";
import type { ExtractedName } from "../domain/contract";
import { namesCsv } from "./format";

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

describe("the Register's CSV export", () => {
  it("quotes fields and defuses formulas", () => {
    const csv = namesCsv([ana], 0.6);
    const [header, row] = csv.trim().split("\r\n");
    expect(header.startsWith("canonical,type,aliases")).toBe(true);
    expect(row).toContain('"A. Vos; Ana ""AV"" Vos"');
    expect(row).toContain(",4,2 3 9,0.50,yes,");
    expect(row.endsWith("'=HYPERLINK(1)")).toBe(true);
  });
});
