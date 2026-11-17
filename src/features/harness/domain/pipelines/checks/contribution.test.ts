import { describe, expect, it } from "vitest";
import type { RuleParams } from "../../rules";
import { ruleSpecOf } from "../../rules/defaults";
import type { ScheduleMember } from "../contribution-processing";
import type { ScheduleLineIn } from "../schedule";
import { CONTRIBUTION_CHECKS, pensionable } from "./contribution";

const defaults = (ruleId: string): RuleParams =>
  ruleSpecOf(ruleId)?.defaults ?? {};

const line = (patch: Partial<ScheduleLineIn> = {}): ScheduleLineIn => ({
  line: 1,
  memberNo: "HB-10001",
  memberName: "Orrin Bascombe-Teal",
  earningsKyd: 6200,
  employeeKyd: 310,
  employerKyd: 310,
  voluntaryKyd: 0,
  ...patch,
});

const member = (patch: Partial<ScheduleMember> = {}): ScheduleMember => ({
  memberNo: "HB-10001",
  fullName: "Orrin Bascombe-Teal",
  employerId: "e1",
  status: "active",
  employmentEndedOn: null,
  dateOfBirth: "1982-04-01",
  caymanian: true,
  residencyStatus: "caymanian",
  startedWorkOn: null,
  ...patch,
});

const C = CONTRIBUTION_CHECKS;
const CAP = 87_000;

describe("match_members", () => {
  const facts = (lines: ScheduleLineIn[], members: ScheduleMember[]) => ({
    period: "2026-10",
    employerId: "e1",
    lines,
    members: Object.fromEntries(members.map((item) => [item.memberNo, item])),
  });
  it("cp.known-member names the stranger", () => {
    const result = C.match_members["cp.known-member"](
      facts(
        [line(), line({ line: 2, memberNo: "HB-19417", memberName: "Jonah" })],
        [member()],
      ),
      {},
    );
    expect(result?.met).toBe(false);
    expect(
      (result?.compared.lines as { memberNo: string }[]).map(
        (item) => item.memberNo,
      ),
    ).toEqual(["HB-19417"]);
  });
  it("cp.no-terminated flags a leaver from before the month, a closed account and another employer", () => {
    const check = C.match_members["cp.no-terminated"];
    expect(
      check(facts([line()], [member({ employmentEndedOn: "2026-10-01" })]), {})
        ?.met,
    ).toBe(true);
    expect(
      check(facts([line()], [member({ employmentEndedOn: "2026-09-30" })]), {})
        ?.met,
    ).toBe(false);
    expect(
      check(facts([line()], [member({ status: "closed" })]), {})?.met,
    ).toBe(false);
    expect(
      check(facts([line()], [member({ employerId: "e2" })]), {})?.met,
    ).toBe(false);
  });
  it("cp.no-duplicates points at the second line", () => {
    const result = C.match_members["cp.no-duplicates"](
      facts([line(), line({ line: 2 })], [member()]),
      {},
    );
    expect(result?.met).toBe(false);
    expect((result?.compared.lines as { line: number }[])[0]?.line).toBe(2);
  });
});

describe("check_rates", () => {
  const facts = (lines: ScheduleLineIn[]) => ({ lines, annualCapKyd: CAP });
  it("passes 5% and 5%, and a cent of rounding either way", () => {
    for (const ruleId of [
      "cp.employer-rate",
      "cp.employee-rate",
      "cp.total-rate",
    ] as const) {
      expect(
        C.check_rates[ruleId](facts([line()]), defaults(ruleId))?.met,
        ruleId,
      ).toBe(true);
    }
    const rounded = line({
      earningsKyd: 3333.33,
      employeeKyd: 166.67,
      employerKyd: 166.66,
    });
    expect(
      C.check_rates["cp.employer-rate"](
        facts([rounded]),
        defaults("cp.employer-rate"),
      )?.met,
    ).toBe(true);
    expect(
      C.check_rates["cp.total-rate"](
        facts([rounded]),
        defaults("cp.total-rate"),
      )?.met,
    ).toBe(true);
  });
  it("flags an employer share of 4%", () => {
    const wrong = line({ employerKyd: 248 });
    expect(
      C.check_rates["cp.employer-rate"](
        facts([wrong]),
        defaults("cp.employer-rate"),
      )?.met,
    ).toBe(false);
    expect(
      C.check_rates["cp.total-rate"](facts([wrong]), defaults("cp.total-rate"))
        ?.met,
    ).toBe(false);
    expect(
      C.check_rates["cp.employee-rate"](
        facts([wrong]),
        defaults("cp.employee-rate"),
      )?.met,
    ).toBe(true);
  });
  it("flags a deduction over 5%, and lets the employer pay more if the total is right", () => {
    expect(
      C.check_rates["cp.employee-rate"](
        facts([line({ employeeKyd: 372 })]),
        defaults("cp.employee-rate"),
      )?.met,
    ).toBe(false);
    const generous = line({ employeeKyd: 186, employerKyd: 434 });
    expect(
      C.check_rates["cp.employer-rate"](
        facts([generous]),
        defaults("cp.employer-rate"),
      )?.met,
    ).toBe(true);
    expect(
      C.check_rates["cp.total-rate"](
        facts([generous]),
        defaults("cp.total-rate"),
      )?.met,
    ).toBe(true);
  });
  it("counts rates on earnings capped at a twelfth of the yearly maximum", () => {
    expect(pensionable(11_500, CAP)).toBe(7250);
    const high = line({
      earningsKyd: 11_500,
      employeeKyd: 362.5,
      employerKyd: 362.5,
    });
    expect(
      C.check_rates["cp.total-rate"](facts([high]), defaults("cp.total-rate"))
        ?.met,
    ).toBe(true);
  });
  it("honours the tolerance Parameter", () => {
    const off = line({ employerKyd: 309.95 });
    expect(
      C.check_rates["cp.total-rate"](facts([off]), {
        totalRate: 10,
        tolerance: 0.01,
      })?.met,
    ).toBe(false);
    expect(
      C.check_rates["cp.total-rate"](facts([off]), {
        totalRate: 10,
        tolerance: 0.05,
      })?.met,
    ).toBe(true);
  });
});

describe("cp.ympe-cap", () => {
  const check = C.check_cap["cp.ympe-cap"];
  const facts = (lines: ScheduleLineIn[]) => ({ lines, totalRatePct: 10 });
  it("passes earnings over the cap when contributions are capped", () => {
    const result = check(
      facts([
        line({ earningsKyd: 11_500, employeeKyd: 362.5, employerKyd: 362.5 }),
      ]),
      defaults("cp.ympe-cap"),
    );
    expect(result?.met).toBe(true);
    expect(result?.compared.linesAboveCap).toBe(1);
  });
  it("notes contributions paid on earnings over the cap", () => {
    expect(
      check(
        facts([
          line({ earningsKyd: 11_500, employeeKyd: 575, employerKyd: 575 }),
        ]),
        defaults("cp.ympe-cap"),
      )?.met,
    ).toBe(false);
  });
});

describe("check_coverage", () => {
  const facts = (members: ScheduleMember[]) => ({
    period: "2026-10",
    lines: [line()],
    members: Object.fromEntries(members.map((item) => [item.memberNo, item])),
  });
  it("cp.coverage-age: voluntary from 65, not at 64", () => {
    const check = C.check_coverage["cp.coverage-age"];
    expect(
      check(
        facts([member({ dateOfBirth: "1961-11-01" })]),
        defaults("cp.coverage-age"),
      )?.met,
    ).toBe(true);
    expect(
      check(
        facts([member({ dateOfBirth: "1961-10-31" })]),
        defaults("cp.coverage-age"),
      )?.met,
    ).toBe(false);
    expect(
      check(
        facts([member({ dateOfBirth: "2008-11-01" })]),
        defaults("cp.coverage-age"),
      )?.met,
    ).toBe(false);
  });
  it("cp.nine-month: non-Caymanians inside the wait, not residents", () => {
    const check = C.check_coverage["cp.nine-month"];
    const permit = (startedWorkOn: string) =>
      member({
        caymanian: false,
        residencyStatus: "work_permit",
        startedWorkOn,
      });
    expect(check(facts([permit("2026-07-01")]), { months: 9 })?.met).toBe(
      false,
    );
    expect(check(facts([permit("2026-01-31")]), { months: 9 })?.met).toBe(
      false,
    );
    expect(check(facts([permit("2026-01-30")]), { months: 9 })?.met).toBe(true);
    expect(
      check(
        facts([
          member({
            caymanian: false,
            residencyStatus: "permanent_resident",
            startedWorkOn: "2026-07-01",
          }),
        ]),
        { months: 9 },
      )?.met,
    ).toBe(true);
  });
});

describe("match_remittance", () => {
  const facts = (
    remittances: { amountKyd: number; receivedOn: string }[],
    asOf = "2026-11-17",
  ) => ({
    period: "2026-10",
    asOf,
    scheduleTotalKyd: 4295,
    remittances: remittances.map((item) => ({ ...item, reference: null })),
  });
  it("cp.remittance-total matches within the tolerance", () => {
    const check = C.match_remittance["cp.remittance-total"];
    expect(
      check(
        facts([{ amountKyd: 4295, receivedOn: "2026-11-10" }]),
        defaults("cp.remittance-total"),
      )?.met,
    ).toBe(true);
    expect(
      check(
        facts([{ amountKyd: 4294.98, receivedOn: "2026-11-10" }]),
        defaults("cp.remittance-total"),
      )?.met,
    ).toBe(false);
    expect(check(facts([]), defaults("cp.remittance-total"))?.met).toBe(false);
  });
  it("cp.remittance-on-time: the 15th is on time, the 16th is late", () => {
    const check = C.match_remittance["cp.remittance-on-time"];
    expect(
      check(facts([{ amountKyd: 1, receivedOn: "2026-11-15" }]), { dueDay: 15 })
        ?.met,
    ).toBe(true);
    expect(
      check(facts([{ amountKyd: 1, receivedOn: "2026-11-16" }]), { dueDay: 15 })
        ?.met,
    ).toBe(false);
    expect(check(facts([], "2026-11-15"), { dueDay: 15 })?.met).toBe(true);
    expect(check(facts([], "2026-11-16"), { dueDay: 15 })?.met).toBe(false);
  });
});
