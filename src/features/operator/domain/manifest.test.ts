import { describe, expect, it } from "vitest";
import { MANIFEST_MAX_ROWS, parseManifest } from "./manifest";

const HEADER = `# SPECIMEN - Port Authority of Meridia - cargo manifest
vessel,MV CORVINA
voyage,0412N
container,iso_type,seal,gross_kg,pol,consignee,haz,goods`;

describe("parseManifest", () => {
  it("reads the CSV the samples use", () => {
    const parsed = parseManifest(`${HEADER}
MRDU 482113 1,22G1,MS0412001,18250,MRKLD,C0412,,CANNED TOMATOES

VNTU2755604,22T6,MS0412005,23480,MRVNT,C0312,3,solvent naphtha
`);
    expect(parsed).toEqual({
      vessel: "MV CORVINA",
      voyage: "0412N",
      problems: [],
      lines: [
        {
          container: "MRDU4821131",
          isoType: "22G1",
          seal: "MS0412001",
          grossKg: 18250,
          pol: "MRKLD",
          consignee: "C0412",
          goods: "CANNED TOMATOES",
          haz: "",
        },
        {
          container: "VNTU2755604",
          isoType: "22T6",
          seal: "MS0412005",
          grossKg: 23480,
          pol: "MRVNT",
          consignee: "C0312",
          goods: "SOLVENT NAPHTHA",
          haz: "3",
        },
      ],
    });
  });

  it("keeps commas in goods, quoted or not", () => {
    const parsed = parseManifest(`${HEADER}
KLDU1188345,45G1,MS0412003,24600,MRKLD,C0207,,"MACHINE PARTS, AGRICULTURAL, CRATED"
HBRU6400910,45R1,MS0412004,27310,MRVNT,C0096,,FISH, FROZEN
MRLU9033177,42G1,MS0412006,7625,MRPSA,C0288,,"BASKETS ""WICKER"""
`);
    expect(parsed.problems).toEqual([]);
    expect(parsed.lines.map((l) => l.goods)).toEqual([
      "MACHINE PARTS, AGRICULTURAL, CRATED",
      "FISH, FROZEN",
      'BASKETS "WICKER"',
    ]);
  });

  it("reads columns pulled out of a PDF: tabs or two or more spaces", () => {
    const parsed =
      parseManifest(`# SPECIMEN - Port Authority of Meridia - cargo manifest
vessel   MV CORVINA
voyage: 0412N
container     iso_type  seal       gross_kg  pol    consignee  haz  goods
MRDU 482113 1  22G1  MS0412001  18250  MRKLD  C0412  -  CANNED TOMATOES
VNTU2755604\t22T6\tMS0412005\t23480\tMRVNT\tC0312\t3\tSOLVENT NAPHTHA
MRLU9033177   42G1   MS0412006   7625   MRPSA   C0288   WICKER BASKETS, LARGE
`);
    expect(parsed.problems).toEqual([]);
    expect(parsed.vessel).toBe("MV CORVINA");
    expect(parsed.voyage).toBe("0412N");
    expect(
      parsed.lines.map((l) => [l.container, l.grossKg, l.haz, l.goods]),
    ).toEqual([
      ["MRDU4821131", 18250, "", "CANNED TOMATOES"],
      ["VNTU2755604", 23480, "3", "SOLVENT NAPHTHA"],
      ["MRLU9033177", 7625, "", "WICKER BASKETS, LARGE"],
    ]);
  });

  it("reports what it could not read and carries on", () => {
    const parsed = parseManifest(`${HEADER}
MRDU4821130,22G1,MS0412001,18250,MRKLD,C0412,,BAD CHECK DIGIT
MRDU5077261,22G1,MS0412002,heavy,MRKLD,C0412,,BAD WEIGHT
half,a,row
`);
    expect(parsed.lines).toHaveLength(2);
    expect(parsed.lines[1].grossKg).toBe(0);
    expect(parsed.problems).toHaveLength(3);
    expect(parsed.problems[0]).toContain("ISO 6346");
    expect(parsed.problems[1]).toContain("not a number");
    expect(parsed.problems[2]).toContain("expected 8 columns, found 3");
  });

  it("keeps 60 rows and says how many it dropped", () => {
    const row = "MRDU5077261,22G1,MS0412002,9840,MRKLD,C0412,,OLIVE OIL";
    const parsed = parseManifest(
      `${HEADER}\n${Array.from({ length: 63 }, () => row).join("\r\n")}`,
    );
    expect(parsed.lines).toHaveLength(MANIFEST_MAX_ROWS);
    expect(parsed.problems).toEqual([
      "Only the first 60 rows are kept; 3 more were dropped.",
    ]);
  });

  it("never throws", () => {
    expect(parseManifest("")).toEqual({ lines: [], problems: [] });
    expect(parseManifest("\n\n# only a comment\n").lines).toEqual([]);
    expect(parseManifest(',,,,,,,\n"unclosed,quote').lines.length).toBe(1);
    expect(parseManifest(undefined as unknown as string).problems).toHaveLength(
      1,
    );
  });
});
