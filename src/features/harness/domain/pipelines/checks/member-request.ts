import { MEMBER_REQUEST_LABEL } from "../../records";
import type { Check } from "../apply";
import { list, num } from "../apply";
import {
  addDays,
  addYears,
  daysBetween,
  formatDate,
  formatKyd,
  wholeYearsBetween,
  yearsToOneDecimal,
} from "../dates";
import { DOCUMENT_TYPE_LABEL, type DocumentType } from "../documents";
import {
  claimedIdentity,
  type MemberRequestFacts,
  normaliseMemberNo,
  papersPresent,
  propertyPurposeOf,
  requestedAmount,
} from "../member-request";
import { nameDistance } from "./text";

type MrCheck = Check<MemberRequestFacts>;

const kindIs = (facts: MemberRequestFacts, ...kinds: string[]) =>
  facts.kind !== null && kinds.includes(facts.kind);

// check_identity -------------------------------------------------------------------

const identityMatch: MrCheck = (facts, params) => {
  const allowed = num(params, "maxNameDistance", 2);
  const claimed = claimedIdentity(facts.readings);
  const member = facts.member;
  if (!member) {
    return {
      met: false,
      summary: claimed.memberNo
        ? `No Member record has number ${claimed.memberNo}.`
        : "No Member record matches the papers.",
      compared: { claimed, record: null },
    };
  }
  if (!claimed.memberNo && !claimed.fullName) {
    return {
      met: false,
      summary: "The papers give neither a member number nor a name.",
      compared: { claimed, record: member.memberNo },
    };
  }
  const problems: string[] = [];
  const numberMatches =
    claimed.memberNo === null ||
    normaliseMemberNo(claimed.memberNo) === member.memberNo;
  if (!numberMatches) {
    problems.push(
      `the papers give ${claimed.memberNo}, the record is ${member.memberNo}`,
    );
  }
  const distance =
    claimed.fullName === null
      ? 0
      : nameDistance(claimed.fullName, member.fullName);
  if (distance > allowed) {
    problems.push(
      `the name "${claimed.fullName}" differs from "${member.fullName}" by ${distance} letters`,
    );
  }
  const birthMatches =
    claimed.dateOfBirth === null ||
    member.dateOfBirth === null ||
    claimed.dateOfBirth === member.dateOfBirth;
  if (!birthMatches) {
    problems.push(
      `the date of birth ${claimed.dateOfBirth} is not the record's ${member.dateOfBirth}`,
    );
  }
  return {
    met: problems.length === 0,
    summary:
      problems.length === 0
        ? `The papers match ${member.fullName} (${member.memberNo}).`
        : `Identity does not match: ${problems.join("; ")}.`,
    compared: {
      claimedMemberNo: claimed.memberNo,
      recordMemberNo: member.memberNo,
      claimedName: claimed.fullName,
      recordName: member.fullName,
      nameDistance: distance,
      maxNameDistance: allowed,
      claimedDateOfBirth: claimed.dateOfBirth,
      recordDateOfBirth: member.dateOfBirth,
    },
  };
};

const accountOpen: MrCheck = (facts, params) => {
  if (!facts.member) return null;
  const blocked = list(params, "blockedStatuses");
  const status = facts.member.status;
  const met = !blocked.includes(status);
  return {
    met,
    summary: met
      ? `The account is ${status}.`
      : `The account is ${status}; a request cannot proceed on it.`,
    compared: { status, blockedStatuses: blocked },
  };
};

// check_eligibility ----------------------------------------------------------------

const employmentEnded: MrCheck = (facts, params) => {
  const kinds = list(params, "kinds");
  if (!facts.member || !facts.kind || !kinds.includes(facts.kind)) return null;
  const ended = facts.member.employmentEndedOn;
  const met = ended !== null && ended <= facts.asOf;
  return {
    met,
    summary: met
      ? `Employment ended on ${formatDate(ended)}.`
      : `${MEMBER_REQUEST_LABEL[facts.kind]} needs employment to have ended; the record shows none.`,
    compared: { employmentEndedOn: ended, asOf: facts.asOf },
  };
};

const overseasAbsence: MrCheck = (facts, params) => {
  if (!facts.member || !kindIs(facts, "cessation_of_residence")) return null;
  const minYears = num(params, "minYears", 2);
  const left = facts.member.leftCaymanOn;
  if (!left) {
    return {
      met: false,
      summary: "The record has no date the Member left the Islands.",
      compared: { leftCaymanOn: null, minYears },
    };
  }
  const years = wholeYearsBetween(left, facts.asOf);
  const eligibleFrom = addYears(left, minYears);
  const met = eligibleFrom <= facts.asOf;
  return {
    met,
    summary: met
      ? `Away from the Islands since ${formatDate(left)}: ${yearsToOneDecimal(left, facts.asOf)} years, at least ${minYears}.`
      : `Away from the Islands since ${formatDate(left)}: ${yearsToOneDecimal(left, facts.asOf)} years, less than ${minYears}. Eligible from ${formatDate(eligibleFrom)}.`,
    compared: {
      leftCaymanOn: left,
      asOf: facts.asOf,
      wholeYearsAway: years,
      minYears,
      eligibleFrom,
    },
  };
};

const overseasNoContributions: MrCheck = (facts, params) => {
  if (!facts.member || !kindIs(facts, "cessation_of_residence")) return null;
  const minYears = num(params, "minYears", 2);
  const last = facts.member.lastContributionOn;
  if (!last) {
    return {
      met: true,
      summary: "No contribution is on record for the Member.",
      compared: { lastContributionOn: null, minYears },
    };
  }
  const eligibleFrom = addYears(last, minYears);
  const met = eligibleFrom <= facts.asOf;
  return {
    met,
    summary: met
      ? `Last contribution ${formatDate(last)}: over ${minYears} years ago.`
      : `Last contribution ${formatDate(last)}: under ${minYears} years ago. Eligible from ${formatDate(eligibleFrom)}.`,
    compared: {
      lastContributionOn: last,
      asOf: facts.asOf,
      minYears,
      eligibleFrom,
    },
  };
};

const cashRefundClosed: MrCheck = (facts, params) => {
  if (!facts.member || !kindIs(facts, "cessation_of_residence")) return null;
  if (!facts.readings.some((reading) => reading.asksCashRefund)) return null;
  const threshold = num(params, "threshold", 5_000);
  const balance = facts.member.balanceKyd;
  const met = balance < threshold;
  return {
    met,
    summary: met
      ? `A cash payment is possible: the balance ${formatKyd(balance)} is under ${formatKyd(threshold)}.`
      : `The papers ask for cash, but cash refunds on leaving ended on 31 December 2019 for balances of ${formatKyd(threshold)} or more (this one is ${formatKyd(balance)}). Only a transfer or staying in the plan is open.`,
    compared: { balanceKyd: balance, threshold },
  };
};

const propertyCaymanian: MrCheck = (facts) => {
  if (!facts.member || !kindIs(facts, "property")) return null;
  const met = facts.member.caymanian;
  return {
    met,
    summary: met
      ? "The Member is Caymanian."
      : `The Member is not Caymanian (${facts.member.nationality ?? "nationality not recorded"}); only a Caymanian may withdraw for property.`,
    compared: {
      caymanian: facts.member.caymanian,
      nationality: facts.member.nationality,
    },
  };
};

const propertyCap: MrCheck = (facts, params) => {
  if (!facts.member || !kindIs(facts, "property")) return null;
  const amount = requestedAmount(facts.readings);
  const purpose = propertyPurposeOf(facts.readings) ?? "deposit";
  const cap =
    purpose === "payoff"
      ? num(params, "payoffCap", 100_000)
      : num(params, "depositCap", 50_000);
  const balance = facts.member.balanceKyd;
  if (amount === null) {
    return {
      met: false,
      summary: "The papers do not say how much is asked for.",
      compared: {
        requestedKyd: null,
        purpose,
        capKyd: cap,
        balanceKyd: balance,
      },
    };
  }
  const problems: string[] = [];
  if (amount > cap)
    problems.push(
      `${formatKyd(amount)} is over the ${purpose} cap of ${formatKyd(cap)}`,
    );
  if (amount > balance)
    problems.push(
      `${formatKyd(amount)} is more than the balance of ${formatKyd(balance)}`,
    );
  return {
    met: problems.length === 0,
    summary:
      problems.length === 0
        ? `${formatKyd(amount)} for a ${purpose} is within the cap of ${formatKyd(cap)} and the balance.`
        : `${problems.join("; ")}.`,
    compared: {
      requestedKyd: amount,
      purpose,
      capKyd: cap,
      balanceKyd: balance,
    },
  };
};

const retirementAge: MrCheck = (facts, params) => {
  if (!facts.member || !kindIs(facts, "retirement")) return null;
  const normalAge = num(params, "normalAge", 65);
  const earlyAge = num(params, "earlyAge", 55);
  const born = facts.member.dateOfBirth;
  if (!born) {
    return {
      met: false,
      summary: "The record has no date of birth.",
      compared: { dateOfBirth: null, normalAge, earlyAge },
    };
  }
  const age = wholeYearsBetween(born, facts.asOf);
  const ended =
    facts.member.employmentEndedOn !== null &&
    facts.member.employmentEndedOn <= facts.asOf;
  const met = age >= normalAge || (age >= earlyAge && ended);
  return {
    met,
    summary:
      age >= normalAge
        ? `Aged ${age}: at or past the normal age of ${normalAge}.`
        : met
          ? `Aged ${age} with employment ended: early retirement from ${earlyAge} applies.`
          : age >= earlyAge
            ? `Aged ${age}: early retirement from ${earlyAge} needs employment to have ended first.`
            : `Aged ${age}: under the early age of ${earlyAge}.`,
    compared: {
      dateOfBirth: born,
      asOf: facts.asOf,
      age,
      normalAge,
      earlyAge,
      employmentEnded: ended,
    },
  };
};

// check_deadline -------------------------------------------------------------------

function timeLimit(
  facts: MemberRequestFacts,
  days: number,
  what: string,
): ReturnType<MrCheck> {
  const due = addDays(facts.receivedOn, days);
  const left = daysBetween(facts.asOf, due);
  const met = left >= 0;
  return {
    met,
    summary: met
      ? `${what} by ${formatDate(due)}: ${left} day${left === 1 ? "" : "s"} left of ${days}.`
      : `${what} was due by ${formatDate(due)}: ${-left} day${left === -1 ? "" : "s"} overdue.`,
    compared: {
      receivedOn: facts.receivedOn,
      asOf: facts.asOf,
      days,
      dueOn: due,
      daysLeft: left,
    },
  };
}

const transferTimeLimit: MrCheck = (facts, params) => {
  if (!kindIs(facts, "transfer_out", "cessation_of_residence")) return null;
  return timeLimit(facts, num(params, "days", 45), "The transfer must be made");
};

const propertyTimeLimit: MrCheck = (facts, params) => {
  if (!kindIs(facts, "property")) return null;
  const result = timeLimit(
    facts,
    num(params, "payDays", 60),
    "The withdrawal must be paid",
  );
  if (!result) return null;
  const refuseDays = num(params, "refuseDays", 7);
  const refuseBy = addDays(facts.receivedOn, refuseDays);
  return {
    ...result,
    summary: `${result.summary} A refusal needs written reasons by ${formatDate(refuseBy)}.`,
    compared: { ...result.compared, refuseDays, refuseBy },
  };
};

const statementTimeLimit: MrCheck = (facts, params) => {
  if (kindIs(facts, "retirement"))
    return timeLimit(
      facts,
      num(params, "retirementDays", 30),
      "The retirement statement must be sent",
    );
  if (kindIs(facts, "death"))
    return timeLimit(
      facts,
      num(params, "deathDays", 30),
      "The statement of benefits must be sent",
    );
  return null;
};

// check_documents ------------------------------------------------------------------

function papersCheck(
  facts: MemberRequestFacts,
  required: string[],
): ReturnType<MrCheck> {
  const present = papersPresent(facts.readings);
  const missing = required.filter((type) => !present.has(type as DocumentType));
  const label = (type: string) =>
    DOCUMENT_TYPE_LABEL[type as DocumentType] ?? type;
  return {
    met: missing.length === 0,
    summary:
      missing.length === 0
        ? `All ${required.length} papers this request needs are there.`
        : `Missing: ${missing.map(label).join(", ")}.`,
    compared: {
      required,
      present: [...present].filter((type) => type !== "other"),
      missing,
    },
  };
}

const docsStatutory: MrCheck = (facts, params) => {
  if (kindIs(facts, "transfer_out"))
    return papersCheck(facts, list(params, "transferOut"));
  if (kindIs(facts, "cessation_of_residence"))
    return papersCheck(facts, list(params, "overseas"));
  if (kindIs(facts, "property")) {
    const purpose = propertyPurposeOf(facts.readings) ?? "deposit";
    return papersCheck(facts, [
      ...list(params, "property"),
      ...list(
        params,
        purpose === "deposit" ? "propertyDeposit" : "propertyMortgage",
      ),
    ]);
  }
  return null;
};

const docsPlan: MrCheck = (facts, params) => {
  if (kindIs(facts, "retirement"))
    return papersCheck(facts, list(params, "retirement"));
  if (kindIs(facts, "death")) return papersCheck(facts, list(params, "death"));
  return null;
};

/** The member request checks, by Step and Rule id. */
export const MEMBER_REQUEST_CHECKS = {
  check_identity: {
    "mr.identity-match": identityMatch,
    "mr.account-open": accountOpen,
  },
  check_eligibility: {
    "mr.employment-ended": employmentEnded,
    "mr.overseas-absence": overseasAbsence,
    "mr.overseas-no-contributions": overseasNoContributions,
    "mr.cash-refund-closed": cashRefundClosed,
    "mr.property-caymanian": propertyCaymanian,
    "mr.property-cap": propertyCap,
    "mr.retirement-age": retirementAge,
  },
  check_documents: {
    "mr.docs-statutory": docsStatutory,
    "mr.docs-plan": docsPlan,
  },
  check_deadline: {
    "mr.transfer-time-limit": transferTimeLimit,
    "mr.property-time-limit": propertyTimeLimit,
    "mr.statement-time-limit": statementTimeLimit,
  },
} satisfies Record<string, Record<string, MrCheck>>;
