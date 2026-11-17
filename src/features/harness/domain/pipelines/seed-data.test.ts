import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readXlsx } from "@/features/client-manager/domain/office";
import { CASE_SAMPLES } from "../samples/cases";
import {
  dayAfterPeriod,
  periodEnd,
  wholeMonthsBetween,
  wholeYearsBetween,
} from "./dates";
import { MEMBER_NO } from "./member-request";
import {
  linesTotal,
  ROSTER_MEMBERS,
  rosterMember,
  UPLOAD_SCHEDULES,
} from "./sample-book";
import { parseSchedule } from "./schedule";
import { buildSeedBook, seedLines } from "./seed-data";

const SAMPLES = join(process.cwd(), "public");
const TODAY = "2026-11-17";
const book = buildSeedBook(TODAY);

const fileOf = (path: string) => join(SAMPLES, path);
const remittance = (code: string, period: string) =>
  book.remittances.filter(
    (item) => item.employerCode === code && item.period === period,
  );
const memberNo = (no: string) =>
  book.members.find((member) => member.memberNo === no);

describe("buildSeedBook", () => {
  it("counts its months back from today", () => {
    expect(book.periods).toEqual({
      upload: "2026-10",
      latest: "2026-09",
      earlier: ["2026-07", "2026-08"],
    });
  });

  it("is the same book for the same day", () => {
    expect(buildSeedBook(TODAY)).toEqual(book);
  });

  it("holds about six Employers and 45 Members with unique numbers", () => {
    expect(book.employers).toHaveLength(6);
    expect(book.members).toHaveLength(45);
    expect(new Set(book.members.map((member) => member.memberNo)).size).toBe(
      45,
    );
    expect(
      new Set(book.members.map((member) => member.nationality)).size,
    ).toBeGreaterThan(6);
  });

  it("builds the edge cases the Rules need, relative to today", () => {
    const eligible = memberNo(rosterMember("overseas-eligible").memberNo);
    const tooSoon = memberNo(rosterMember("overseas-too-soon").memberNo);
    const retiring = memberNo(rosterMember("retirement").memberNo);
    const newcomer = memberNo(rosterMember("nine-month").memberNo);
    const leaver = memberNo(rosterMember("transfer-out").memberNo);
    expect(wholeYearsBetween(eligible?.leftCaymanOn as string, TODAY)).toBe(3);
    expect(wholeMonthsBetween(tooSoon?.leftCaymanOn as string, TODAY)).toBe(14);
    expect(wholeYearsBetween(retiring?.dateOfBirth as string, TODAY)).toBe(66);
    expect(newcomer?.caymanian).toBe(false);
    expect(
      wholeMonthsBetween(
        newcomer?.startedWorkOn as string,
        periodEnd(book.periods.upload),
      ),
    ).toBeLessThan(9);
    expect(leaver?.status).toBe("inactive");
    expect(leaver?.employmentEndedOn).toBe(periodEnd(book.periods.latest));
  });

  it("puts the latest month's problems in place", () => {
    const { latest } = book.periods;
    expect(remittance("ER-1003", latest)).toEqual([]);
    expect(remittance("ER-1002", latest)[0]?.receivedOn).toBe(
      dayAfterPeriod(latest, 1, 19),
    );
    const lanternfish = book.schedules.find(
      (item) => item.employerCode === "ER-1004" && item.period === latest,
    );
    expect(remittance("ER-1004", latest)[0]?.amountKyd).toBeCloseTo(
      linesTotal(lanternfish?.lines ?? []) - 412.5,
      2,
    );
    const calloway = book.schedules.find(
      (item) => item.employerCode === "ER-1005" && item.period === latest,
    );
    expect(calloway?.lines.some((line) => !memberNo(line.memberNo))).toBe(true);
    for (const period of book.periods.earlier) {
      for (const employer of book.employers) {
        const schedule = book.schedules.find(
          (item) =>
            item.employerCode === employer.code && item.period === period,
        );
        expect(remittance(employer.code, period)[0]?.amountKyd).toBe(
          linesTotal(schedule?.lines ?? []),
        );
      }
    }
  });

  it("puts the leaver on the Schedules of the months they worked only", () => {
    const leaver = rosterMember("transfer-out").memberNo;
    expect(
      seedLines(book, "ER-1002", book.periods.latest).some(
        (line) => line.memberNo === leaver,
      ),
    ).toBe(true);
    expect(
      seedLines(book, "ER-1002", book.periods.upload).some(
        (line) => line.memberNo === leaver,
      ),
    ).toBe(false);
  });

  it("never dates money in the future, even on the first of a month", () => {
    for (const today of [
      "2026-12-01",
      "2027-03-01",
      "2026-01-31",
      "2028-02-29",
    ]) {
      const other = buildSeedBook(today);
      for (const item of other.remittances)
        expect(item.receivedOn < today, `${today} ${item.reference}`).toBe(
          true,
        );
      expect(other.periods.upload < today.slice(0, 7)).toBe(true);
    }
  });
});

describe("sample files agree with the seed book", () => {
  it("lists at least eight case papers that exist and say SPECIMEN", () => {
    expect(CASE_SAMPLES.length).toBeGreaterThanOrEqual(8);
    for (const sample of CASE_SAMPLES) {
      const bytes = readFileSync(fileOf(sample.path));
      const text = sample.path.endsWith(".xlsx")
        ? readXlsx(new Uint8Array(bytes))
            .map((sheet) => sheet.csv)
            .join("\n")
        : bytes.toString("utf8");
      expect(text, sample.id).toMatch(/SPECIMEN/);
    }
  });

  it("names only seeded Members in the request papers, with their seeded names", () => {
    for (const sample of CASE_SAMPLES.filter(
      (item) => item.group === "member request",
    )) {
      const text = readFileSync(fileOf(sample.path), "utf8");
      const no = MEMBER_NO.exec(text)?.[0];
      const member = no ? memberNo(no) : undefined;
      expect(member, sample.id).toBeDefined();
      expect(text, sample.id).toContain(member?.fullName);
    }
  });

  it("ships the upload month's Schedules exactly as seeded, and money to match", () => {
    const { upload } = book.periods;
    const csv = parseSchedule(
      readFileSync(
        fileOf("/harness/samples/schedule-pelican-shoal.csv"),
        "utf8",
      ),
    );
    const xlsx = parseSchedule(
      readXlsx(
        new Uint8Array(
          readFileSync(fileOf("/harness/samples/schedule-calloway-bight.xlsx")),
        ),
      )
        .map((sheet) => sheet.csv)
        .join("\n"),
    );
    for (const [parsed, sample] of [
      [csv, UPLOAD_SCHEDULES.clean],
      [xlsx, UPLOAD_SCHEDULES.wrongRate],
    ] as const) {
      const seeded = seedLines(book, sample.employerCode, upload);
      expect(parsed.lines.map(({ line: _line, ...rest }) => rest)).toEqual(
        seeded,
      );
      expect(remittance(sample.employerCode, upload)[0]?.amountKyd).toBe(
        linesTotal(seeded),
      );
    }
    const advice = readFileSync(
      fileOf("/harness/samples/remittance-advice-pelican-shoal.txt"),
      "utf8",
    );
    expect(advice).toContain(
      linesTotal(UPLOAD_SCHEDULES.clean.lines).toLocaleString("en-US", {
        minimumFractionDigits: 2,
      }),
    );
  });

  it("keeps every roster Member's age and money believable", () => {
    for (const member of ROSTER_MEMBERS) {
      expect(member.age).toBeGreaterThanOrEqual(18);
      expect(member.balanceKyd).toBeGreaterThanOrEqual(0);
    }
  });
});
