import { describe, expect, it } from "vitest";
import { ruleSpecOf } from "../../rules/defaults";
import {
  arrearsRows,
  arrearsTotals,
  type DelinquentEntry,
  type PeriodEmployer,
  type PeriodFacts,
} from "../delinquency-report";
import { DELINQUENCY_CHECKS, interestRate } from "./delinquency";

const employer = (patch: Partial<PeriodEmployer>): PeriodEmployer => ({
  employerId: patch.code ?? "e",
  code: "ER-1001",
  name: "Pelican Shoal Marine Services Ltd",
  status: "active",
  contactEmail: null,
  scheduleTotalKyd: 1000,
  remittances: [{ amountKyd: 1000, receivedOn: "2026-10-10", reference: null }],
  ...patch,
});

const facts = (
  employers: PeriodEmployer[],
  asOf = "2026-11-17",
): PeriodFacts => ({
  asOf,
  period: "2026-09",
  employers,
});

const C = DELINQUENCY_CHECKS;

describe("dr.missing", () => {
  const check = C.find_missing["dr.missing"];
  it("waits until the due date has passed", () => {
    const unpaid = employer({ code: "ER-1003", remittances: [] });
    expect(check(facts([unpaid], "2026-10-15"), { dueDay: 15 })?.met).toBe(
      true,
    );
    const late = check(facts([unpaid], "2026-10-16"), { dueDay: 15 });
    expect(late?.met).toBe(false);
    expect((late?.compared.employers as DelinquentEntry[])[0]).toMatchObject({
      code: "ER-1003",
      kind: "unpaid",
      amountKyd: 1000,
    });
  });
  it("ignores closed and suspended Employers", () => {
    expect(
      check(facts([employer({ remittances: [], status: "closed" })]), {
        dueDay: 15,
      })?.met,
    ).toBe(true);
  });
});

describe("dr.short", () => {
  const check = C.find_missing["dr.short"];
  it("finds the shortfall beyond the tolerance", () => {
    const short = employer({
      remittances: [
        { amountKyd: 587.5, receivedOn: "2026-10-12", reference: null },
      ],
    });
    const result = check(facts([short]), { tolerance: 0.01 });
    expect(result?.met).toBe(false);
    expect(
      (result?.compared.employers as DelinquentEntry[])[0]?.amountKyd,
    ).toBe(412.5);
    const cent = employer({
      remittances: [
        { amountKyd: 999.99, receivedOn: "2026-10-12", reference: null },
      ],
    });
    expect(check(facts([cent]), { tolerance: 0.01 })?.met).toBe(true);
  });
});

describe("dr.late", () => {
  const check = C.find_late["dr.late"];
  it("counts days late from the due date", () => {
    const late = employer({
      remittances: [
        { amountKyd: 1000, receivedOn: "2026-10-19", reference: null },
      ],
    });
    const result = check(facts([late]), { dueDay: 15 });
    expect(result?.met).toBe(false);
    expect(
      (result?.compared.employers as { daysLate: number }[])[0]?.daysLate,
    ).toBe(4);
    expect(check(facts([employer({})]), { dueDay: 15 })?.met).toBe(true);
  });
});

describe("compute", () => {
  const entries: DelinquentEntry[] = [
    {
      employerId: "a",
      code: "ER-1002",
      name: "Wrayfield",
      kind: "late",
      amountKyd: 1000,
      paidOn: "2026-10-19",
    },
    {
      employerId: "b",
      code: "ER-1003",
      name: "Brackwater",
      kind: "unpaid",
      amountKyd: 2000,
      paidOn: null,
    },
  ];
  it("works out interest as amount × rate × days ÷ 365", () => {
    const rows = arrearsRows({
      entries,
      period: "2026-09",
      asOf: "2026-11-17",
      dueDay: 15,
      ratePct: 13.5,
    });
    expect(rows[0]).toMatchObject({
      daysLate: 4,
      interestKyd: 1.48,
      reportable: false,
    });
    expect(rows[1]).toMatchObject({
      daysLate: 33,
      interestKyd: 24.41,
      reportable: true,
    });
    expect(arrearsTotals(rows)).toEqual({
      employers: 2,
      reportableEmployers: 1,
      arrearsKyd: 2000,
      interestKyd: 25.89,
    });
  });
  it("dr.interest uses prime plus the margin", () => {
    expect(interestRate(ruleSpecOf("dr.interest")?.defaults ?? {})).toBe(13.5);
    const result = C.compute["dr.interest"](
      { asOf: "2026-11-17", period: "2026-09", dueDay: 15, entries },
      { primeRate: 8.5, margin: 5 },
    );
    expect(result?.met).toBe(false);
    expect(result?.compared.totalInterestKyd).toBe(25.89);
  });
  it("dr.report-deadline: reportable on the 15th, report by the 20th, late after", () => {
    const check = C.compute["dr.report-deadline"];
    const at = (asOf: string) =>
      check(
        { asOf, period: "2026-09", dueDay: 15, entries },
        { reportableDay: 15, reportDay: 20 },
      );
    expect(at("2026-11-10")?.met).toBe(true);
    expect(at("2026-11-20")?.met).toBe(true);
    expect(at("2026-11-21")?.met).toBe(false);
    expect(
      check(
        {
          asOf: "2026-12-01",
          period: "2026-09",
          dueDay: 15,
          entries: [entries[0] as DelinquentEntry],
        },
        { reportableDay: 15, reportDay: 20 },
      )?.met,
    ).toBe(true);
  });
});
