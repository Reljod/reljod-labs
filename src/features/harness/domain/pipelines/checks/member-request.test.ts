import { describe, expect, it } from "vitest";
import type { Member } from "../../records";
import type { RuleParams } from "../../rules";
import { ruleSpecOf } from "../../rules/defaults";
import type { DocumentReading, MemberRequestFacts } from "../member-request";
import { MEMBER_REQUEST_CHECKS } from "./member-request";

const TODAY = "2026-11-17";

const member = (patch: Partial<Member> = {}): Member => ({
  id: "m1",
  employerId: null,
  memberNo: "HB-10042",
  fullName: "Alison Fairweather-Kent",
  dateOfBirth: "1979-05-02",
  nationality: "Canadian",
  caymanian: false,
  residencyStatus: "work_permit",
  leftCaymanOn: "2023-10-01",
  employmentEndedOn: "2023-09-15",
  lastContributionOn: "2023-09-30",
  balanceKyd: 38_412.55,
  vested: true,
  email: null,
  address: null,
  status: "deferred",
  ...patch,
});

const reading = (patch: Partial<DocumentReading> = {}): DocumentReading => ({
  sourceId: "s1",
  sourceTitle: "pack.md",
  papers: [],
  memberNo: "HB-10042",
  fullName: "Alison Fairweather-Kent",
  dateOfBirth: null,
  requestKind: null,
  requestedAmountKyd: null,
  propertyPurpose: null,
  asksCashRefund: false,
  receivingPlan: null,
  dateOfDeath: null,
  fallback: true,
  ...patch,
});

const facts = (
  patch: Partial<MemberRequestFacts> = {},
): MemberRequestFacts => ({
  asOf: TODAY,
  receivedOn: TODAY,
  kind: "cessation_of_residence",
  member: member(),
  readings: [reading()],
  ...patch,
});

const defaults = (ruleId: string): RuleParams =>
  ruleSpecOf(ruleId)?.defaults ?? {};

const C = MEMBER_REQUEST_CHECKS;

describe("mr.identity-match", () => {
  const check = C.check_identity["mr.identity-match"];
  it("passes when the number and name match", () => {
    expect(check(facts(), defaults("mr.identity-match"))?.met).toBe(true);
  });
  it("allows the configured number of differing letters, and no more", () => {
    const two = facts({
      readings: [reading({ fullName: "Alisen Fairweather-Kant" })],
    });
    expect(check(two, { maxNameDistance: 2 })?.met).toBe(true);
    expect(check(two, { maxNameDistance: 1 })?.met).toBe(false);
  });
  it("matches a name written surname first", () => {
    const flipped = facts({
      readings: [reading({ fullName: "Fairweather-Kent, Alison" })],
    });
    expect(check(flipped, { maxNameDistance: 0 })?.met).toBe(true);
  });
  it("fails on a different member number or date of birth, or no record", () => {
    expect(
      check(
        facts({ readings: [reading({ memberNo: "HB-10043" })] }),
        defaults("mr.identity-match"),
      )?.met,
    ).toBe(false);
    expect(
      check(
        facts({ readings: [reading({ dateOfBirth: "1980-01-01" })] }),
        defaults("mr.identity-match"),
      )?.met,
    ).toBe(false);
    expect(
      check(facts({ member: null }), defaults("mr.identity-match"))?.met,
    ).toBe(false);
  });
});

describe("mr.account-open", () => {
  const check = C.check_identity["mr.account-open"];
  it("blocks only the listed statuses", () => {
    expect(check(facts(), { blockedStatuses: ["closed"] })?.met).toBe(true);
    expect(
      check(facts({ member: member({ status: "closed" }) }), {
        blockedStatuses: ["closed"],
      })?.met,
    ).toBe(false);
    expect(
      check(facts({ member: member({ status: "closed" }) }), {
        blockedStatuses: [],
      })?.met,
    ).toBe(true);
  });
  it("says nothing without a Member", () => {
    expect(
      check(facts({ member: null }), defaults("mr.account-open")),
    ).toBeNull();
  });
});

describe("mr.employment-ended", () => {
  const check = C.check_eligibility["mr.employment-ended"];
  it("applies only to the listed kinds", () => {
    expect(
      check(facts({ kind: "property" }), defaults("mr.employment-ended")),
    ).toBeNull();
    expect(
      check(facts({ kind: "property" }), { kinds: ["property"] })?.met,
    ).toBe(true);
  });
  it("needs an end date on or before today", () => {
    expect(check(facts(), defaults("mr.employment-ended"))?.met).toBe(true);
    expect(
      check(
        facts({ member: member({ employmentEndedOn: null }) }),
        defaults("mr.employment-ended"),
      )?.met,
    ).toBe(false);
    expect(
      check(
        facts({ member: member({ employmentEndedOn: "2026-11-18" }) }),
        defaults("mr.employment-ended"),
      )?.met,
    ).toBe(false);
    expect(
      check(
        facts({ member: member({ employmentEndedOn: TODAY }) }),
        defaults("mr.employment-ended"),
      )?.met,
    ).toBe(true);
  });
});

describe("mr.overseas-absence", () => {
  const check = C.check_eligibility["mr.overseas-absence"];
  it("passes from exactly the anniversary, not a day before", () => {
    expect(
      check(facts({ member: member({ leftCaymanOn: "2024-11-17" }) }), {
        minYears: 2,
      })?.met,
    ).toBe(true);
    expect(
      check(facts({ member: member({ leftCaymanOn: "2024-11-18" }) }), {
        minYears: 2,
      })?.met,
    ).toBe(false);
  });
  it("fails 14 months after leaving and says when it becomes eligible", () => {
    const result = check(
      facts({ member: member({ leftCaymanOn: "2025-09-17" }) }),
      { minYears: 2 },
    );
    expect(result?.met).toBe(false);
    expect(result?.compared.eligibleFrom).toBe("2027-09-17");
  });
  it("fails with no departure date, and ignores other kinds", () => {
    expect(
      check(facts({ member: member({ leftCaymanOn: null }) }), { minYears: 2 })
        ?.met,
    ).toBe(false);
    expect(check(facts({ kind: "transfer_out" }), { minYears: 2 })).toBeNull();
  });
});

describe("mr.overseas-no-contributions", () => {
  const check = C.check_eligibility["mr.overseas-no-contributions"];
  it("counts from the last contribution", () => {
    expect(
      check(facts({ member: member({ lastContributionOn: "2024-11-17" }) }), {
        minYears: 2,
      })?.met,
    ).toBe(true);
    expect(
      check(facts({ member: member({ lastContributionOn: "2025-01-31" }) }), {
        minYears: 2,
      })?.met,
    ).toBe(false);
  });
});

describe("mr.cash-refund-closed", () => {
  const check = C.check_eligibility["mr.cash-refund-closed"];
  const asking = [reading({ asksCashRefund: true })];
  it("applies only when cash is asked for", () => {
    expect(check(facts(), defaults("mr.cash-refund-closed"))).toBeNull();
  });
  it("refuses cash from the threshold up", () => {
    expect(
      check(
        facts({ readings: asking, member: member({ balanceKyd: 5_000 }) }),
        { threshold: 5_000 },
      )?.met,
    ).toBe(false);
    expect(
      check(
        facts({ readings: asking, member: member({ balanceKyd: 4_999.99 }) }),
        { threshold: 5_000 },
      )?.met,
    ).toBe(true);
  });
});

describe("property Rules", () => {
  const property = (
    patch: Partial<DocumentReading>,
    memberPatch: Partial<Member> = {},
  ) =>
    facts({
      kind: "property",
      member: member({ caymanian: true, balanceKyd: 62_000, ...memberPatch }),
      readings: [
        reading({
          requestedAmountKyd: 40_000,
          propertyPurpose: "deposit",
          ...patch,
        }),
      ],
    });
  it("mr.property-caymanian: Caymanians only", () => {
    const check = C.check_eligibility["mr.property-caymanian"];
    expect(check(property({}), {})?.met).toBe(true);
    expect(check(property({}, { caymanian: false }), {})?.met).toBe(false);
    expect(check(facts(), {})).toBeNull();
  });
  it("mr.property-cap: the deposit cap, the pay-off cap and the balance", () => {
    const check = C.check_eligibility["mr.property-cap"];
    const caps = defaults("mr.property-cap");
    expect(check(property({ requestedAmountKyd: 50_000 }), caps)?.met).toBe(
      true,
    );
    expect(check(property({ requestedAmountKyd: 50_000.01 }), caps)?.met).toBe(
      false,
    );
    expect(
      check(
        property(
          { requestedAmountKyd: 90_000, propertyPurpose: "payoff" },
          { balanceKyd: 120_000 },
        ),
        caps,
      )?.met,
    ).toBe(true);
    expect(
      check(
        property(
          { requestedAmountKyd: 100_000.01, propertyPurpose: "payoff" },
          { balanceKyd: 200_000 },
        ),
        caps,
      )?.met,
    ).toBe(false);
    expect(
      check(
        property({ requestedAmountKyd: 45_000 }, { balanceKyd: 30_000 }),
        caps,
      )?.met,
    ).toBe(false);
    expect(check(property({ requestedAmountKyd: null }), caps)?.met).toBe(
      false,
    );
  });
});

describe("mr.retirement-age", () => {
  const check = C.check_eligibility["mr.retirement-age"];
  const retire = (
    dateOfBirth: string,
    employmentEndedOn: string | null = null,
  ) =>
    facts({
      kind: "retirement",
      member: member({ dateOfBirth, employmentEndedOn }),
    });
  const ages = defaults("mr.retirement-age");
  it("passes on the 65th birthday, not the day before", () => {
    expect(check(retire("1961-11-17"), ages)?.met).toBe(true);
    expect(check(retire("1961-11-18"), ages)?.met).toBe(false);
  });
  it("allows early retirement from 55 only once employment has ended", () => {
    expect(check(retire("1970-01-01"), ages)?.met).toBe(false);
    expect(check(retire("1970-01-01", "2026-06-30"), ages)?.met).toBe(true);
    expect(check(retire("1972-01-01", "2026-06-30"), ages)?.met).toBe(false);
  });
});

describe("time limits", () => {
  it("mr.transfer-time-limit: 45 days from receipt, the last day included", () => {
    const check = C.check_deadline["mr.transfer-time-limit"];
    expect(check(facts({ receivedOn: "2026-10-03" }), { days: 45 })?.met).toBe(
      true,
    );
    expect(check(facts({ receivedOn: "2026-10-02" }), { days: 45 })?.met).toBe(
      false,
    );
    expect(check(facts({ kind: "property" }), { days: 45 })).toBeNull();
  });
  it("mr.property-time-limit: 60 days to pay, with the refusal date shown", () => {
    const check = C.check_deadline["mr.property-time-limit"];
    const result = check(
      facts({ kind: "property", receivedOn: "2026-11-10" }),
      defaults("mr.property-time-limit"),
    );
    expect(result?.met).toBe(true);
    expect(result?.compared.refuseBy).toBe("2026-11-17");
    expect(
      check(
        facts({ kind: "property", receivedOn: "2026-09-17" }),
        defaults("mr.property-time-limit"),
      )?.met,
    ).toBe(false);
  });
  it("mr.statement-time-limit: retirement and death only", () => {
    const check = C.check_deadline["mr.statement-time-limit"];
    expect(
      check(
        facts({ kind: "retirement", receivedOn: "2026-10-18" }),
        defaults("mr.statement-time-limit"),
      )?.met,
    ).toBe(true);
    expect(
      check(
        facts({ kind: "death", receivedOn: "2026-10-17" }),
        defaults("mr.statement-time-limit"),
      )?.met,
    ).toBe(false);
    expect(
      check(
        facts({ kind: "transfer_out" }),
        defaults("mr.statement-time-limit"),
      ),
    ).toBeNull();
  });
});

describe("papers", () => {
  const withPapers = (
    kind: MemberRequestFacts["kind"],
    types: string[],
    patch: Partial<DocumentReading> = {},
  ) =>
    facts({
      kind,
      readings: [
        reading({
          papers: types.map((type) => ({
            type: type as never,
            title: type,
            signed: true,
          })),
          ...patch,
        }),
      ],
    });
  it("mr.docs-statutory lists what an overseas transfer is missing", () => {
    const check = C.check_documents["mr.docs-statutory"];
    const params = defaults("mr.docs-statutory");
    expect(
      check(
        withPapers("cessation_of_residence", [
          "transfer_form",
          "international_questionnaire",
          "receiving_plan_document",
          "photo_id",
        ]),
        params,
      )?.met,
    ).toBe(true);
    const short = check(
      withPapers("cessation_of_residence", ["transfer_form"]),
      params,
    );
    expect(short?.met).toBe(false);
    expect(short?.compared.missing).toEqual([
      "international_questionnaire",
      "receiving_plan_document",
      "photo_id",
    ]);
  });
  it("mr.docs-statutory adds the deposit or mortgage paper for property", () => {
    const check = C.check_documents["mr.docs-statutory"];
    const params = defaults("mr.docs-statutory");
    const base = ["property_form", "caymanian_status", "lender_letter"];
    expect(
      check(
        withPapers("property", [...base, "non_home_owner_declaration"], {
          propertyPurpose: "deposit",
        }),
        params,
      )?.met,
    ).toBe(true);
    expect(
      check(
        withPapers("property", [...base, "non_home_owner_declaration"], {
          propertyPurpose: "payoff",
        }),
        params,
      )?.compared.missing,
    ).toEqual(["land_register"]);
  });
  it("mr.docs-plan covers retirement and death", () => {
    const check = C.check_documents["mr.docs-plan"];
    const params = defaults("mr.docs-plan");
    expect(
      check(
        withPapers("retirement", ["retirement_application", "photo_id"]),
        params,
      )?.met,
    ).toBe(true);
    expect(check(withPapers("death", ["death_certificate"]), params)?.met).toBe(
      false,
    );
    expect(check(withPapers("property", []), params)).toBeNull();
  });
});
