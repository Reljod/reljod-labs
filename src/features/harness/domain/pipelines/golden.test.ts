import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readXlsx } from "@/features/client-manager/domain/office";
import type { Member } from "../records";
import {
  applyChecks,
  type FindingDraft,
  paramOf,
  resolveRuleStates,
  resolveRuleStatesAsOf,
  rulesNotInForce,
  ruleVersionsOf,
} from "./apply";
import { CONTRIBUTION_CHECKS } from "./checks/contribution";
import { DELINQUENCY_CHECKS, rowsFor } from "./checks/delinquency";
import { MEMBER_REQUEST_CHECKS } from "./checks/member-request";
import type { ScheduleMember } from "./contribution-processing";
import { periodStart } from "./dates";
import { decideMemberRequest } from "./decide";
import {
  arrearsTotals,
  entriesOf,
  type PeriodFacts,
} from "./delinquency-report";
import {
  contributionDraftPlan,
  memberRequestDraftPlan,
  regulatorReportPlan,
} from "./drafts";
import { classifyByKeywords, readByRules } from "./extract";
import {
  claimedIdentity,
  type KindReading,
  kindSourceText,
  type MemberRequestFacts,
  requestedAmount,
  resolveRequestKind,
} from "./member-request";
import { reconcile } from "./reconcile";
import { parseSchedule, scheduleTotal } from "./schedule";
import { buildSeedBook, type SeedMember } from "./seed-data";

/*
 * The golden test: each Pipeline's code Steps run over the sample files and
 * a Workspace seeded on a fixed day, with the Rules at their Defaults and
 * the model Steps replaced by their deterministic fallbacks (as a stubbed
 * Run does). It asserts the Findings and the decisions the demo is built on.
 */

const TODAY = "2026-11-17";
const book = buildSeedBook(TODAY);
const SAMPLES = join(process.cwd(), "public/harness/samples");

const asMember = (seed: SeedMember, index: number): Member => ({
  id: `m${index}`,
  employerId: seed.employerCode,
  memberNo: seed.memberNo,
  fullName: seed.fullName,
  dateOfBirth: seed.dateOfBirth,
  nationality: seed.nationality,
  caymanian: seed.caymanian,
  residencyStatus: seed.residencyStatus,
  leftCaymanOn: seed.leftCaymanOn,
  employmentEndedOn: seed.employmentEndedOn,
  lastContributionOn: seed.lastContributionOn,
  balanceKyd: seed.balanceKyd,
  vested: seed.vested,
  email: seed.email,
  address: seed.address,
  status: seed.status,
});
const MEMBERS = book.members.map(asMember);

const unmet = (findings: FindingDraft[]) =>
  Object.fromEntries(
    findings
      .filter((finding) => !finding.met)
      .map((finding) => [finding.ruleId, finding.outcome]),
  );

// member_request ---------------------------------------------------------------------------

function runMemberRequest(
  file: string,
  options: {
    asOf?: string;
    member?: Partial<Member>;
    /** What the classify Step read; by default a stubbed Run's reading. */
    kindReading?: Partial<KindReading>;
  } = {},
) {
  const text = readFileSync(join(SAMPLES, file), "utf8");
  const asOf = options.asOf ?? TODAY;
  const readings = [readByRules({ id: file, title: file, text })];
  const claimed = claimedIdentity(readings);
  const keywords = classifyByKeywords(text).kind;
  const kindReading: KindReading = {
    given: null,
    model: keywords,
    modelFailed: false,
    keywords,
    ...options.kindReading,
  };
  const found = MEMBERS.find((member) => member.memberNo === claimed.memberNo);
  const facts: MemberRequestFacts = {
    asOf,
    receivedOn: asOf,
    kind: resolveRequestKind(kindReading).kind,
    member: found ? { ...found, ...options.member } : null,
    readings,
    kindReading,
  };
  const states = resolveRuleStates("member_request", null);
  const findings = (
    Object.keys(MEMBER_REQUEST_CHECKS) as (keyof typeof MEMBER_REQUEST_CHECKS)[]
  ).flatMap((stepId) =>
    applyChecks({
      pipelineId: "member_request",
      stepId,
      checks: MEMBER_REQUEST_CHECKS[stepId],
      facts,
      states,
      asOf,
    }),
  );
  const decided = decideMemberRequest({
    findings,
    kind: facts.kind,
    memberFound: facts.member !== null,
  });
  const plan = memberRequestDraftPlan({
    decide: decided,
    kind: facts.kind,
    member: facts.member,
    claimedName: claimed.fullName,
    requestedAmountKyd: requestedAmount(readings),
    receivingPlan: readings[0]?.receivingPlan ?? null,
    missingPapers: [],
    note: null,
    asOf,
    receivedOn: asOf,
    kindSource: kindSourceText(kindReading),
  });
  return { facts, findings, decided, plan };
}

describe("golden: member_request", () => {
  it("passes an overseas transfer three years after leaving", () => {
    const { facts, findings, decided, plan } = runMemberRequest(
      "request-overseas-transfer.md",
    );
    expect(facts.kind).toBe("cessation_of_residence");
    expect(facts.member?.memberNo).toBe("HB-10042");
    expect(unmet(findings)).toEqual({});
    expect(findings.map((finding) => finding.ruleId).sort()).toEqual(
      [
        "mr.account-open",
        "mr.docs-statutory",
        "mr.employment-ended",
        "mr.identity-match",
        "mr.kind-confirmed",
        "mr.overseas-absence",
        "mr.overseas-no-contributions",
        "mr.transfer-time-limit",
      ].sort(),
    );
    expect(decided.decision).toBe("proceed");
    expect(plan).toMatchObject({ kind: "transfer_instruction", risk: "high" });
    expect(plan.particulars).toContain("CI$38,412.55");
  });

  it("rejects an overseas transfer 14 months after leaving, and notes cash refunds have ended", () => {
    const { findings, decided, plan } = runMemberRequest(
      "request-overseas-too-soon.md",
    );
    expect(unmet(findings)).toEqual({
      "mr.overseas-absence": "block",
      "mr.overseas-no-contributions": "block",
      "mr.cash-refund-closed": "warn",
    });
    expect(decided.decision).toBe("reject");
    expect(plan).toMatchObject({ kind: "rejection_letter", risk: "high" });
  });

  it("asks for the lender's letter on a property deposit", () => {
    const { facts, findings, decided, plan } = runMemberRequest(
      "request-property-missing-letter.md",
    );
    expect(facts.kind).toBe("property");
    expect(unmet(findings)).toEqual({ "mr.docs-statutory": "refer" });
    expect(
      findings.find((finding) => finding.ruleId === "mr.docs-statutory")
        ?.compared.missing,
    ).toEqual(["lender_letter"]);
    expect(
      findings.find((finding) => finding.ruleId === "mr.property-cap")?.met,
    ).toBe(true);
    expect(decided.decision).toBe("request_documents");
    expect(plan).toMatchObject({ kind: "documents_letter", risk: "low" });
  });

  it("proceeds with a retirement at 66", () => {
    const { facts, findings, decided, plan } = runMemberRequest(
      "request-retirement.md",
    );
    expect(facts.kind).toBe("retirement");
    expect(unmet(findings)).toEqual({});
    expect(
      findings.find((finding) => finding.ruleId === "mr.retirement-age")
        ?.compared.age,
    ).toBe(66);
    expect(decided.decision).toBe("proceed");
    expect(plan).toMatchObject({ kind: "payment_instruction", risk: "high" });
  });

  it("lets a Member born in 1965 retire at 60 (the age-60 option)", () => {
    const { findings, decided } = runMemberRequest("request-retirement.md", {
      asOf: "2025-06-01",
      member: { dateOfBirth: "1965-03-01", employmentEndedOn: null },
    });
    const age = findings.find(
      (finding) => finding.ruleId === "mr.retirement-age",
    );
    expect(age).toMatchObject({ met: true, compared: { age: 60 } });
    expect(decided.decision).toBe("proceed");
  });

  it("refuses a Member born in 1975 retiring at 60", () => {
    const { findings, decided } = runMemberRequest("request-retirement.md", {
      asOf: "2035-06-01",
      member: { dateOfBirth: "1975-03-01", employmentEndedOn: null },
    });
    const age = findings.find(
      (finding) => finding.ruleId === "mr.retirement-age",
    );
    expect(age).toMatchObject({
      met: false,
      compared: { age: 60, inOptionGroup: false },
    });
    expect(decided.decision).toBe("reject");
  });

  it("states where the kind came from on the Draft", () => {
    const { plan, findings } = runMemberRequest("request-retirement.md");
    expect(plan.particulars).toContain(
      "| Kind from | Read from the papers; the model and the form's own wording agree |",
    );
    expect(
      findings.find((finding) => finding.ruleId === "mr.kind-confirmed")?.met,
    ).toBe(true);
  });

  it("refers when the model and the form's wording disagree", () => {
    const { facts, findings, decided, plan } = runMemberRequest(
      "request-retirement.md",
      { kindReading: { model: "death" } },
    );
    // The model's reading is kept, but it cannot carry the case on its own.
    expect(facts.kind).toBe("death");
    expect(unmet(findings)["mr.kind-confirmed"]).toBe("refer");
    expect(decided.decision).not.toBe("proceed");
    expect(plan.particulars).toMatch(/disagree; a person must confirm it/);
  });

  it("refers when the model could not be asked, even if keywords found a kind", () => {
    const { findings, decided } = runMemberRequest("request-retirement.md", {
      kindReading: { modelFailed: true },
    });
    expect(unmet(findings)).toEqual({ "mr.kind-confirmed": "refer" });
    expect(decided.decision).toBe("request_documents");
  });

  it("uses a kind stated by Staff in the app and records that it was stated", () => {
    const { facts, findings, decided, plan } = runMemberRequest(
      "request-retirement.md",
      {
        kindReading: { given: "retirement", givenBy: "staff", model: null },
      },
    );
    expect(facts.kind).toBe("retirement");
    expect(
      findings.find((finding) => finding.ruleId === "mr.kind-confirmed"),
    ).toMatchObject({ met: true, compared: { source: "staff" } });
    expect(decided.decision).toBe("proceed");
    expect(plan.particulars).toContain(
      "Stated by Staff in the app when the Run started",
    );
  });

  it("uses a kind the guide set, even where the papers' wording differs, and says so", () => {
    const { findings, plan } = runMemberRequest("request-retirement.md", {
      kindReading: {
        given: "transfer_out",
        givenBy: "guide",
        model: null,
      },
    });
    expect(
      findings.find((finding) => finding.ruleId === "mr.kind-confirmed"),
    ).toMatchObject({ met: true, compared: { source: "guide" } });
    expect(plan.particulars).toContain("Set by the guide");
  });

  it("accepts a kind the Agent gave when the papers' own wording agrees", () => {
    const { findings, decided, plan } = runMemberRequest(
      "request-retirement.md",
      { kindReading: { given: "retirement", givenBy: "agent", model: null } },
    );
    const finding = findings.find(
      (finding) => finding.ruleId === "mr.kind-confirmed",
    );
    expect(finding).toMatchObject({ met: true, compared: { source: "agent" } });
    expect(finding?.summary).toMatch(/stated by the Agent and matches/);
    expect(decided.decision).toBe("proceed");
    expect(plan.particulars).toContain(
      "| Kind from | Stated by the Agent; matches the papers' own wording |",
    );
  });

  it("refers a kind the Agent gave that the papers' own wording does not confirm", () => {
    const { facts, findings, decided, plan } = runMemberRequest(
      "request-retirement.md",
      { kindReading: { given: "death", givenBy: "agent", model: null } },
    );
    // The Agent's kind is kept as a reading, never as a Staff decision.
    expect(facts.kind).toBe("death");
    expect(unmet(findings)["mr.kind-confirmed"]).toBe("refer");
    const finding = findings.find(
      (finding) => finding.ruleId === "mr.kind-confirmed",
    );
    expect(finding?.summary).toMatch(
      /stated by the Agent, not confirmed by the papers' own wording/,
    );
    expect(finding?.summary).not.toMatch(/Staff/);
    expect(decided.decision).not.toBe("proceed");
    expect(plan.particulars).toContain(
      "Stated by the Agent, not confirmed by the papers' own wording",
    );
  });

  it("refers a kind the Agent gave when the papers' wording names no kind", () => {
    const { findings } = runMemberRequest("request-retirement.md", {
      kindReading: {
        given: "retirement",
        givenBy: "agent",
        model: null,
        keywords: null,
      },
    });
    expect(unmet(findings)["mr.kind-confirmed"]).toBe("refer");
  });

  it("reads a given kind saved before givenBy was recorded as stated by Staff", () => {
    const { findings } = runMemberRequest("request-retirement.md", {
      kindReading: { given: "retirement", model: null },
    });
    expect(
      findings.find((finding) => finding.ruleId === "mr.kind-confirmed"),
    ).toMatchObject({ met: true, compared: { source: "staff" } });
  });

  it("proceeds with a transfer to a new employer's plan", () => {
    const { facts, findings, decided, plan } = runMemberRequest(
      "request-transfer-out.md",
    );
    expect(facts.kind).toBe("transfer_out");
    expect(unmet(findings)).toEqual({});
    expect(decided.decision).toBe("proceed");
    expect(plan.kind).toBe("transfer_instruction");
  });

  it("follows a Workspace's edit: two years to one makes the early leaver eligible", () => {
    const text = readFileSync(
      join(SAMPLES, "request-overseas-too-soon.md"),
      "utf8",
    );
    const readings = [readByRules({ id: "x", title: "x", text })];
    const facts: MemberRequestFacts = {
      asOf: TODAY,
      receivedOn: TODAY,
      kind: "cessation_of_residence",
      member: MEMBERS.find((member) => member.memberNo === "HB-10043") ?? null,
      readings,
    };
    const states = resolveRuleStates("member_request", {
      "mr.overseas-absence": {
        version: 3,
        enabled: true,
        params: { minYears: 1 },
        outcome: "block",
        effectiveFrom: "2017-12-31",
      },
      "mr.overseas-no-contributions": {
        version: 1,
        enabled: false,
        params: {},
        outcome: "block",
        effectiveFrom: "2017-12-31",
      },
    });
    const findings = applyChecks({
      pipelineId: "member_request",
      stepId: "check_eligibility",
      checks: MEMBER_REQUEST_CHECKS.check_eligibility,
      facts,
      states,
      asOf: TODAY,
    });
    const absence = findings.find(
      (finding) => finding.ruleId === "mr.overseas-absence",
    );
    expect(absence).toMatchObject({ met: true, ruleVersion: 3 });
    expect(
      findings.some(
        (finding) => finding.ruleId === "mr.overseas-no-contributions",
      ),
    ).toBe(false);
  });
});

describe("golden: a Rule edit scheduled for later", () => {
  // An admin schedules "one year abroad is enough" from 2027-01-01. Until
  // then every Run keeps applying the two-year Version in force (here the
  // Default), and records that Version, not the scheduled one.
  const text = readFileSync(
    join(SAMPLES, "request-overseas-too-soon.md"),
    "utf8",
  );
  const saved = {
    "mr.overseas-absence": [
      {
        version: 1,
        enabled: true,
        params: { minYears: 1 },
        outcome: "block" as const,
        effectiveFrom: "2027-01-01",
      },
    ],
  };
  const absenceOn = (asOf: string) => {
    const states = resolveRuleStatesAsOf("member_request", saved, asOf);
    const facts: MemberRequestFacts = {
      asOf,
      receivedOn: asOf,
      kind: "cessation_of_residence",
      member: MEMBERS.find((member) => member.memberNo === "HB-10043") ?? null,
      readings: [readByRules({ id: "x", title: "x", text })],
    };
    const finding = applyChecks({
      pipelineId: "member_request",
      stepId: "check_eligibility",
      checks: MEMBER_REQUEST_CHECKS.check_eligibility,
      facts,
      states,
      asOf,
    }).find((item) => item.ruleId === "mr.overseas-absence");
    return { states, finding };
  };

  it("still applies the Version in force before the date", () => {
    const { states, finding } = absenceOn(TODAY);
    expect(finding).toMatchObject({ ruleVersion: 0 });
    expect(ruleVersionsOf(states)["mr.overseas-absence"]).toBe(0);
    expect(rulesNotInForce(states)).toEqual([]);
  });

  it("applies the scheduled Version from its date", () => {
    const { finding } = absenceOn("2027-01-01");
    expect(finding).toMatchObject({ ruleVersion: 1 });
  });

  it("skips a Rule whose Default is not yet in force, and records it as such", () => {
    const states = resolveRuleStatesAsOf("member_request", {}, "1990-01-01");
    expect(states["mr.overseas-absence"]).toBeNull();
    expect(rulesNotInForce(states)).toContain("mr.overseas-absence");
    expect(ruleVersionsOf(states)).not.toHaveProperty("mr.overseas-absence");
  });
});

// contribution_processing ------------------------------------------------------------------

function runContribution(text: string, employerCode: string) {
  const parsed = parseSchedule(text);
  const period = book.periods.upload;
  const states = resolveRuleStates("contribution_processing", null);
  const members: Record<string, ScheduleMember> = Object.fromEntries(
    book.members.map((member) => [
      member.memberNo,
      {
        memberNo: member.memberNo,
        fullName: member.fullName,
        employerId: member.employerCode,
        status: member.status,
        employmentEndedOn: member.employmentEndedOn,
        dateOfBirth: member.dateOfBirth,
        caymanian: member.caymanian,
        residencyStatus: member.residencyStatus,
        startedWorkOn: member.startedWorkOn,
      },
    ]),
  );
  const remittances = book.remittances
    .filter(
      (item) => item.employerCode === employerCode && item.period === period,
    )
    .map((item) => ({
      amountKyd: item.amountKyd,
      receivedOn: item.receivedOn,
      reference: item.reference,
    }));
  const run = <F>(stepId: keyof typeof CONTRIBUTION_CHECKS, facts: F) =>
    applyChecks({
      pipelineId: "contribution_processing",
      stepId,
      checks: CONTRIBUTION_CHECKS[stepId] as never,
      facts,
      states,
      asOf: TODAY,
    });
  const findings = [
    ...run("match_members", {
      period,
      employerId: employerCode,
      lines: parsed.lines,
      members,
    }),
    ...run("check_rates", {
      lines: parsed.lines,
      annualCapKyd: Number(paramOf(states, "cp.ympe-cap", "annualCap")),
    }),
    ...run("check_cap", {
      lines: parsed.lines,
      totalRatePct: Number(paramOf(states, "cp.total-rate", "totalRate")),
    }),
    ...run("check_coverage", { period, lines: parsed.lines, members }),
    ...run("match_remittance", {
      period,
      asOf: TODAY,
      scheduleTotalKyd: scheduleTotal(parsed.lines),
      remittances,
    }),
  ];
  const recon = reconcile({
    lines: parsed.lines,
    findings,
    receivedKyd: remittances.reduce((sum, item) => sum + item.amountKyd, 0),
    readProblems: parsed.problems,
  });
  return { parsed, findings, recon };
}

describe("golden: contribution_processing", () => {
  it("posts the clean Pelican Shoal Schedule", () => {
    const { parsed, findings, recon } = runContribution(
      readFileSync(join(SAMPLES, "schedule-pelican-shoal.csv"), "utf8"),
      "ER-1001",
    );
    expect(parsed.employerCode).toBe("ER-1001");
    expect(findings).toHaveLength(11);
    expect(unmet(findings)).toEqual({});
    expect(recon.decision).toBe("post");
    expect(recon.totals).toMatchObject({
      lines: 8,
      totalKyd: 4295,
      receivedKyd: 4295,
      differenceKyd: 0,
    });
    const plan = contributionDraftPlan({
      employer: {
        code: "ER-1001",
        name: "Pelican Shoal Marine Services Ltd",
        contactEmail: null,
      },
      employerCode: "ER-1001",
      period: book.periods.upload,
      reconciliation: recon,
      override: false,
    });
    expect(plan).toMatchObject({ kind: "posting_note", risk: "low" });
  });

  it("holds Calloway Bight at 4% with a stranger, and asks the Employer", () => {
    const text = readXlsx(
      new Uint8Array(
        readFileSync(join(SAMPLES, "schedule-calloway-bight.xlsx")),
      ),
    )
      .map((sheet) => sheet.csv)
      .join("\n");
    const { findings, recon } = runContribution(text, "ER-1005");
    expect(unmet(findings)).toEqual({
      "cp.known-member": "refer",
      "cp.employer-rate": "refer",
      "cp.total-rate": "refer",
    });
    expect(recon.decision).toBe("hold");
    expect(
      recon.exceptions
        .filter((row) => row.ruleId === "cp.known-member")
        .map((row) => row.memberNo),
    ).toEqual(["HB-19417"]);
    expect(
      recon.exceptions.filter((row) => row.ruleId === "cp.employer-rate"),
    ).toHaveLength(7);
    expect(recon.totals.differenceKyd).toBe(0);
    const query = contributionDraftPlan({
      employer: {
        code: "ER-1005",
        name: "Calloway Bight Logistics Ltd",
        contactEmail: null,
      },
      employerCode: "ER-1005",
      period: book.periods.upload,
      reconciliation: recon,
      override: false,
    });
    expect(query).toMatchObject({ kind: "employer_query", risk: "low" });
    expect(query.particulars).toContain("HB-19417");
    // A blank line ends the totals table, so Markdown does not read the heading as a row.
    expect(query.particulars).toMatch(/\|\n\n\*\*Exceptions\*\*\n\n\|/);
    const override = contributionDraftPlan({
      employer: null,
      employerCode: "ER-1005",
      period: book.periods.upload,
      reconciliation: recon,
      override: true,
    });
    expect(override).toMatchObject({
      kind: "posting_instruction",
      risk: "high",
    });
  });
});

// delinquency_report -----------------------------------------------------------------------

describe("golden: delinquency_report", () => {
  const period = book.periods.latest;
  const facts: PeriodFacts = {
    asOf: TODAY,
    period,
    employers: book.employers.map((employer) => {
      const schedule = book.schedules.find(
        (item) => item.employerCode === employer.code && item.period === period,
      );
      return {
        employerId: employer.code,
        code: employer.code,
        name: employer.name,
        status: employer.status,
        contactEmail: employer.contactEmail,
        scheduleTotalKyd: schedule
          ? scheduleTotal(
              schedule.lines.map((line, index) => ({
                ...line,
                line: index + 1,
              })),
            )
          : null,
        remittances: book.remittances
          .filter(
            (item) =>
              item.employerCode === employer.code && item.period === period,
          )
          .map((item) => ({
            amountKyd: item.amountKyd,
            receivedOn: item.receivedOn,
            reference: item.reference,
          })),
      };
    }),
  };
  const states = resolveRuleStates("delinquency_report", null);
  const found = (["find_missing", "find_late"] as const).flatMap((stepId) =>
    applyChecks({
      pipelineId: "delinquency_report",
      stepId,
      checks: DELINQUENCY_CHECKS[stepId],
      facts,
      states,
      asOf: TODAY,
    }),
  );
  const computeFacts = {
    asOf: TODAY,
    period,
    dueDay: 15,
    entries: entriesOf(found),
  };
  const computed = applyChecks({
    pipelineId: "delinquency_report",
    stepId: "compute",
    checks: DELINQUENCY_CHECKS.compute,
    facts: computeFacts,
    states,
    asOf: TODAY,
  });

  it("finds Brackwater unpaid, Lanternfish short and Wrayfield late", () => {
    expect(unmet(found)).toEqual({
      "dr.missing": "refer",
      "dr.short": "refer",
      "dr.late": "warn",
    });
    expect(
      entriesOf(found).map((entry) => `${entry.code}:${entry.kind}`),
    ).toEqual(["ER-1002:late", "ER-1003:unpaid", "ER-1004:short"]);
    expect(
      entriesOf(found).find((entry) => entry.kind === "short")?.amountKyd,
    ).toBe(412.5);
  });

  it("works out interest and the report date", () => {
    expect(unmet(computed)).toEqual({ "dr.interest": "warn" });
    const deadline = computed.find(
      (finding) => finding.ruleId === "dr.report-deadline",
    );
    expect(deadline?.compared).toMatchObject({
      reportableOn: "2026-11-15",
      reportBy: "2026-11-20",
      daysLeft: 3,
    });
    const rows = rowsFor(computeFacts, 13.5);
    const late = rows.find((row) => row.kind === "late");
    expect(late?.daysLate).toBe(4);
    expect(arrearsTotals(rows).reportableEmployers).toBe(2);
    const plan = regulatorReportPlan({
      period,
      rows,
      reportBy: "2026-11-20",
      asOf: TODAY,
    });
    expect(plan).toMatchObject({ kind: "regulator_report", risk: "high" });
    expect(plan.particulars).toContain("Brackwater Construction Ltd");
  });

  it("is only a period that has a Schedule for every Employer", () => {
    expect(
      facts.employers.every((employer) => employer.scheduleTotalKyd !== null),
    ).toBe(true);
    expect(periodStart(period)).toBe("2026-09-01");
  });
});
