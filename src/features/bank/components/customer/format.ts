import type {
  AccountStatus,
  AccountView,
  CardAuthView,
  CardView,
  DisputeView,
  InstalmentView,
  KycStatus,
  LoanStatus,
  PaymentStatus,
  StandingOrderView,
} from "../../domain/views";
import type { Tone } from "../ui";

/** Words and tones the Customer view shows for each state. */

export const rate = (bps: number) => `${(bps / 100).toFixed(2)}%`;

export const ACCOUNT_KIND_LABEL: Record<AccountView["kind"], string> = {
  current: "Current",
  savings: "Savings",
  term: "Term deposit",
  loan: "Loan",
  gl: "Ledger",
};

export const ACCOUNT_TONE: Record<AccountStatus, Tone> = {
  open: "green",
  frozen: "amber",
  closed: "neutral",
};

export const KYC_TONE: Record<KycStatus, Tone> = {
  verified: "green",
  pending: "amber",
  rejected: "red",
};

export const KYC_LABEL: Record<KycStatus, string> = {
  verified: "KYC verified",
  pending: "KYC pending",
  rejected: "KYC rejected",
};

export const RISK_TONE = {
  low: "neutral",
  standard: "neutral",
  high: "red",
} as const;

export const PAYMENT_TONE: Record<PaymentStatus, Tone> = {
  held: "amber",
  clearing: "blue",
  settled: "green",
  returned: "red",
  rejected: "red",
  reversed: "neutral",
};

export const PAYMENT_KIND_LABEL: Record<string, string> = {
  internal: "Transfer",
  external: "To a payee",
  bill: "Bill",
  incoming: "Credit in",
};

export const CARD_TONE: Record<CardView["status"], Tone> = {
  active: "green",
  frozen: "amber",
  cancelled: "neutral",
};

export const AUTH_TONE: Record<CardAuthView["status"], Tone> = {
  authorised: "blue",
  settled: "green",
  declined: "red",
  reversed: "neutral",
  expired: "neutral",
};

export const LOAN_TONE: Record<LoanStatus, Tone> = {
  declined: "red",
  offered: "blue",
  accepted: "blue",
  active: "green",
  arrears: "red",
  closed: "neutral",
  withdrawn: "neutral",
};

export const DISPUTE_TONE: Record<DisputeView["status"], Tone> = {
  open: "amber",
  upheld: "green",
  rejected: "neutral",
};

export const ORDER_TONE: Record<StandingOrderView["status"], Tone> = {
  active: "green",
  ended: "neutral",
  cancelled: "neutral",
};

export const INSTALMENT_TONE: Record<InstalmentView["status"], Tone> = {
  due: "neutral",
  paid: "green",
  missed: "red",
};

export const DISPUTE_REASONS = [
  { id: "not_recognised", label: "I don't recognise it" },
  { id: "duplicate", label: "Charged twice" },
  { id: "wrong_amount", label: "Wrong amount" },
  { id: "not_received", label: "Goods or service not received" },
  { id: "other", label: "Something else" },
] as const;

export type DisputeReason = (typeof DISPUTE_REASONS)[number]["id"];

export const disputeReasonLabel = (id: string) =>
  DISPUTE_REASONS.find((reason) => reason.id === id)?.label ??
  id.replace(/_/g, " ");

export const CARD_CATEGORIES = [
  "groceries",
  "transport",
  "dining",
  "retail",
  "travel",
  "utilities",
  "gambling",
  "crypto",
  "wire",
] as const;

export type CardCategory = (typeof CARD_CATEGORIES)[number];

/** "MM/YY" for a card's expiry date. */
export const cardExpiry = (date: string) =>
  `${date.slice(5, 7)}/${date.slice(2, 4)}`;

/** "19 Nov 2026, 14:05" for a bank time instant. */
export function formatBankTime(iso: string): string {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return iso;
  const month = value.toLocaleString("en-GB", {
    month: "short",
    timeZone: "UTC",
  });
  const time = value.toISOString().slice(11, 16);
  return `${value.getUTCDate()} ${month} ${value.getUTCFullYear()}, ${time}`;
}

/** Deposit accounts money may leave: open current and savings accounts. */
export const spendable = (accounts: AccountView[]) =>
  accounts.filter(
    (account) =>
      account.status === "open" &&
      (account.kind === "current" || account.kind === "savings"),
  );
