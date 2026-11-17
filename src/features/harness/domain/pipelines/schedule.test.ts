import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readXlsx } from "@/features/client-manager/domain/office";
import { csvRows, parseSchedule, scheduleTotal } from "./schedule";

const SAMPLES = join(process.cwd(), "public/harness/samples");

describe("csvRows", () => {
  it("honours quotes, doubled quotes and CRLF", () => {
    expect(csvRows('a,"b, c","say ""hi"""\r\n1,2,3')).toEqual([
      ["a", "b, c", 'say "hi"'],
      ["1", "2", "3"],
    ]);
  });
});

describe("parseSchedule", () => {
  it("reads notes, any column order, CI$ amounts and skips the Total row", () => {
    const text = [
      "Contribution schedule",
      "Employer: Tamarind Row Retail Ltd (ER-1006)",
      "Period: 2026-10",
      "",
      "Employer contribution,Member number,Gross earnings,Employee contribution,Member name",
      '"CI$1,000.00",hb-10036,"CI$20,000.00",362.50,Fitzgerald Arch-Bowen',
      "Total,,,,",
    ].join("\n");
    const parsed = parseSchedule(text);
    expect(parsed.employerCode).toBe("ER-1006");
    expect(parsed.employerName).toBe("Tamarind Row Retail Ltd");
    expect(parsed.period).toBe("2026-10");
    expect(parsed.lines).toEqual([
      {
        line: 1,
        memberNo: "HB-10036",
        memberName: "Fitzgerald Arch-Bowen",
        earningsKyd: 20000,
        employeeKyd: 362.5,
        employerKyd: 1000,
        voluntaryKyd: 0,
      },
    ]);
    expect(parsed.problems).toEqual([]);
  });
  it("leaves out a line it cannot read and says so", () => {
    const parsed = parseSchedule(
      "member_no,earnings_kyd,employee_kyd,employer_kyd\nHB-1,100,5,5\nHB-2,lots,5,5\n,100,5,5",
    );
    expect(parsed.lines.map((line) => line.memberNo)).toEqual(["HB-1"]);
    expect(parsed.problems).toHaveLength(2);
  });
  it("refuses a file without a header row", () => {
    const parsed = parseSchedule("just,some,cells\n1,2,3");
    expect(parsed.lines).toEqual([]);
    expect(parsed.problems[0]).toMatch(/header/);
  });
  it("reads the sample CSV", () => {
    const parsed = parseSchedule(
      readFileSync(join(SAMPLES, "schedule-pelican-shoal.csv"), "utf8"),
    );
    expect(parsed.employerCode).toBe("ER-1001");
    expect(parsed.period).toBeNull();
    expect(parsed.lines).toHaveLength(8);
    expect(scheduleTotal(parsed.lines)).toBe(4295);
  });
  it("reads the sample XLSX through readXlsx", () => {
    const sheets = readXlsx(
      new Uint8Array(
        readFileSync(join(SAMPLES, "schedule-calloway-bight.xlsx")),
      ),
    );
    const parsed = parseSchedule(sheets.map((sheet) => sheet.csv).join("\n"));
    expect(parsed.employerCode).toBe("ER-1005");
    expect(parsed.employerName).toBe("Calloway Bight Logistics Ltd");
    expect(parsed.lines).toHaveLength(7);
    expect(parsed.problems).toEqual([]);
  });
});
