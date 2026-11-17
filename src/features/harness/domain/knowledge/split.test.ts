import { describe, expect, it } from "vitest";
import { LIMITS } from "../limits";
import { pdfText } from "./pdf-text";
import {
  embeddingText,
  MAX_CHARS,
  parseCsv,
  sections,
  splitProse,
  splitSheets,
  splitSource,
  splitTable,
  TARGET_CHARS,
} from "./split";

const paragraph = (word: string, sentences: number) =>
  Array.from(
    { length: sentences },
    (_, i) => `${word} sentence ${i + 1} says something plain.`,
  ).join(" ");

describe("sections", () => {
  it("keeps the heading trail of nested headings", () => {
    const found = sections(
      "# Guide\nintro\n\n## Rates\nfive percent\n\n### Late\nprime plus five\n\n## Records\nfive years",
    );
    expect(found.map((section) => section.heading)).toEqual([
      "Guide",
      "Guide › Rates",
      "Guide › Rates › Late",
      "Guide › Records",
    ]);
  });

  it("turns [page N] marks into headings and ignores # inside code fences", () => {
    const found = sections(
      "[page 1]\nfirst\n\n[page 2]\n```\n# not a heading\n```\nsecond",
    );
    expect(found.map((section) => section.heading)).toEqual([
      "Page 1",
      "Page 2",
    ]);
    expect(found[1]?.text).toContain("# not a heading");
  });
});

describe("splitProse", () => {
  it("makes one Passage of a short section and keeps its heading", () => {
    const passages = splitProse(
      "# Due dates\nPay by the 15th of the following month.",
    );
    expect(passages).toEqual([
      { heading: "Due dates", body: "Pay by the 15th of the following month." },
    ]);
  });

  it("splits a long section near the target size, with overlap, inside the cap", () => {
    const text = `# Long\n${Array.from({ length: 12 }, (_, i) => paragraph(`P${i}`, 4)).join("\n\n")}`;
    const passages = splitProse(text);
    expect(passages.length).toBeGreaterThan(2);
    for (const passage of passages) {
      expect(passage.heading).toBe("Long");
      expect(passage.body.length).toBeLessThanOrEqual(MAX_CHARS);
    }
    // The next Passage opens with the tail of the one before, so a cut sentence is whole in one.
    expect(passages[1]?.body.startsWith("… ")).toBe(true);
    const lead = (passages[1]?.body.slice(2).split("\n\n")[0] ?? "").slice(
      0,
      30,
    );
    expect(passages[0]?.body).toContain(lead);
  });

  it("does not carry overlap across a heading", () => {
    const passages = splitProse(`# A\n${paragraph("A", 30)}\n\n# B\nshort`);
    expect(passages.at(-1)).toEqual({ heading: "B", body: "short" });
  });

  it("cuts a long Markdown table into row groups that repeat the header", () => {
    const rows = Array.from(
      { length: 60 },
      (_, i) => `| Row ${i} | value ${i} |`,
    );
    const table = ["| Item | Value |", "|---|---|", ...rows].join("\n");
    const passages = splitProse(`# Forms\n${table}`);
    expect(passages.length).toBeGreaterThan(1);
    for (const passage of passages) {
      expect(passage.body.startsWith("| Item | Value |\n|---|---|")).toBe(true);
    }
    const all = passages.map((passage) => passage.body).join("\n");
    expect(all).toContain("| Row 59 | value 59 |");
  });

  it("breaks one huge paragraph at sentence ends", () => {
    const passages = splitProse(paragraph("Huge", 120));
    expect(passages.length).toBeGreaterThan(3);
    for (const passage of passages) {
      expect(passage.body.length).toBeLessThanOrEqual(MAX_CHARS);
      expect(passage.body).toMatch(/\.$/);
    }
  });

  it("returns nothing for empty text", () => {
    expect(splitProse("  \n\n ")).toEqual([]);
  });
});

describe("parseCsv", () => {
  it("reads quotes, doubled quotes, commas and newlines inside quotes", () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n1,2,3\n\n"x\ny",,')).toEqual([
      ["a", "b, c", 'say "hi"'],
      ["1", "2", "3"],
      ["x\ny", "", ""],
    ]);
  });

  it("drops a byte order mark and blank lines", () => {
    expect(parseCsv("\uFEFFa,b\n\n\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("splitTable and splitSheets", () => {
  const header = ["Annual earnings (CI$)", "Employer 5% (CI$)"];
  const rows = Array.from({ length: 200 }, (_, i) => [
    String(i * 1000),
    String(i * 50),
  ]);

  it("repeats the header row in every row group so a number keeps its column names", () => {
    const passages = splitTable([header, ...rows], "Contributions");
    expect(passages.length).toBeGreaterThan(1);
    for (const passage of passages) {
      expect(passage.body.split("\n")[0]).toBe(
        "Annual earnings (CI$),Employer 5% (CI$)",
      );
      expect(passage.body.length).toBeLessThanOrEqual(TARGET_CHARS + 60);
    }
    expect(passages[0]?.heading).toMatch(/^Contributions, rows 1-\d+$/);
  });

  it("covers every row exactly once", () => {
    const passages = splitTable([header, ...rows], "T");
    const lines = passages.flatMap((passage) =>
      passage.body.split("\n").slice(1),
    );
    expect(lines).toHaveLength(rows.length);
    expect(lines.at(-1)).toBe("199000,9950");
  });

  it("keeps a header-only sheet as one Passage", () => {
    expect(splitTable([header], "Empty")).toEqual([
      { heading: "Empty", body: "Annual earnings (CI$),Employer 5% (CI$)" },
    ]);
  });

  it("gives each sheet of a workbook its own Passages, named for the sheet", () => {
    const text =
      "## Sheet: Rates (2 rows)\nItem,Rate\nEmployer,5%\n\n## Sheet: Fees and limits (2 rows)\nItem,Limit\nFee,50";
    const passages = splitSheets(text);
    expect(passages).toEqual([
      { heading: "Rates, row 1", body: "Item,Rate\nEmployer,5%" },
      { heading: "Fees and limits, row 1", body: "Item,Limit\nFee,50" },
    ]);
  });

  it("reads a plain CSV as one table", () => {
    const passages = splitSheets("a,b\n1,2\n3,4", "Contribution table");
    expect(passages).toHaveLength(1);
    expect(passages[0]?.heading).toBe("Contribution table, rows 1-2");
  });
});

describe("splitSource", () => {
  it("sends sheets and CSVs to the table splitter and the rest to prose", () => {
    expect(splitSource("csv", "a,b\n1,2").passages[0]?.body).toBe("a,b\n1,2");
    expect(splitSource("text", "# H\nbody").passages[0]).toEqual({
      heading: "H",
      body: "body",
    });
  });

  it("caps the Passages of one Source and says it cut", () => {
    const text = Array.from(
      { length: LIMITS.passagesPerSource + 30 },
      (_, i) => `# H${i}\nbody ${i}`,
    ).join("\n");
    const result = splitSource("text", text);
    expect(result.passages).toHaveLength(LIMITS.passagesPerSource);
    expect(result.truncated).toBe(true);
  });
});

describe("embeddingText", () => {
  it("puts the heading in front of the body", () => {
    expect(embeddingText({ heading: "Rates", body: "5%" })).toBe("Rates\n\n5%");
    expect(embeddingText({ heading: null, body: "5%" })).toBe("5%");
  });
});

describe("pdfText", () => {
  const line = (page: number, y0: number, text: string) => ({
    page,
    text,
    box: { y0, y1: y0 + 0.02 },
  });

  it("marks each page and keeps a paragraph's lines together, a gap as a blank line", () => {
    const text = pdfText([
      line(1, 0.1, "Heading"),
      line(1, 0.12, "first line of a paragraph"),
      line(1, 0.14, "second line"),
      line(1, 0.25, "a new paragraph"),
      line(2, 0.1, "page two"),
    ]);
    expect(text).toBe(
      "[page 1]\nHeading\nfirst line of a paragraph\nsecond line\n\na new paragraph\n\n[page 2]\npage two",
    );
    const passages = splitProse(text);
    expect(passages.map((passage) => passage.heading)).toEqual([
      "Page 1",
      "Page 2",
    ]);
  });
});
