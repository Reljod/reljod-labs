import type {
  EmployerStatus,
  MemberRequestKind,
  MemberRequestStatus,
  MemberStatus,
} from "../records";
import {
  addDays,
  addMonths,
  addPeriods,
  addYears,
  dayAfterPeriod,
  periodEnd,
  periodOf,
  periodStart,
  round2,
} from "./dates";
import {
  lineFor,
  linesTotal,
  ordinaryLines,
  ROSTER_EMPLOYERS,
  ROSTER_MEMBERS,
  type RosterMember,
  type SampleLine,
  SHORT_PAID_KYD,
} from "./sample-book";

/*
 * The seed book of a new Workspace, laid out relative to the day it is
 * seeded so the demo stays current. Pure: the same `today` gives the same
 * book, so tests and the sample files agree with what a Workspace holds.
 *
 * Months, counted back from `today`:
 *   upload = last month. Money has come in from every Employer but one;
 *            no Schedule yet (the sample files are those Schedules).
 *   latest = the month before. Every Schedule is in, with the problems the
 *            demo is built on: Brackwater unpaid, Wrayfield paid on the
 *            19th, Lanternfish short, Calloway at 4% with a stranger.
 *   latest − 1 and latest − 2: clean and reconciled.
 */

export type SeedEmployer = {
  code: string;
  name: string;
  status: EmployerStatus;
  joinedOn: string;
  contactEmail: string;
};

export type SeedMember = {
  memberNo: string;
  employerCode: string | null;
  fullName: string;
  dateOfBirth: string;
  nationality: string;
  caymanian: boolean;
  residencyStatus: string;
  leftCaymanOn: string | null;
  employmentEndedOn: string | null;
  lastContributionOn: string | null;
  startedWorkOn: string | null;
  balanceKyd: number;
  vested: boolean;
  email: string;
  address: string;
  status: MemberStatus;
};

export type SeedSchedule = {
  employerCode: string;
  period: string;
  receivedOn: string;
  status: "received" | "reconciled";
  lines: SampleLine[];
};

export type SeedRemittance = {
  employerCode: string;
  period: string;
  amountKyd: number;
  receivedOn: string;
  reference: string;
};

export type SeedRequest = {
  memberNo: string;
  kind: MemberRequestKind;
  receivedOn: string;
  status: MemberRequestStatus;
  amountKyd: number;
  details: Record<string, unknown>;
};

export type SeedBook = {
  today: string;
  periods: { upload: string; latest: string; earlier: string[] };
  employers: SeedEmployer[];
  members: SeedMember[];
  schedules: SeedSchedule[];
  remittances: SeedRemittance[];
  requests: SeedRequest[];
};

/** Birthdays spread through the year, the same every time. */
const birthdayShift = (index: number) => 10 + ((index * 37) % 300);

const ISLANDS = [
  "George Town",
  "West Bay",
  "Bodden Town",
  "Savannah",
  "East End",
  "North Side",
];

function emailOf(name: string) {
  return `${name
    .toLowerCase()
    .replace(/[^a-z]+/g, ".")
    .replace(/^\.|\.$/g, "")}@mail.example`;
}

function datesFor(member: RosterMember, today: string, latest: string) {
  const role = member.role;
  if (role === "overseas-eligible") {
    const left = addDays(today, -1115);
    const ended = addDays(left, -14);
    return { left, ended, last: periodEnd(periodOf(ended)) };
  }
  if (role === "overseas-too-soon") {
    const left = addDays(today, -430);
    const ended = addDays(left, -10);
    return { left, ended, last: periodEnd(periodOf(ended)) };
  }
  if (role === "transfer-out") {
    return { left: null, ended: periodEnd(latest), last: periodEnd(latest) };
  }
  if (role === "retired") {
    const ended = addMonths(today, -10);
    return { left: null, ended, last: periodEnd(periodOf(ended)) };
  }
  if (role === "closed") {
    const ended = addMonths(today, -16);
    return {
      left: addMonths(today, -15),
      ended,
      last: periodEnd(periodOf(ended)),
    };
  }
  return { left: null, ended: null, last: periodEnd(latest) };
}

/** Whether a Member was on their Employer's payroll in a month. */
function workedIn(member: SeedMember, period: string): boolean {
  if (member.startedWorkOn && member.startedWorkOn > periodEnd(period))
    return false;
  if (
    member.employmentEndedOn &&
    member.employmentEndedOn < periodStart(period)
  )
    return false;
  return member.status === "active" || member.status === "inactive";
}

/** The lines of one Employer's Schedule for a month. */
export function seedLines(
  book: Pick<SeedBook, "members">,
  employerCode: string,
  period: string,
): SampleLine[] {
  const working = new Set(
    book.members
      .filter(
        (member) =>
          member.employerCode === employerCode && workedIn(member, period),
      )
      .map((member) => member.memberNo),
  );
  const ordinary = ordinaryLines(employerCode).filter(
    (line) =>
      working.has(line.memberNo) ||
      !ROSTER_MEMBERS.some((member) => member.memberNo === line.memberNo),
  );
  // Members who have since left are not in an ordinary month's lines; add them back for the months they worked.
  const leavers = ROSTER_MEMBERS.filter(
    (member) =>
      member.employerCode === employerCode &&
      member.status === "inactive" &&
      working.has(member.memberNo),
  ).map((member) => lineFor(member));
  return [...ordinary, ...leavers];
}

export function buildSeedBook(today: string): SeedBook {
  const upload = addPeriods(periodOf(today), -1);
  const latest = addPeriods(upload, -1);
  const earlier = [addPeriods(latest, -2), addPeriods(latest, -1)];
  const yesterday = addDays(today, -1);

  const employers: SeedEmployer[] = ROSTER_EMPLOYERS.map((employer) => ({
    code: employer.code,
    name: employer.name,
    status: "active",
    joinedOn: `${addYears(periodStart(latest), -employer.yearsInPlan).slice(0, 7)}-01`,
    contactEmail: employer.contactEmail,
  }));

  const members: SeedMember[] = ROSTER_MEMBERS.map((member, index) => {
    const dates = datesFor(member, today, latest);
    return {
      memberNo: member.memberNo,
      employerCode: member.employerCode,
      fullName: member.fullName,
      dateOfBirth: addDays(addYears(today, -member.age), -birthdayShift(index)),
      nationality: member.nationality,
      caymanian: member.residency === "caymanian",
      residencyStatus: member.residency,
      leftCaymanOn: dates.left,
      employmentEndedOn: dates.ended,
      lastContributionOn: dates.last,
      startedWorkOn:
        member.startedMonthsAgo === null
          ? null
          : addMonths(today, -member.startedMonthsAgo),
      balanceKyd: member.balanceKyd,
      vested: true,
      email: emailOf(member.fullName),
      address: dates.left
        ? "Address abroad on file"
        : `${ISLANDS[index % ISLANDS.length]}, Grand Cayman`,
      status: member.status,
    };
  });

  const book = { members };
  const schedules: SeedSchedule[] = [];
  const remittances: SeedRemittance[] = [];
  for (const [position, period] of [...earlier, latest].entries()) {
    const isLatest = period === latest;
    for (const [index, employer] of ROSTER_EMPLOYERS.entries()) {
      const lines = seedLines(book, employer.code, period);
      schedules.push({
        employerCode: employer.code,
        period,
        receivedOn: dayAfterPeriod(period, 1, 9),
        status: isLatest ? "received" : "reconciled",
        lines,
      });
      const total = linesTotal(lines);
      const reference = `${employer.code}/${period}`;
      const onTime = dayAfterPeriod(period, 1, 8 + ((index + position) % 6));
      if (!isLatest) {
        remittances.push({
          employerCode: employer.code,
          period,
          amountKyd: total,
          receivedOn: onTime,
          reference,
        });
        continue;
      }
      if (employer.code === "ER-1003") continue;
      remittances.push({
        employerCode: employer.code,
        period,
        amountKyd:
          employer.code === "ER-1004" ? round2(total - SHORT_PAID_KYD) : total,
        receivedOn:
          employer.code === "ER-1002" ? dayAfterPeriod(period, 1, 19) : onTime,
        reference,
      });
    }
  }
  // Last month: money in from all but Brackwater; the Schedules arrive as the sample files.
  for (const [index, employer] of ROSTER_EMPLOYERS.entries()) {
    if (employer.code === "ER-1003") continue;
    const due = dayAfterPeriod(upload, 1, 9 + (index % 4));
    remittances.push({
      employerCode: employer.code,
      period: upload,
      amountKyd: linesTotal(seedLines(book, employer.code, upload)),
      receivedOn: due < yesterday ? due : yesterday,
      reference: `${employer.code}/${upload}`,
    });
  }

  const memberNo = (role: RosterMember["role"]) =>
    ROSTER_MEMBERS.find((member) => member.role === role)?.memberNo as string;
  const requests: SeedRequest[] = [
    {
      memberNo: memberNo("retired"),
      kind: "retirement",
      receivedOn: addMonths(today, -10),
      status: "paid",
      amountKyd: 187_300,
      details: { note: "Moved to a Retirement Savings Arrangement." },
    },
    {
      memberNo: memberNo("closed"),
      kind: "transfer_out",
      receivedOn: addMonths(today, -14),
      status: "closed",
      amountKyd: 12_880,
      details: {
        note: "Transferred to another registered plan; account closed.",
      },
    },
    {
      memberNo: "HB-10027",
      kind: "property",
      receivedOn: addMonths(today, -8),
      status: "paid",
      amountKyd: 30_000,
      details: { purpose: "deposit", note: "Paid to the lender." },
    },
  ];

  return {
    today,
    periods: { upload, latest, earlier },
    employers,
    members,
    schedules,
    remittances,
    requests,
  };
}
