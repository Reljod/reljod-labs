import { formatMoney } from "./money";

/**
 * Rules are data, checks are code (ADR 0015). A Rule here is a sentence with
 * Parameters and a Default; an edit is a new Version saved for the Owner
 * (`bank.rule_versions`). The checks that apply them are pure functions in
 * `checks.ts`: only code returns a Finding or a decision.
 */

export type ParamKind =
  | "money"
  | "count"
  | "percent"
  | "bps"
  | "hours"
  | "days"
  | "hour"
  | "months"
  | "flag"
  | "words";

export type ParamDef = {
  key: string;
  label: string;
  kind: ParamKind;
  min?: number;
  max?: number;
  help?: string;
};

export type RuleGroup =
  | "Limits"
  | "Maker-checker"
  | "Fees"
  | "Interest"
  | "Clearing"
  | "Cards"
  | "Fraud and AML"
  | "Lending"
  | "Growth";

export type ParamValue = number | boolean | string[];
export type Params = Record<string, ParamValue>;

export type RuleDef = {
  id: string;
  group: RuleGroup;
  title: string;
  /** What the Rule says, with its current Parameters filled in. */
  sentence: (params: Params) => string;
  params: ParamDef[];
  defaults: Params;
  /** A Rule the bank cannot run without may not be switched off. */
  required?: boolean;
};

const n = (params: Params, key: string) => Number(params[key] ?? 0);
const money = (params: Params, key: string) => formatMoney(n(params, key));
const flag = (params: Params, key: string) => params[key] === true;

export const RULES = [
  {
    id: "limits.payments",
    group: "Limits",
    title: "Payment limits",
    sentence: (p) =>
      `One payment may not exceed ${money(p, "perPayment")}, and an account may not send more than ${money(p, "perDay")} in a bank day.`,
    params: [
      {
        key: "perPayment",
        label: "Most in one payment",
        kind: "money",
        min: 100,
        max: 100_000_000_00,
      },
      {
        key: "perDay",
        label: "Most an account sends in a day",
        kind: "money",
        min: 100,
        max: 500_000_000_00,
      },
    ],
    defaults: { perPayment: 50_000_00, perDay: 100_000_00 },
    required: true,
  },
  {
    id: "limits.kyc",
    group: "Limits",
    title: "Unverified customers",
    sentence: (p) =>
      `A customer whose identity is not yet verified may send at most ${money(p, "pendingPerDay")} a day, and ${flag(p, "pendingMayBorrow") ? "may" : "may not"} borrow or hold a card.`,
    params: [
      {
        key: "pendingPerDay",
        label: "Daily cap before verification",
        kind: "money",
        min: 0,
        max: 10_000_00,
      },
      {
        key: "pendingMayBorrow",
        label: "May borrow or hold a card before verification",
        kind: "flag",
      },
    ],
    defaults: { pendingPerDay: 500_00, pendingMayBorrow: false },
  },
  {
    id: "approval.threshold",
    group: "Maker-checker",
    title: "Second pair of eyes",
    sentence: (p) =>
      `A payment of ${money(p, "paymentsFrom")} or more waits for a supervisor who did not make it${flag(p, "reversals") ? "; so does every reversal" : ""}${flag(p, "overdrafts") ? " and every overdraft limit" : ""}.`,
    params: [
      {
        key: "paymentsFrom",
        label: "Payments from this amount",
        kind: "money",
        min: 1_00,
        max: 100_000_000_00,
      },
      { key: "reversals", label: "Reversals need an Approval", kind: "flag" },
      {
        key: "overdrafts",
        label: "Overdraft limits need an Approval",
        kind: "flag",
      },
    ],
    defaults: { paymentsFrom: 10_000_00, reversals: true, overdrafts: true },
    required: true,
  },
  {
    id: "fees.payments",
    group: "Fees",
    title: "Payment fees",
    sentence: (p) =>
      `A payment to another bank costs ${money(p, "external")}; a bill payment costs ${money(p, "bill")}; a returned payment costs ${money(p, "returned")}.`,
    params: [
      {
        key: "external",
        label: "Payment to another bank",
        kind: "money",
        min: 0,
        max: 100_00,
      },
      {
        key: "bill",
        label: "Bill payment",
        kind: "money",
        min: 0,
        max: 100_00,
      },
      {
        key: "returned",
        label: "Returned payment",
        kind: "money",
        min: 0,
        max: 100_00,
      },
    ],
    defaults: { external: 1_50, bill: 0, returned: 5_00 },
  },
  {
    id: "fees.lending",
    group: "Fees",
    title: "Late repayment fee",
    sentence: (p) =>
      `A missed loan instalment costs ${money(p, "late")}, charged once when it is missed.`,
    params: [
      { key: "late", label: "Late fee", kind: "money", min: 0, max: 500_00 },
    ],
    defaults: { late: 15_00 },
  },
  {
    id: "interest.savings",
    group: "Interest",
    title: "Savings interest",
    sentence: (p) =>
      `Savings earn ${(n(p, "rateBps") / 100).toFixed(2)}% a year, accrued every day on the closing balance and paid on the last day of the month.`,
    params: [
      { key: "rateBps", label: "Yearly rate", kind: "bps", min: 0, max: 2_000 },
    ],
    defaults: { rateBps: 325 },
  },
  {
    id: "interest.term",
    group: "Interest",
    title: "Term deposit interest",
    sentence: (p) =>
      `A term deposit earns ${(n(p, "rateBps3") / 100).toFixed(2)}% for 3 months, ${(n(p, "rateBps6") / 100).toFixed(2)}% for 6 and ${(n(p, "rateBps12") / 100).toFixed(2)}% for 12, paid at maturity. The least to open one is ${money(p, "minimum")}.`,
    params: [
      { key: "rateBps3", label: "3 months", kind: "bps", min: 0, max: 2_000 },
      { key: "rateBps6", label: "6 months", kind: "bps", min: 0, max: 2_000 },
      { key: "rateBps12", label: "12 months", kind: "bps", min: 0, max: 2_000 },
      {
        key: "minimum",
        label: "Least to open",
        kind: "money",
        min: 1_00,
        max: 1_000_000_00,
      },
    ],
    defaults: { rateBps3: 380, rateBps6: 420, rateBps12: 475, minimum: 500_00 },
  },
  {
    id: "clearing.rail",
    group: "Clearing",
    title: "The clearing rail",
    sentence: (p) =>
      `A payment to another bank sent before ${String(n(p, "cutOffHour")).padStart(2, "0")}:00 settles ${n(p, "settlementDays")} bank day(s) later; after the cut-off it waits one more day. The other bank may return it until it settles.`,
    params: [
      {
        key: "cutOffHour",
        label: "Cut-off hour",
        kind: "hour",
        min: 0,
        max: 23,
      },
      {
        key: "settlementDays",
        label: "Days to settle",
        kind: "days",
        min: 1,
        max: 5,
      },
    ],
    defaults: { cutOffHour: 16, settlementDays: 1 },
    required: true,
  },
  {
    id: "cards.limits",
    group: "Cards",
    title: "Card limits",
    sentence: (p) =>
      `A new debit card may spend ${money(p, "perTransaction")} at a time and ${money(p, "perDay")} a day; nobody may raise them above ${money(p, "ceilingPerTransaction")} and ${money(p, "ceilingPerDay")}. An authorisation not settled within ${n(p, "authDays")} day(s) expires and frees its hold.`,
    params: [
      {
        key: "perTransaction",
        label: "New card, one purchase",
        kind: "money",
        min: 1_00,
        max: 100_000_00,
      },
      {
        key: "perDay",
        label: "New card, a day",
        kind: "money",
        min: 1_00,
        max: 500_000_00,
      },
      {
        key: "ceilingPerTransaction",
        label: "Ceiling, one purchase",
        kind: "money",
        min: 1_00,
        max: 100_000_00,
      },
      {
        key: "ceilingPerDay",
        label: "Ceiling, a day",
        kind: "money",
        min: 1_00,
        max: 500_000_00,
      },
      {
        key: "authDays",
        label: "Days an authorisation lives",
        kind: "days",
        min: 1,
        max: 30,
      },
    ],
    defaults: {
      perTransaction: 1_000_00,
      perDay: 2_500_00,
      ceilingPerTransaction: 10_000_00,
      ceilingPerDay: 25_000_00,
      authDays: 7,
    },
    required: true,
  },
  {
    id: "cards.risk",
    group: "Cards",
    title: "Risky card purchases",
    sentence: (p) =>
      `An online purchase of ${money(p, "onlineFrom")} or more at a merchant in a watched category (${(p.categories as string[]).join(", ")}) is declined as suspected fraud.`,
    params: [
      {
        key: "onlineFrom",
        label: "Online purchases from",
        kind: "money",
        min: 1_00,
        max: 100_000_00,
      },
      { key: "categories", label: "Watched categories", kind: "words" },
    ],
    defaults: {
      onlineFrom: 800_00,
      categories: ["gambling", "crypto", "wire"],
    },
  },
  {
    id: "fraud.amount",
    group: "Fraud and AML",
    title: "Large payments",
    sentence: (p) =>
      `A payment to another bank of ${money(p, "holdFrom")} or more is held for review before it leaves.`,
    params: [
      {
        key: "holdFrom",
        label: "Hold from",
        kind: "money",
        min: 1_00,
        max: 100_000_000_00,
      },
    ],
    defaults: { holdFrom: 25_000_00 },
  },
  {
    id: "fraud.velocity",
    group: "Fraud and AML",
    title: "Too many payments, too fast",
    sentence: (p) =>
      `More than ${n(p, "count")} payments out of one account within ${n(p, "hours")} hour(s) holds the next one for review.`,
    params: [
      { key: "count", label: "Payments", kind: "count", min: 1, max: 100 },
      { key: "hours", label: "Within hours", kind: "hours", min: 1, max: 72 },
    ],
    defaults: { count: 5, hours: 1 },
  },
  {
    id: "fraud.new_payee",
    group: "Fraud and AML",
    title: "First payment to a new payee",
    sentence: (p) =>
      `A first payment of ${money(p, "from")} or more to a payee added in the last ${n(p, "days")} day(s) is held for review.`,
    params: [
      {
        key: "from",
        label: "First payment from",
        kind: "money",
        min: 1_00,
        max: 100_000_000_00,
      },
      {
        key: "days",
        label: "Payee added within days",
        kind: "days",
        min: 0,
        max: 30,
      },
    ],
    defaults: { from: 2_000_00, days: 2 },
  },
  {
    id: "aml.structuring",
    group: "Fraud and AML",
    title: "Structuring",
    sentence: (p) =>
      `${n(p, "count")} or more movements each just under ${money(p, "threshold")} (within ${n(p, "bandPercent")}% below it) on one account in ${n(p, "days")} day(s) raise an Alert for the record.`,
    params: [
      {
        key: "threshold",
        label: "Reporting threshold",
        kind: "money",
        min: 100_00,
        max: 100_000_000_00,
      },
      {
        key: "bandPercent",
        label: "Just under, within",
        kind: "percent",
        min: 1,
        max: 50,
      },
      { key: "count", label: "Movements", kind: "count", min: 2, max: 20 },
      { key: "days", label: "Within days", kind: "days", min: 1, max: 30 },
    ],
    defaults: { threshold: 10_000_00, bandPercent: 10, count: 3, days: 3 },
  },
  {
    id: "fraud.review",
    group: "Fraud and AML",
    title: "Review deadline",
    sentence: (p) =>
      `A held payment nobody decides within ${n(p, "hours")} hours is ${flag(p, "releaseOnTimeout") ? "released" : "rejected and its money freed"}.`,
    params: [
      {
        key: "hours",
        label: "Hours to decide",
        kind: "hours",
        min: 1,
        max: 240,
      },
      {
        key: "releaseOnTimeout",
        label: "Release (not reject) when nobody decides",
        kind: "flag",
      },
    ],
    defaults: { hours: 24, releaseOnTimeout: false },
    required: true,
  },
  {
    id: "lending.affordability",
    group: "Lending",
    title: "Affordability",
    sentence: (p) =>
      `A loan is offered only to a verified customer earning at least ${money(p, "minIncome")} a month, for no more than ${money(p, "maxAmount")}, ${n(p, "maxIncomeMultiple")} times their monthly income and ${n(p, "maxTermMonths")} months, and only if every loan repayment together stays within ${n(p, "maxDtiPercent")}% of income and leaves ${money(p, "minLeftOver")} after declared expenses.`,
    params: [
      {
        key: "minIncome",
        label: "Least monthly income",
        kind: "money",
        min: 0,
        max: 100_000_00,
      },
      {
        key: "maxAmount",
        label: "Largest loan",
        kind: "money",
        min: 100_00,
        max: 10_000_000_00,
      },
      {
        key: "maxIncomeMultiple",
        label: "Times monthly income",
        kind: "count",
        min: 1,
        max: 60,
      },
      {
        key: "maxTermMonths",
        label: "Longest term (months)",
        kind: "months",
        min: 1,
        max: 120,
      },
      {
        key: "maxDtiPercent",
        label: "Repayments within % of income",
        kind: "percent",
        min: 5,
        max: 80,
      },
      {
        key: "minLeftOver",
        label: "Left over each month",
        kind: "money",
        min: 0,
        max: 100_000_00,
      },
    ],
    defaults: {
      minIncome: 1_200_00,
      maxAmount: 60_000_00,
      maxIncomeMultiple: 12,
      maxTermMonths: 60,
      maxDtiPercent: 35,
      minLeftOver: 300_00,
    },
    required: true,
  },
  {
    id: "lending.pricing",
    group: "Lending",
    title: "Loan pricing",
    sentence: (p) =>
      `A loan costs ${(n(p, "baseBps") / 100).toFixed(2)}% a year, plus ${(n(p, "highRiskBps") / 100).toFixed(2)}% for a high-risk customer and less ${(n(p, "lowRiskBps") / 100).toFixed(2)}% for a low-risk one.`,
    params: [
      {
        key: "baseBps",
        label: "Base yearly rate",
        kind: "bps",
        min: 0,
        max: 4_000,
      },
      {
        key: "highRiskBps",
        label: "Added for high risk",
        kind: "bps",
        min: 0,
        max: 1_000,
      },
      {
        key: "lowRiskBps",
        label: "Taken off for low risk",
        kind: "bps",
        min: 0,
        max: 1_000,
      },
    ],
    defaults: { baseBps: 890, highRiskBps: 300, lowRiskBps: 100 },
    required: true,
  },
  {
    id: "growth.intake",
    group: "Growth",
    title: "What the bank may learn",
    sentence: (p) =>
      `A request to grow the bank is filed only if it is about this bank demo and mentions none of: ${(p.blocked as string[]).join(", ")}. ${flag(p, "bugs") ? "Bugs" : "Only features"}${flag(p, "bugs") ? " and features are" : " are"} accepted.`,
    params: [
      { key: "blocked", label: "Blocked topics", kind: "words" },
      { key: "bugs", label: "Accept bug reports", kind: "flag" },
    ],
    defaults: {
      blocked: [
        "password",
        "secret",
        "token",
        "api key",
        "credential",
        "auth",
        "login",
        "env",
        "ci",
        "workflow file",
        "github action",
        "other demo",
        "harness",
        "sieve",
        "casework",
        "ignore previous",
        "system prompt",
      ],
      bugs: true,
    },
    required: true,
  },
] as const satisfies readonly RuleDef[];

export type RuleId = (typeof RULES)[number]["id"];

export const RULE_IDS = RULES.map((rule) => rule.id) as RuleId[];

export function ruleDef(id: string): RuleDef | undefined {
  return (RULES as readonly RuleDef[]).find((rule) => rule.id === id);
}

/** A saved Version of a Rule, as the database row holds it. */
export type RuleVersion = {
  ruleId: string;
  version: number;
  enabled: boolean;
  params: Params;
  note: string;
  staffName: string;
  createdAt: string;
};

/** A Rule as it stands for an Owner: the Default, or their latest Version. */
export type ResolvedRule = {
  id: RuleId;
  group: RuleGroup;
  title: string;
  sentence: string;
  defaultSentence: string;
  enabled: boolean;
  required: boolean;
  version: number;
  params: Params;
  defaults: Params;
  fields: ParamDef[];
  edited: boolean;
};

/** Every Rule as it stands for an Owner. Checks read Parameters only from this. */
export type Rulebook = Record<RuleId, ResolvedRule>;

export type RuleEditError = { field: string; message: string };

/**
 * Checks an edit against the Rule's Parameter definitions and returns the
 * Parameters to save, or the errors, one per field at fault. Unknown keys
 * are dropped; missing ones keep the Default.
 */
export function validateParams(
  def: RuleDef,
  input: Record<string, unknown>,
): { params: Params } | { errors: RuleEditError[] } {
  const errors: RuleEditError[] = [];
  const params: Params = {};
  for (const field of def.params) {
    const raw = input[field.key] ?? def.defaults[field.key];
    if (field.kind === "flag") {
      if (typeof raw !== "boolean") {
        errors.push({
          field: field.key,
          message: `${field.label} is yes or no.`,
        });
      } else params[field.key] = raw;
      continue;
    }
    if (field.kind === "words") {
      const words = Array.isArray(raw)
        ? raw
            .filter((word): word is string => typeof word === "string")
            .map((word) => word.trim().toLowerCase())
            .filter((word) => word.length > 0 && word.length <= 40)
        : null;
      if (!words || words.length > 40) {
        errors.push({
          field: field.key,
          message: `${field.label} is a list of up to 40 short words.`,
        });
      } else params[field.key] = [...new Set(words)];
      continue;
    }
    if (typeof raw !== "number" || !Number.isSafeInteger(raw)) {
      errors.push({
        field: field.key,
        message: `${field.label} must be a whole number.`,
      });
      continue;
    }
    if (field.min !== undefined && raw < field.min) {
      errors.push({
        field: field.key,
        message: `${field.label} cannot be less than ${field.kind === "money" ? formatMoney(field.min) : field.min}.`,
      });
      continue;
    }
    if (field.max !== undefined && raw > field.max) {
      errors.push({
        field: field.key,
        message: `${field.label} cannot be more than ${field.kind === "money" ? formatMoney(field.max) : field.max}.`,
      });
      continue;
    }
    params[field.key] = raw;
  }
  // Rules whose Parameters depend on each other.
  if (
    def.id === "limits.payments" &&
    n(params, "perDay") < n(params, "perPayment")
  ) {
    errors.push({
      field: "perDay",
      message: "The daily limit cannot be below the limit for one payment.",
    });
  }
  if (def.id === "cards.limits") {
    if (n(params, "perTransaction") > n(params, "ceilingPerTransaction")) {
      errors.push({
        field: "perTransaction",
        message: "A new card's limit cannot be above the ceiling.",
      });
    }
    if (n(params, "perDay") > n(params, "ceilingPerDay")) {
      errors.push({
        field: "perDay",
        message: "A new card's daily limit cannot be above the ceiling.",
      });
    }
  }
  return errors.length > 0 ? { errors } : { params };
}

/** The Rulebook an Owner's bank runs on: Defaults overlaid with their latest Versions. */
export function resolveRulebook(
  latest: Pick<RuleVersion, "ruleId" | "version" | "enabled" | "params">[],
): Rulebook {
  const book = {} as Rulebook;
  for (const def of RULES as readonly RuleDef[]) {
    const saved = latest.find((version) => version.ruleId === def.id);
    // A saved Version is re-validated: a Parameter added since keeps its Default.
    const checked = saved ? validateParams(def, saved.params) : null;
    const params =
      checked && "params" in checked ? checked.params : def.defaults;
    book[def.id as RuleId] = {
      id: def.id as RuleId,
      group: def.group,
      title: def.title,
      sentence: def.sentence(params),
      defaultSentence: def.sentence(def.defaults),
      enabled: def.required ? true : (saved?.enabled ?? true),
      required: def.required === true,
      version: saved?.version ?? 0,
      params,
      defaults: def.defaults,
      fields: def.params,
      edited: Boolean(saved),
    };
  }
  return book;
}

/** The Default Rulebook: what a new bank runs on. */
export const DEFAULT_RULEBOOK = resolveRulebook([]);

/** A numeric Parameter of a Rule. */
export function num(book: Rulebook, id: RuleId, key: string): number {
  return Number(book[id].params[key] ?? 0);
}

export function bool(book: Rulebook, id: RuleId, key: string): boolean {
  return book[id].params[key] === true;
}

export function words(book: Rulebook, id: RuleId, key: string): string[] {
  const value = book[id].params[key];
  return Array.isArray(value) ? value : [];
}
