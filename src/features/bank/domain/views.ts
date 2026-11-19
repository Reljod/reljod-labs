import type { Finding } from "./checks";
import type { BankDate } from "./dates";
import type { ResolvedRule, RuleVersion } from "./rules";
import type { Role, Staff } from "./staff";

/**
 * What the reads return: the shapes the screen, the Teller and outside MCP
 * clients all see. Amounts are minor units; dates are "YYYY-MM-DD" bank
 * dates; instants are ISO strings.
 */

export type AccountKind = "current" | "savings" | "term" | "loan" | "gl";
export type AccountStatus = "open" | "frozen" | "closed";
export type KycStatus = "pending" | "verified" | "rejected";

export type OverviewView = {
  bankName: string;
  /** The simulated clock, ISO. */
  bankNow: string;
  bankDate: BankDate;
  /** The last date whose end-of-day finished. */
  eodThrough: BankDate | null;
  /** How far the simulated clock runs ahead of the real one, in whole days. */
  daysAhead: number;
  customers: number;
  accounts: number;
  deposits: number;
  loansOutstanding: number;
  openAlerts: number;
  pendingApprovals: number;
  pendingConfirmations: number;
  unreadNotifications: number;
  activeWorkflows: number;
  outboxDepth: number;
};

export type CustomerSummary = {
  id: string;
  number: string;
  name: string;
  email: string;
  occupation: string;
  kycStatus: KycStatus;
  risk: "low" | "standard" | "high";
  accounts: number;
  /** Posted balance across their deposit accounts. */
  deposits: number;
  isSeed: boolean;
  createdAt: string;
};

export type AccountView = {
  id: string;
  customerId: string | null;
  customerName: string | null;
  number: string;
  kind: AccountKind;
  name: string;
  status: AccountStatus;
  /** Posted balance in the account's own sense: what the customer has, or owes on a loan. */
  balance: number;
  held: number;
  /** What may be spent now: balance, less holds, plus the overdraft limit. */
  available: number;
  overdraftLimit: number;
  rateBps: number;
  interestAccrued: number;
  termMonths: number | null;
  maturesOn: BankDate | null;
  openedOn: BankDate;
  closedOn: BankDate | null;
};

export type HoldView = {
  id: string;
  accountId: string;
  amount: number;
  kind: "card" | "review" | "approval";
  ref: string;
  status: "active" | "captured" | "released" | "expired";
  placedOn: BankDate;
  expiresOn: BankDate | null;
};

export type TransactionView = {
  /** The posting's id: the cursor for "older". */
  id: number;
  entryId: number;
  date: BankDate;
  at: string;
  kind: string;
  description: string;
  direction: "in" | "out";
  amount: number;
  balanceAfter: number;
  disputed: boolean;
};

export type PayeeView = {
  id: string;
  customerId: string;
  name: string;
  kind: "person" | "biller";
  bankCode: string;
  accountNumber: string;
  reference: string;
  firstPaidOn: BankDate | null;
  createdOn: BankDate;
};

export type StandingOrderView = {
  id: string;
  fromAccountId: string;
  fromNumber: string;
  to: string;
  amount: number;
  frequency: "once" | "weekly" | "monthly";
  nextRunOn: BankDate;
  endsOn: BankDate | null;
  reference: string;
  status: "active" | "ended" | "cancelled";
  runs: number;
  lastResult: string;
};

export type PaymentStatus =
  | "held"
  | "clearing"
  | "settled"
  | "returned"
  | "rejected"
  | "reversed";

export type PaymentView = {
  id: string;
  kind: "internal" | "external" | "bill" | "incoming";
  fromAccountId: string | null;
  fromNumber: string | null;
  toAccountId: string | null;
  toNumber: string | null;
  counterparty: string;
  amount: number;
  fee: number;
  reference: string;
  status: PaymentStatus;
  statusReason: string;
  submittedOn: BankDate;
  settlesOn: BankDate | null;
  settledOn: BankDate | null;
  entryId: number | null;
  via: string;
  createdAt: string;
};

export type CardView = {
  id: string;
  customerId: string;
  accountId: string;
  accountNumber: string;
  lastFour: string;
  nameOnCard: string;
  expiresOn: BankDate;
  status: "active" | "frozen" | "cancelled";
  perTransactionLimit: number;
  dailyLimit: number;
  onlineEnabled: boolean;
  issuedOn: BankDate;
};

export type CardAuthView = {
  id: string;
  cardId: string;
  merchant: string;
  category: string;
  channel: "in_store" | "online";
  amount: number;
  status: "authorised" | "declined" | "settled" | "reversed" | "expired";
  declineCode: string | null;
  declineReason: string | null;
  authorisedOn: BankDate;
  settledOn: BankDate | null;
  createdAt: string;
};

export type LoanStatus =
  | "declined"
  | "offered"
  | "accepted"
  | "active"
  | "arrears"
  | "closed"
  | "withdrawn";

export type LoanView = {
  id: string;
  customerId: string;
  customerName: string;
  number: string;
  purpose: string;
  principal: number;
  rateBps: number;
  termMonths: number;
  monthlyPayment: number;
  status: LoanStatus;
  /** What is still owed (the loan account's balance), 0 before disbursement. */
  outstanding: number;
  arrears: number;
  disburseAccountId: string;
  appliedOn: BankDate;
  disbursedOn: BankDate | null;
  nextDueOn: BankDate | null;
};

export type InstalmentView = {
  n: number;
  dueOn: BankDate;
  principal: number;
  interest: number;
  payment: number;
  balanceAfter: number;
  status: "due" | "paid" | "missed";
  paidOn: BankDate | null;
};

export type LoanDetail = LoanView & {
  declaredIncome: number;
  declaredExpenses: number;
  decision: { approved: boolean; findings: Finding[] };
  schedule: InstalmentView[];
};

export type CustomerDetail = {
  customer: CustomerSummary & {
    phone: string;
    address: string;
    dateOfBirth: BankDate | null;
    monthlyIncome: number;
    kycNote: string;
  };
  accounts: AccountView[];
  cards: CardView[];
  loans: LoanView[];
  payees: PayeeView[];
  standingOrders: StandingOrderView[];
};

export type AccountDetail = {
  account: AccountView;
  holds: HoldView[];
  transactions: TransactionView[];
  cards: CardView[];
};

export type SpendingSummary = {
  accountId: string;
  months: {
    month: string;
    moneyIn: number;
    moneyOut: number;
    byKind: Record<string, number>;
  }[];
};

export type NotificationView = {
  id: string;
  customerId: string | null;
  customerName: string | null;
  kind: string;
  title: string;
  body: string;
  delivered: string[];
  readAt: string | null;
  bankTime: string;
};

export type StatementLine = {
  date: BankDate;
  description: string;
  moneyIn: number;
  moneyOut: number;
  balance: number;
};

export type StatementBody = {
  bankName: string;
  customerName: string;
  customerAddress: string;
  accountNumber: string;
  accountName: string;
  periodStart: BankDate;
  periodEnd: BankDate;
  openingBalance: number;
  closingBalance: number;
  totalIn: number;
  totalOut: number;
  lines: StatementLine[];
};

export type StatementSummary = {
  id: string;
  accountId: string;
  periodStart: BankDate;
  periodEnd: BankDate;
  closingBalance: number;
  createdAt: string;
};

export type StatementView = StatementSummary & { body: StatementBody };

export type DisputeView = {
  id: string;
  customerId: string;
  customerName: string;
  accountId: string;
  accountNumber: string;
  entryId: number;
  amount: number;
  reason: string;
  detail: string;
  status: "open" | "upheld" | "rejected";
  resolutionNote: string;
  openedOn: BankDate;
  resolvedOn: BankDate | null;
};

export type TrialBalanceRow = {
  accountId: string;
  number: string;
  name: string;
  kind: AccountKind;
  /** asset, liability, equity, income or expense. */
  section: string;
  debits: number;
  credits: number;
  /** Net in the account's normal sense. */
  balance: number;
};

export type TrialBalanceView = {
  rows: TrialBalanceRow[];
  totalDebits: number;
  totalCredits: number;
  balanced: boolean;
  /** Mismatches between the materialised balances and the postings. Empty when reconciled. */
  reconciliation: {
    number: string;
    problem: string;
    materialised: number;
    ledger: number;
  }[];
  entries: number;
  postings: number;
};

export type LedgerEntryView = {
  id: number;
  date: BankDate;
  at: string;
  kind: string;
  description: string;
  via: string;
  reversesEntryId: number | null;
  postings: {
    accountId: string;
    number: string;
    name: string;
    direction: "D" | "C";
    amount: number;
  }[];
};

export type WorkflowRunView = {
  id: string;
  kind: string;
  subject: string;
  status:
    | "running"
    | "sleeping"
    | "waiting"
    | "completed"
    | "failed"
    | "cancelled";
  wakeAt: string | null;
  steps: { name: string; at: string; note: string }[];
  detail: string;
  startedAt: string;
  endedAt: string | null;
};

export type OperationsView = {
  outbox: {
    pending: number;
    dispatched: number;
    done: number;
    failed: number;
    byTopic: { topic: string; waiting: number; done: number }[];
    recent: {
      id: number;
      topic: string;
      status: string;
      attempts: number;
      createdAt: string;
    }[];
  };
  workflows: WorkflowRunView[];
  holds: (HoldView & { accountNumber: string })[];
  clearing: PaymentView[];
};

export type AlertView = {
  id: string;
  customerId: string | null;
  customerName: string | null;
  accountNumber: string | null;
  paymentId: string | null;
  payment: Pick<
    PaymentView,
    "amount" | "counterparty" | "status" | "kind"
  > | null;
  severity: "low" | "medium" | "high";
  holding: boolean;
  findings: Finding[];
  summary: string;
  status: "open" | "released" | "rejected" | "timed_out" | "noted";
  decidedByName: string | null;
  decisionNote: string;
  raisedAt: string;
  reviewBy: string | null;
  decidedAt: string | null;
};

export type ApprovalView = {
  id: string;
  command: string;
  commandTitle: string;
  summary: string;
  reason: string;
  amount: number | null;
  requestedBy: string;
  requestedByName: string;
  requestedVia: string;
  status: "pending" | "approved" | "rejected" | "expired" | "failed";
  decidedByName: string | null;
  decisionNote: string;
  createdAt: string;
  decidedAt: string | null;
};

export type ConfirmationView = {
  id: string;
  command: string;
  commandTitle: string;
  summary: string;
  requestedVia: string;
  staffId: string;
  sessionId: string | null;
  status: "pending" | "confirmed" | "declined" | "expired" | "failed";
  resultMessage: string | null;
  createdAt: string;
  expiresAt: string;
};

export type AuditEventView = {
  id: number;
  actorKind: "staff" | "teller" | "client" | "system";
  actorLabel: string;
  via: string;
  action: string;
  targetKind: string | null;
  targetId: string | null;
  summary: string;
  detail: Record<string, unknown>;
  sessionId: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  bankTime: string;
  createdAt: string;
};

export type AuditPage = {
  events: AuditEventView[];
  nextBeforeId: number | null;
};

export type RulesView = { rules: ResolvedRule[] };
export type RuleHistoryView = { ruleId: string; versions: RuleVersion[] };

export type GrowthStatus =
  | "requested"
  | "triaged"
  | "refused"
  | "duplicate"
  | "issue"
  | "pr"
  | "merged"
  | "live"
  | "closed";

export type GrowthRequestView = {
  id: string;
  kind: "feature" | "bug";
  title: string;
  want: string;
  status: GrowthStatus;
  statusNote: string;
  issueNumber: number | null;
  issueUrl: string | null;
  prNumber: number | null;
  prUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

/** One thing the bank learned: a ring in its growth rings. */
export type ChangelogEntry = {
  id: string;
  title: string;
  kind: "feature" | "bug" | "founding";
  learnedAt: string;
  issueNumber: number | null;
  prNumber: number | null;
  prUrl: string | null;
  /** Whether this Owner asked for it. */
  mine: boolean;
};

export type GrowthView = {
  requests: GrowthRequestView[];
  changelog: ChangelogEntry[];
  /** Whether issues can be filed: false means the server has no GitHub token. */
  githubReady: boolean;
  repo: string;
};

export type BankView = {
  overview: OverviewView;
  staff: Staff[];
  activeStaffId: string;
};

export type { Finding, Role, Staff };
