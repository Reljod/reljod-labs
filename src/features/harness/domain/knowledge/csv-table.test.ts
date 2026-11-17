import { describe, expect, it } from "vitest";
import { parseCsv, sheetTables, tableOf } from "./csv-table";

describe("parseCsv", () => {
  it("reads quoted cells, doubled quotes and line breaks inside quotes", () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\n"two\nlines",z\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
      ["two\nlines", "z"],
    ]);
  });

  it("keeps empty cells and drops the empty last line", () => {
    expect(parseCsv("a,,c\n,,\n")).toEqual([
      ["a", "", "c"],
      ["", "", ""],
    ]);
    expect(parseCsv("")).toEqual([]);
  });

  it("skips a byte order mark", () => {
    expect(parseCsv("﻿id,name\n1,Ann")).toEqual([
      ["id", "name"],
      ["1", "Ann"],
    ]);
  });
});

describe("sheetTables", () => {
  it("splits a workbook's text into its sheets", () => {
    const text =
      "## Sheet: March (2 rows)\nid,amt\n1,10\n\n## Sheet: Notes (1 rows)\nhello";
    expect(sheetTables(text)).toEqual([
      {
        name: "March",
        rows: [
          ["id", "amt"],
          ["1", "10"],
        ],
      },
      { name: "Notes", rows: [["hello"]] },
    ]);
  });

  it("treats text with no sheet heading as one table", () => {
    expect(sheetTables("a,b\n1,2")).toEqual([
      {
        name: "Sheet",
        rows: [
          ["a", "b"],
          ["1", "2"],
        ],
      },
    ]);
  });
});

describe("tableOf", () => {
  it("takes leading # lines as notes and the next row as the header", () => {
    const rows = parseCsv(
      "# SPECIMEN, fictional\n# Employer: ER-1001\nmember_no,name,kyd\nHB-1,Ann,10\nTotal,,10,extra\n",
    );
    expect(tableOf(rows)).toEqual({
      notes: ["# SPECIMEN, fictional", "# Employer: ER-1001"],
      head: ["member_no", "name", "kyd"],
      body: [
        ["HB-1", "Ann", "10"],
        ["Total", "", "10", "extra"],
      ],
      columns: 4,
    });
  });

  it("is empty for no rows", () => {
    expect(tableOf([])).toEqual({ notes: [], head: [], body: [], columns: 0 });
  });
});
