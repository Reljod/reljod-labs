import { addDays, type BankDate, dateOf, daysBetween } from "./dates";
import { monthlyPayment } from "./lending";
import { formatMoney } from "./money";
import { bool, num, type Rulebook, type RuleId, words } from "./rules";

/**
 * The checks that apply the Rules. Pure functions: facts and a Rulebook in,
 * Findings out. Every Parameter comes from the Rulebook, never a constant,
 * and only this code decides: a model never returns a Finding.
 */

export type Outcome =
  /** The command is refused. */
  | "refuse"
  /** The command waits for a supervisor's Approval (maker-checker). */
  | "approval"
  /** The payment is held for review and an Alert is raised. */
  | "hold"
  /** An Alert is raised for the record; nothing waits. */
  | "alert"
  | "pass";

export type Finding = {
  ruleId: RuleId;
  /** The Version of the Rule that decided, 0 for the Default. */
  version: number;
  outcome: Outcome;
  message: string;
  facts: Record<string, number | string | boolean>;
};

function finding(
  book: Rulebook,
  ruleId: RuleId,
  outcome: Outcome,
  message: string,
  facts: Finding["facts"] = {},
): Finding {
  return { ruleId, version: book[ruleId].version, outcome, message, facts };
}

const on = (book: Rulebook, ruleId: RuleId) => book[ruleId].enabled;

// Payments ---------------------------------------------------------------------

export type PaymentKind = "internal" | "external" | "bill";

export type PaymentFacts = {
  kind: PaymentKind;
  amount: number;
  /** What the account has already sent in this bank day. */
  sentToday: number;
  kycStatus: "pending" | "verified" | "rejected";
  /** When the account's recent outgoing payments were made (bank time, ISO). */
  recentOutgoing: { at: string; amount: number }[];
  /** Bank time now, ISO. */
  now: string;
  payee: { createdOn: BankDate; firstPaidOn: BankDate | null } | null;
  /** A standing order or another bank-run payment: fraud holds do not apply twice. */
  scheduled?: boolean;
};

export type PaymentDecision = {
  findings: Finding[];
  /** The first refusal, if the payment may not be made at all. */
  refusal: Finding | null;
  /** Set when a supervisor must approve it first. */
  approval: Finding | null;
  /** Set when it must be held for review. */
  holds: Finding[];
  alerts: Finding[];
  fee: number;
};

export function feeFor(book: Rulebook, kind: PaymentKind): number {
  if (!on(book, "fees.payments")) return 0;
  if (kind === "external") return num(book, "fees.payments", "external");
  if (kind === "bill") return num(book, "fees.payments", "bill");
  return 0;
}

/** Movements just under the reporting threshold, counted for structuring. */
export function structuringCount(
  book: Rulebook,
  movements: { at: string; amount: number }[],
  now: string,
): number {
  const threshold = num(book, "aml.structuring", "threshold");
  const floor = Math.floor(
    (threshold * (100 - num(book, "aml.structuring", "bandPercent"))) / 100,
  );
  const since =
    Date.parse(now) - num(book, "aml.structuring", "days") * 86_400_000;
  return movements.filter(
    (item) =>
      item.amount >= floor &&
      item.amount < threshold &&
      Date.parse(item.at) >= since,
  ).length;
}

export function checkPayment(
  book: Rulebook,
  facts: PaymentFacts,
): PaymentDecision {
  const findings: Finding[] = [];
  const today = dateOf(new Date(facts.now));

  if (facts.kycStatus === "rejected") {
    findings.push(
      finding(
        book,
        "limits.kyc",
        "refuse",
        "This customer's identity check was rejected; they cannot send money.",
      ),
    );
  }
  const perPayment = num(book, "limits.payments", "perPayment");
  if (facts.amount > perPayment) {
    findings.push(
      finding(
        book,
        "limits.payments",
        "refuse",
        `One payment may not exceed ${formatMoney(perPayment)}.`,
        { amount: facts.amount, perPayment },
      ),
    );
  }
  const perDay = num(book, "limits.payments", "perDay");
  if (facts.sentToday + facts.amount > perDay) {
    findings.push(
      finding(
        book,
        "limits.payments",
        "refuse",
        `That would take the account past ${formatMoney(perDay)} sent today (${formatMoney(facts.sentToday)} so far).`,
        { amount: facts.amount, sentToday: facts.sentToday, perDay },
      ),
    );
  }
  if (facts.kycStatus === "pending" && on(book, "limits.kyc")) {
    const cap = num(book, "limits.kyc", "pendingPerDay");
    if (facts.sentToday + facts.amount > cap) {
      findings.push(
        finding(
          book,
          "limits.kyc",
          "refuse",
          `Until their identity is verified this customer may send ${formatMoney(cap)} a day.`,
          { amount: facts.amount, sentToday: facts.sentToday, cap },
        ),
      );
    }
  }

  const threshold = num(book, "approval.threshold", "paymentsFrom");
  if (facts.amount >= threshold && !facts.scheduled) {
    findings.push(
      finding(
        book,
        "approval.threshold",
        "approval",
        `A payment of ${formatMoney(threshold)} or more needs a supervisor who did not make it.`,
        { amount: facts.amount, threshold },
      ),
    );
  }

  const leavesTheBank = facts.kind !== "internal";
  if (leavesTheBank && !facts.scheduled) {
    if (on(book, "fraud.amount")) {
      const holdFrom = num(book, "fraud.amount", "holdFrom");
      if (facts.amount >= holdFrom) {
        findings.push(
          finding(
            book,
            "fraud.amount",
            "hold",
            `A payment of ${formatMoney(holdFrom)} or more to another bank is reviewed before it leaves.`,
            { amount: facts.amount, holdFrom },
          ),
        );
      }
    }
    if (on(book, "fraud.velocity")) {
      const hours = num(book, "fraud.velocity", "hours");
      const since = Date.parse(facts.now) - hours * 3_600_000;
      const recent = facts.recentOutgoing.filter(
        (item) => Date.parse(item.at) >= since,
      ).length;
      const count = num(book, "fraud.velocity", "count");
      if (recent >= count) {
        findings.push(
          finding(
            book,
            "fraud.velocity",
            "hold",
            `${recent} payments already left this account in the last ${hours} hour(s); more than ${count} is reviewed.`,
            { recent, count, hours },
          ),
        );
      }
    }
    if (
      on(book, "fraud.new_payee") &&
      facts.payee &&
      !facts.payee.firstPaidOn
    ) {
      const from = num(book, "fraud.new_payee", "from");
      const days = num(book, "fraud.new_payee", "days");
      const age = daysBetween(facts.payee.createdOn, today);
      if (facts.amount >= from && age <= days) {
        findings.push(
          finding(
            book,
            "fraud.new_payee",
            "hold",
            `A first payment of ${formatMoney(from)} or more to a payee added ${age} day(s) ago is reviewed.`,
            { amount: facts.amount, from, payeeAgeDays: age },
          ),
        );
      }
    }
  }
  if (on(book, "aml.structuring")) {
    const count = structuringCount(
      book,
      [...facts.recentOutgoing, { at: facts.now, amount: facts.amount }],
      facts.now,
    );
    const needed = num(book, "aml.structuring", "count");
    if (count >= needed) {
      findings.push(
        finding(
          book,
          "aml.structuring",
          "alert",
          `${count} movements just under ${formatMoney(num(book, "aml.structuring", "threshold"))} in ${num(book, "aml.structuring", "days")} day(s).`,
          { count, needed },
        ),
      );
    }
  }

  return {
    findings,
    refusal: findings.find((item) => item.outcome === "refuse") ?? null,
    approval: findings.find((item) => item.outcome === "approval") ?? null,
    holds: findings.filter((item) => item.outcome === "hold"),
    alerts: findings.filter((item) => item.outcome === "alert"),
    fee: feeFor(book, facts.kind),
  };
}

/** Structuring on money coming in: an Alert for the record, never a hold. */
export function checkIncoming(
  book: Rulebook,
  facts: {
    amount: number;
    recentIncoming: { at: string; amount: number }[];
    now: string;
  },
): Finding[] {
  if (!on(book, "aml.structuring")) return [];
  const count = structuringCount(
    book,
    [...facts.recentIncoming, { at: facts.now, amount: facts.amount }],
    facts.now,
  );
  const needed = num(book, "aml.structuring", "count");
  return count >= needed
    ? [
        finding(
          book,
          "aml.structuring",
          "alert",
          `${count} credits just under ${formatMoney(num(book, "aml.structuring", "threshold"))} in ${num(book, "aml.structuring", "days")} day(s).`,
          { count, needed },
        ),
      ]
    : [];
}

/** The day a payment to another bank settles: the rail's cut-off decides. */
export function settlementDate(book: Rulebook, bankNow: Date): BankDate {
  const afterCutOff =
    bankNow.getUTCHours() >= num(book, "clearing.rail", "cutOffHour");
  return addDays(
    dateOf(bankNow),
    num(book, "clearing.rail", "settlementDays") + (afterCutOff ? 1 : 0),
  );
}

/**
 * What the other bank does with a payment. The simulated rail returns a
 * payment by the payee's account number, so a visitor can cause each case:
 * ending 0000 the account is closed, ending 9999 it does not exist.
 */
export function railOutcome(
  accountNumber: string,
): { settled: true } | { settled: false; code: string; reason: string } {
  if (accountNumber.endsWith("0000")) {
    return {
      settled: false,
      code: "AC04",
      reason: "The payee's account is closed",
    };
  }
  if (accountNumber.endsWith("9999")) {
    return {
      settled: false,
      code: "AC01",
      reason: "The payee's account number does not exist",
    };
  }
  return { settled: true };
}

/** When a held payment's review runs out. */
export function reviewDeadline(book: Rulebook, raisedAt: Date): Date {
  return new Date(
    raisedAt.getTime() + num(book, "fraud.review", "hours") * 3_600_000,
  );
}

export const releaseOnTimeout = (book: Rulebook) =>
  bool(book, "fraud.review", "releaseOnTimeout");

// Cards ------------------------------------------------------------------------

export type CardAuthFacts = {
  amount: number;
  channel: "in_store" | "online";
  category: string;
  today: BankDate;
  card: {
    status: "active" | "frozen" | "cancelled";
    perTransactionLimit: number;
    dailyLimit: number;
    expiresOn: BankDate;
    onlineEnabled: boolean;
  };
  account: { status: "open" | "frozen" | "closed"; available: number };
  /** Authorised and settled on this card today, not counting this purchase. */
  spentToday: number;
};

/** ISO 8583-style response codes, as a card network would send them. */
export const DECLINE_REASONS = {
  "05": "Do not honour: the card is cancelled",
  "51": "Insufficient funds",
  "54": "Expired card",
  "57": "Online purchases are switched off for this card",
  "59": "Suspected fraud",
  "61": "Exceeds the card's limit for one purchase",
  "62": "Restricted card: the card is frozen",
  "65": "Exceeds the card's daily limit",
  "78": "The account is not open",
} as const;

export type DeclineCode = keyof typeof DECLINE_REASONS;

export type CardDecision =
  | { approved: true; finding: Finding }
  | { approved: false; code: DeclineCode; reason: string; finding: Finding };

export function checkCardAuth(
  book: Rulebook,
  facts: CardAuthFacts,
): CardDecision {
  const decline = (code: DeclineCode, ruleId: RuleId): CardDecision => ({
    approved: false,
    code,
    reason: DECLINE_REASONS[code],
    finding: finding(book, ruleId, "refuse", DECLINE_REASONS[code], {
      code,
      amount: facts.amount,
    }),
  });
  const { card, account } = facts;
  if (card.status === "cancelled") return decline("05", "cards.limits");
  if (card.status === "frozen") return decline("62", "cards.limits");
  if (card.expiresOn < facts.today) return decline("54", "cards.limits");
  if (account.status !== "open") return decline("78", "cards.limits");
  if (facts.channel === "online" && !card.onlineEnabled) {
    return decline("57", "cards.limits");
  }
  if (
    on(book, "cards.risk") &&
    facts.channel === "online" &&
    facts.amount >= num(book, "cards.risk", "onlineFrom") &&
    words(book, "cards.risk", "categories").includes(
      facts.category.toLowerCase(),
    )
  ) {
    return decline("59", "cards.risk");
  }
  if (facts.amount > card.perTransactionLimit)
    return decline("61", "cards.limits");
  if (facts.spentToday + facts.amount > card.dailyLimit) {
    return decline("65", "cards.limits");
  }
  if (facts.amount > account.available) return decline("51", "cards.limits");
  return {
    approved: true,
    finding: finding(book, "cards.limits", "pass", "Authorised", {
      amount: facts.amount,
      spentToday: facts.spentToday,
    }),
  };
}

/** Why a card's limits may not be set to these, or null. */
export function cardLimitsRefusal(
  book: Rulebook,
  perTransaction: number,
  perDay: number,
): string | null {
  const ceilingOne = num(book, "cards.limits", "ceilingPerTransaction");
  const ceilingDay = num(book, "cards.limits", "ceilingPerDay");
  if (perTransaction > ceilingOne) {
    return `A card may spend at most ${formatMoney(ceilingOne)} at a time.`;
  }
  if (perDay > ceilingDay) {
    return `A card may spend at most ${formatMoney(ceilingDay)} a day.`;
  }
  if (perDay < perTransaction) {
    return "The daily limit cannot be below the limit for one purchase.";
  }
  return null;
}

// Lending ----------------------------------------------------------------------

export type LoanFacts = {
  amount: number;
  termMonths: number;
  monthlyIncome: number;
  monthlyExpenses: number;
  /** What the customer already repays each month on loans with this bank. */
  existingRepayments: number;
  kycStatus: "pending" | "verified" | "rejected";
  risk: "low" | "standard" | "high";
  inArrears: boolean;
  /**
   * The monthly payment to test, when it is already fixed: an offer being
   * accepted keeps the rate and payment it was offered at, whatever the
   * pricing Rule says now. Without it, the payment is priced afresh.
   */
  monthlyPayment?: number;
};

export type LoanDecision = {
  approved: boolean;
  rateBps: number;
  monthlyPayment: number;
  findings: Finding[];
};

export function loanRate(book: Rulebook, risk: LoanFacts["risk"]): number {
  const base = num(book, "lending.pricing", "baseBps");
  if (risk === "high")
    return base + num(book, "lending.pricing", "highRiskBps");
  if (risk === "low") {
    return Math.max(0, base - num(book, "lending.pricing", "lowRiskBps"));
  }
  return base;
}

/** The affordability decision. Every test is reported, passed or failed. */
export function decideLoan(book: Rulebook, facts: LoanFacts): LoanDecision {
  const rule = "lending.affordability" as const;
  const rateBps = loanRate(book, facts.risk);
  const payment =
    facts.monthlyPayment ??
    (facts.termMonths > 0 && facts.amount > 0
      ? monthlyPayment(facts.amount, rateBps, facts.termMonths)
      : 0);
  const findings: Finding[] = [];
  const test = (passed: boolean, message: string, facts_: Finding["facts"]) =>
    findings.push(
      finding(book, rule, passed ? "pass" : "refuse", message, facts_),
    );

  test(
    facts.kycStatus === "verified",
    facts.kycStatus === "verified"
      ? "Identity verified."
      : "A loan needs a verified identity.",
    { kycStatus: facts.kycStatus },
  );
  test(
    !facts.inArrears,
    facts.inArrears
      ? "The customer has a loan in arrears."
      : "No loan in arrears.",
    {
      inArrears: facts.inArrears,
    },
  );
  const minIncome = num(book, rule, "minIncome");
  test(
    facts.monthlyIncome >= minIncome,
    `Monthly income ${formatMoney(facts.monthlyIncome)} against a minimum of ${formatMoney(minIncome)}.`,
    { monthlyIncome: facts.monthlyIncome, minIncome },
  );
  const maxAmount = num(book, rule, "maxAmount");
  test(
    facts.amount <= maxAmount,
    `Asked for ${formatMoney(facts.amount)}; the largest loan is ${formatMoney(maxAmount)}.`,
    { amount: facts.amount, maxAmount },
  );
  const byIncome = facts.monthlyIncome * num(book, rule, "maxIncomeMultiple");
  test(
    facts.amount <= byIncome,
    `Asked for ${formatMoney(facts.amount)}; ${num(book, rule, "maxIncomeMultiple")} times income is ${formatMoney(byIncome)}.`,
    { amount: facts.amount, byIncome },
  );
  const maxTerm = num(book, rule, "maxTermMonths");
  test(
    facts.termMonths >= 1 && facts.termMonths <= maxTerm,
    `Term of ${facts.termMonths} months; the longest is ${maxTerm}.`,
    { termMonths: facts.termMonths, maxTerm },
  );
  const repayments = facts.existingRepayments + payment;
  const dtiCap = Math.floor(
    (facts.monthlyIncome * num(book, rule, "maxDtiPercent")) / 100,
  );
  test(
    repayments <= dtiCap,
    `Repayments of ${formatMoney(repayments)} a month against a cap of ${formatMoney(dtiCap)} (${num(book, rule, "maxDtiPercent")}% of income).`,
    { repayments, dtiCap },
  );
  const leftOver = facts.monthlyIncome - facts.monthlyExpenses - repayments;
  const minLeftOver = num(book, rule, "minLeftOver");
  test(
    leftOver >= minLeftOver,
    `${formatMoney(leftOver)} left over each month; at least ${formatMoney(minLeftOver)} is needed.`,
    { leftOver, minLeftOver },
  );

  return {
    approved: findings.every((item) => item.outcome === "pass"),
    rateBps,
    monthlyPayment: payment,
    findings,
  };
}

// Deposits ---------------------------------------------------------------------

export const TERM_MONTHS = [3, 6, 12] as const;
export type TermMonths = (typeof TERM_MONTHS)[number];

export function termRate(book: Rulebook, months: TermMonths): number {
  return num(book, "interest.term", `rateBps${months}`);
}

export function termRefusal(book: Rulebook, amount: number): string | null {
  const minimum = num(book, "interest.term", "minimum");
  return amount < minimum
    ? `A term deposit needs at least ${formatMoney(minimum)}.`
    : null;
}

export const savingsRate = (book: Rulebook) =>
  on(book, "interest.savings") ? num(book, "interest.savings", "rateBps") : 0;

// Growth -----------------------------------------------------------------------

/**
 * The code half of triage: refuses a request that names a blocked topic or a
 * kind the bank does not accept. The request's text is untrusted data.
 */
export function checkGrowthRequest(
  book: Rulebook,
  request: {
    kind: "feature" | "bug";
    title: string;
    want: string;
    evidence: string;
  },
): Finding[] {
  const rule = "growth.intake" as const;
  const findings: Finding[] = [];
  if (request.kind === "bug" && !bool(book, rule, "bugs")) {
    findings.push(
      finding(book, rule, "refuse", "Bug reports are not accepted right now."),
    );
  }
  const text =
    `${request.title}\n${request.want}\n${request.evidence}`.toLowerCase();
  const hit = words(book, rule, "blocked").find((word) =>
    new RegExp(
      `(^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`,
    ).test(text),
  );
  if (hit) {
    findings.push(
      finding(
        book,
        rule,
        "refuse",
        `The request mentions "${hit}", which the bank may not change.`,
        {
          blocked: hit,
        },
      ),
    );
  }
  return findings;
}
