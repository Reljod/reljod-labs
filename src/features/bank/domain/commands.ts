import { z } from "zod";
import { TERM_MONTHS } from "./checks";
import { isBankDate } from "./dates";
import { LIMITS } from "./limits";
import { MAX_AMOUNT } from "./money";
import { isAccountNumber, isBankCode } from "./numbers";
import type { Action } from "./permissions";
import { RULE_IDS } from "./rules";

/**
 * Everything the bank can be asked to do, in one list. The app calls a
 * command through `runCommand` (a server action for writes, a GET route for
 * reads); the MCP server registers one tool per command from this same list
 * and calls the same engine. So the UI and the chat cannot drift apart:
 * `commands.test.ts` fails if a command has no MCP tool.
 *
 * `sensitive` writes asked for by the Teller or an outside MCP client are
 * not run: they wait as a pending confirmation the person clicks in the UI.
 * `humanOnly` commands are never an MCP tool: no tool gives an Approval or
 * confirms its own request.
 */

const id = z.string().uuid();
const amount = z
  .number()
  .int("Amounts are whole minor units (cents)")
  .positive()
  .max(MAX_AMOUNT)
  .describe("Minor units (cents): MRF 12.50 is 1250");
const text = (max: number) => z.string().trim().max(max);
const name = text(80).min(2);
const reference = text(60).optional();
const accountNumberField = z
  .string()
  .trim()
  .transform((value) => value.replace(/\s/g, ""))
  .refine(
    isAccountNumber,
    "That is not a Tidewater account number (check the digits)",
  );
const bankDate = z.string().refine(isBankDate, "Dates are YYYY-MM-DD");
const limit = z.number().int().min(1).max(LIMITS.pageSize).optional();

export type CommandKind = "read" | "write";

export type CommandDef<
  Name extends string = string,
  Schema extends z.ZodType = z.ZodType,
> = {
  name: Name;
  kind: CommandKind;
  title: string;
  /** What the tool does, for the Teller and outside MCP clients. */
  description: string;
  action: Action;
  input: Schema;
  sensitive?: boolean | ((input: never) => boolean);
  humanOnly?: boolean;
};

function command<const Name extends string, Schema extends z.ZodType>(
  def: Omit<CommandDef<Name, Schema>, "sensitive"> & {
    sensitive?: boolean | ((input: z.infer<Schema>) => boolean);
  },
): CommandDef<Name, Schema> {
  return def as CommandDef<Name, Schema>;
}

const read = <const Name extends string, Schema extends z.ZodType>(
  name_: Name,
  title: string,
  description: string,
  input: Schema,
  action: Action = "bank.read",
) => command({ name: name_, kind: "read", title, description, action, input });

export const COMMANDS = [
  // Reads --------------------------------------------------------------------
  read(
    "get_overview",
    "Bank overview",
    "The bank's simulated date and time, totals (deposits, loans), and what is waiting: Alerts, Approvals, confirmations.",
    z.object({}),
  ),
  read(
    "list_customers",
    "List customers",
    "Every customer of this bank with their KYC status and total balance. Optional search by name or customer number.",
    z.object({ search: text(60).optional() }),
  ),
  read(
    "get_customer",
    "Customer file",
    "One customer's profile with their accounts (balances), cards, loans, payees and standing orders.",
    z.object({ customerId: id }),
  ),
  read(
    "get_account",
    "Account",
    "One account: posted and available balance, holds, interest, and its latest transactions.",
    z.object({ accountId: id }),
  ),
  read(
    "list_transactions",
    "Transactions",
    "An account's transactions from the ledger, newest first, each with the running balance and its journal entry id.",
    z.object({
      accountId: id,
      limit,
      beforeId: z.number().int().positive().optional(),
    }),
  ),
  read(
    "spending_summary",
    "Spending summary",
    "Money in and out of an account by month and by kind of transaction, for analysis and charts.",
    z.object({
      accountId: id,
      months: z.number().int().min(1).max(24).optional(),
    }),
  ),
  read(
    "list_payments",
    "Payments",
    "Payments (internal, to another bank, bills, incoming) with their clearing status, newest first.",
    z.object({
      customerId: id.optional(),
      status: z
        .enum([
          "held",
          "clearing",
          "settled",
          "returned",
          "rejected",
          "reversed",
        ])
        .optional(),
      limit,
    }),
  ),
  read(
    "list_card_activity",
    "Card activity",
    "A card's authorisations: authorised, settled, declined (with the decline code), reversed or expired.",
    z.object({ cardId: id, limit }),
  ),
  read(
    "list_loans",
    "Loans",
    "Loans and loan applications, optionally for one customer.",
    z.object({ customerId: id.optional() }),
  ),
  read(
    "get_loan",
    "Loan",
    "One loan: the affordability decision with every Finding, the offer, and the amortisation schedule.",
    z.object({ loanId: id }),
  ),
  read(
    "list_notifications",
    "Notifications",
    "The notification inbox, newest first.",
    z.object({
      customerId: id.optional(),
      unreadOnly: z.boolean().optional(),
      limit,
    }),
  ),
  read(
    "list_statements",
    "Statements",
    "The statements generated for an account.",
    z.object({ accountId: id }),
  ),
  read(
    "get_statement",
    "Statement",
    "One statement: opening and closing balance and every line.",
    z.object({ statementId: id }),
  ),
  read(
    "list_disputes",
    "Disputes",
    "Disputed transactions and how each was resolved.",
    z.object({ customerId: id.optional() }),
  ),
  read(
    "get_trial_balance",
    "Trial balance",
    "Every ledger account's debit and credit totals. Debits always equal credits; the reconciliation check proves the balances against the postings.",
    z.object({}),
  ),
  read(
    "list_ledger",
    "Journal",
    "Journal entries with their postings, newest first.",
    z.object({
      limit,
      beforeId: z.number().int().positive().optional(),
      accountId: id.optional(),
    }),
  ),
  read(
    "get_operations",
    "Operations",
    "The bank's own side: outbox queue depth, running and sleeping Workflows, active holds, the review queue.",
    z.object({}),
  ),
  read(
    "list_alerts",
    "Alerts",
    "Fraud and AML Alerts with the Rule Findings that raised them.",
    z.object({
      status: z
        .enum(["open", "released", "rejected", "timed_out", "noted"])
        .optional(),
    }),
  ),
  read(
    "list_approvals",
    "Approvals",
    "Maker-checker requests waiting for, or decided by, a supervisor.",
    z.object({
      status: z
        .enum(["pending", "approved", "rejected", "expired", "failed"])
        .optional(),
    }),
  ),
  read(
    "list_confirmations",
    "Pending confirmations",
    "Sensitive requests from the Teller or an MCP client waiting for the person to confirm in the app.",
    z.object({}),
  ),
  read(
    "list_audit",
    "Audit trail",
    "The append-only Audit trail, newest first.",
    z.object({
      beforeId: z.number().int().positive().optional(),
      action: text(60).optional(),
      actorKind: z.enum(["staff", "teller", "client", "system"]).optional(),
      sessionId: id.optional(),
      limit: z.number().int().min(1).max(LIMITS.auditPageSize).optional(),
    }),
    "audit.read",
  ),
  read(
    "list_rules",
    "Rules",
    "The Rulebook this bank runs on: every Rule's sentence, Parameters, Version and whether it was edited.",
    z.object({}),
  ),
  read(
    "get_rule_history",
    "Rule history",
    "Every saved Version of one Rule.",
    z.object({ ruleId: z.enum(RULE_IDS as [string, ...string[]]) }),
  ),
  read(
    "list_growth",
    "Growth",
    "Requests to grow the bank and where each one is (requested, triaged, issue, pull request, merged, live), and the Changelog of what the bank learned.",
    z.object({}),
  ),

  // Customers and accounts ---------------------------------------------------
  command({
    name: "open_customer",
    kind: "write",
    title: "Open a customer",
    action: "customer.manage",
    description:
      "Onboards a new customer. Their identity starts as pending until compliance verifies it (decide_kyc).",
    input: z.object({
      name,
      dateOfBirth: bankDate,
      email: z.string().trim().email().max(120),
      phone: text(30),
      address: text(160),
      occupation: text(80),
      monthlyIncome: z
        .number()
        .int()
        .min(0)
        .max(MAX_AMOUNT)
        .describe("Minor units a month"),
    }),
  }),
  command({
    name: "update_customer",
    kind: "write",
    title: "Update a customer's details",
    action: "customer.manage",
    description:
      "Changes a customer's contact details, occupation or declared income.",
    input: z.object({
      customerId: id,
      email: z.string().trim().email().max(120).optional(),
      phone: text(30).optional(),
      address: text(160).optional(),
      occupation: text(80).optional(),
      monthlyIncome: z.number().int().min(0).max(MAX_AMOUNT).optional(),
    }),
  }),
  command({
    name: "decide_kyc",
    kind: "write",
    title: "Decide an identity check",
    action: "kyc.decide",
    sensitive: true,
    description:
      "Verifies or rejects a customer's identity (KYC). Needs compliance or a supervisor.",
    input: z.object({
      customerId: id,
      decision: z.enum(["verified", "rejected"]),
      note: text(200),
    }),
  }),
  command({
    name: "open_account",
    kind: "write",
    title: "Open an account",
    action: "account.manage",
    description:
      "Opens a current or savings account for a customer. Savings earn interest by the savings Rule.",
    input: z.object({
      customerId: id,
      kind: z.enum(["current", "savings"]),
      name: text(40).optional(),
    }),
  }),
  command({
    name: "open_term_deposit",
    kind: "write",
    title: "Open a term deposit",
    action: "account.manage",
    sensitive: true,
    description:
      "Moves money from a customer's account into a term deposit for 3, 6 or 12 months; principal and interest are paid back at maturity.",
    input: z.object({
      customerId: id,
      fromAccountId: id,
      amount,
      termMonths: z.union([
        z.literal(TERM_MONTHS[0]),
        z.literal(TERM_MONTHS[1]),
        z.literal(TERM_MONTHS[2]),
      ]),
    }),
  }),
  command({
    name: "set_account_status",
    kind: "write",
    title: "Freeze or unfreeze an account",
    action: "account.restrict",
    sensitive: true,
    description:
      "Freezes an account (nothing may leave it) or opens it again. Needs a supervisor or compliance.",
    input: z.object({
      accountId: id,
      status: z.enum(["open", "frozen"]),
      reason: text(200).min(3),
    }),
  }),
  command({
    name: "close_account",
    kind: "write",
    title: "Close an account",
    action: "account.manage",
    sensitive: true,
    description:
      "Closes an account. Its balance must be zero, with no holds, cards or standing orders left.",
    input: z.object({ accountId: id }),
  }),
  command({
    name: "set_overdraft",
    kind: "write",
    title: "Set an overdraft limit",
    action: "account.restrict",
    sensitive: true,
    description:
      "Sets how far a current account may go below zero. Needs a supervisor, and an Approval when the Rule says so.",
    input: z.object({
      accountId: id,
      limit: z.number().int().min(0).max(50_000_00).describe("Minor units"),
    }),
  }),

  // Money movement -----------------------------------------------------------
  command({
    name: "transfer",
    kind: "write",
    title: "Transfer",
    action: "money.move",
    sensitive: true,
    description:
      "Moves money from an account to another Tidewater account (by account number). Posts at once.",
    input: z.object({
      fromAccountId: id,
      toAccountNumber: accountNumberField,
      amount,
      reference,
    }),
  }),
  command({
    name: "add_payee",
    kind: "write",
    title: "Add a payee",
    action: "money.move",
    description:
      "Saves a payee at another bank (a person or a biller) for a customer.",
    input: z.object({
      customerId: id,
      name,
      kind: z.enum(["person", "biller"]),
      bankCode: z
        .string()
        .trim()
        .toUpperCase()
        .refine(isBankCode, "A bank code is four letters"),
      accountNumber: z
        .string()
        .trim()
        .regex(/^\d{6,12}$/, "6 to 12 digits"),
      reference,
    }),
  }),
  command({
    name: "remove_payee",
    kind: "write",
    title: "Remove a payee",
    action: "money.move",
    description: "Removes a saved payee. Payments already sent are kept.",
    input: z.object({ payeeId: id }),
  }),
  command({
    name: "pay_payee",
    kind: "write",
    title: "Pay a payee",
    action: "money.move",
    sensitive: true,
    description:
      "Sends a payment to a saved payee at another bank over the clearing rail. It settles after the rail's delay, may be held for review, and may be returned.",
    input: z.object({ fromAccountId: id, payeeId: id, amount, reference }),
  }),
  command({
    name: "create_standing_order",
    kind: "write",
    title: "Schedule a payment",
    action: "money.move",
    sensitive: true,
    description:
      "Schedules a payment once, weekly or monthly, to a Tidewater account number or a saved payee. End-of-day runs it on each due date.",
    input: z
      .object({
        fromAccountId: id,
        toAccountNumber: accountNumberField.optional(),
        payeeId: id.optional(),
        amount,
        frequency: z.enum(["once", "weekly", "monthly"]),
        startOn: bankDate,
        endsOn: bankDate.optional(),
        reference,
      })
      .refine(
        (value) => Boolean(value.toAccountNumber) !== Boolean(value.payeeId),
        "Give exactly one of toAccountNumber or payeeId",
      ),
  }),
  command({
    name: "cancel_standing_order",
    kind: "write",
    title: "Cancel a scheduled payment",
    action: "money.move",
    description: "Stops a scheduled payment from running again.",
    input: z.object({ standingOrderId: id }),
  }),
  command({
    name: "receive_credit",
    kind: "write",
    title: "Receive a credit",
    action: "money.move",
    sensitive: true,
    description:
      "Simulates money arriving from outside the bank (a salary, a refund, a cash deposit) into an account.",
    input: z.object({ accountId: id, amount, from: name, reference }),
  }),
  command({
    name: "reverse_payment",
    kind: "write",
    title: "Reverse a payment",
    action: "money.reverse",
    sensitive: true,
    description:
      "Reverses a settled internal transfer or an incoming credit with a mirror journal entry. Needs a supervisor.",
    input: z.object({ paymentId: id, reason: text(200).min(3) }),
  }),
  command({
    name: "open_dispute",
    kind: "write",
    title: "Dispute a transaction",
    action: "dispute.open",
    description:
      "Opens a dispute on a transaction (by its journal entry id) for the amount that left the account.",
    input: z.object({
      accountId: id,
      entryId: z.number().int().positive(),
      reason: z.enum([
        "not_recognised",
        "duplicate",
        "wrong_amount",
        "not_received",
        "other",
      ]),
      detail: text(400).optional(),
    }),
  }),
  command({
    name: "resolve_dispute",
    kind: "write",
    title: "Resolve a dispute",
    action: "dispute.resolve",
    sensitive: true,
    description:
      "Upholds a dispute (the customer is refunded from the bank's losses account) or rejects it.",
    input: z.object({
      disputeId: id,
      outcome: z.enum(["upheld", "rejected"]),
      note: text(300).min(3),
    }),
  }),

  // Cards --------------------------------------------------------------------
  command({
    name: "issue_card",
    kind: "write",
    title: "Issue a debit card",
    action: "card.manage",
    description:
      "Issues a debit card on a current account with the default limits. Only the last four digits are ever kept.",
    input: z.object({ accountId: id }),
  }),
  command({
    name: "set_card_status",
    kind: "write",
    title: "Freeze, unfreeze or cancel a card",
    action: "card.manage",
    sensitive: (input) => input.status === "cancelled",
    description:
      "Freezes a card (declines everything), unfreezes it, or cancels it for good.",
    input: z.object({
      cardId: id,
      status: z.enum(["active", "frozen", "cancelled"]),
    }),
  }),
  command({
    name: "set_card_limits",
    kind: "write",
    title: "Set card limits",
    action: "card.manage",
    sensitive: true,
    description:
      "Sets a card's limit for one purchase and for a day, and whether it works online. The Rule's ceilings apply.",
    input: z.object({
      cardId: id,
      perTransaction: amount,
      perDay: amount,
      onlineEnabled: z.boolean().optional(),
    }),
  }),
  command({
    name: "card_purchase",
    kind: "write",
    title: "Card purchase",
    action: "card.manage",
    description:
      "Simulates a purchase on a card: the bank authorises it (placing a hold on the money) or declines it with a reason code.",
    input: z.object({
      cardId: id,
      merchant: name,
      category: z.enum([
        "groceries",
        "transport",
        "dining",
        "retail",
        "travel",
        "utilities",
        "gambling",
        "crypto",
        "wire",
      ]),
      amount,
      channel: z.enum(["in_store", "online"]),
    }),
  }),
  command({
    name: "settle_card_purchase",
    kind: "write",
    title: "Settle a card purchase",
    action: "card.manage",
    description:
      "Settles an authorised purchase now: the hold is captured and the money posts. End-of-day does this for every open authorisation.",
    input: z.object({ authorisationId: id }),
  }),
  command({
    name: "reverse_card_purchase",
    kind: "write",
    title: "Reverse a card authorisation",
    action: "card.manage",
    description:
      "The merchant cancels an authorised purchase: its hold is released and nothing posts.",
    input: z.object({ authorisationId: id }),
  }),

  // Loans --------------------------------------------------------------------
  command({
    name: "apply_for_loan",
    kind: "write",
    title: "Apply for a loan",
    action: "loan.manage",
    description:
      "A loan application. The affordability Rules decide at once: an offer (rate, monthly payment) or a decline with every reason.",
    input: z.object({
      customerId: id,
      disburseAccountId: id,
      amount,
      termMonths: z.number().int().min(1).max(120),
      purpose: text(80).min(2),
      monthlyIncome: z.number().int().min(0).max(MAX_AMOUNT),
      monthlyExpenses: z.number().int().min(0).max(MAX_AMOUNT),
    }),
  }),
  command({
    name: "accept_loan",
    kind: "write",
    title: "Accept a loan offer",
    action: "loan.manage",
    sensitive: true,
    description:
      "Accepts an offered loan. A Workflow disburses it into the customer's account and builds the repayment schedule.",
    input: z.object({ loanId: id }),
  }),
  command({
    name: "repay_loan",
    kind: "write",
    title: "Repay a loan",
    action: "loan.manage",
    sensitive: true,
    description:
      "Pays towards a loan from its repayment account: arrears and the next instalment first, anything more reduces the principal.",
    input: z.object({ loanId: id, amount }),
  }),

  // The bank's own side ------------------------------------------------------
  command({
    name: "decide_alert",
    kind: "write",
    title: "Release or reject a held payment",
    action: "alert.decide",
    sensitive: true,
    description:
      "Decides an open Alert: release the held payment to the rail, or reject it and free the money. Needs compliance.",
    input: z.object({
      alertId: id,
      decision: z.enum(["release", "reject"]),
      note: text(300).min(3),
    }),
  }),
  command({
    name: "decide_approval",
    kind: "write",
    title: "Give or refuse an Approval",
    action: "approval.decide",
    humanOnly: true,
    description:
      "Maker-checker: a supervisor who did not make the request approves or rejects it.",
    input: z.object({
      approvalId: id,
      decision: z.enum(["approve", "reject"]),
      note: text(300).optional(),
    }),
  }),
  command({
    name: "confirm_request",
    kind: "write",
    title: "Confirm a request from the Teller",
    action: "bank.read",
    humanOnly: true,
    description:
      "The person confirms or declines a sensitive write the Teller or an MCP client asked for.",
    input: z.object({
      confirmationId: id,
      decision: z.enum(["confirm", "decline"]),
    }),
  }),
  command({
    name: "edit_rule",
    kind: "write",
    title: "Edit a Rule",
    action: "rule.edit",
    sensitive: true,
    description:
      "Saves a new Version of a Rule: its Parameters and whether it is on. Needs a supervisor.",
    input: z.object({
      ruleId: z.enum(RULE_IDS as [string, ...string[]]),
      params: z.record(
        z.string(),
        z.union([z.number(), z.boolean(), z.array(z.string())]),
      ),
      enabled: z.boolean().optional(),
      note: text(200).optional(),
    }),
  }),
  command({
    name: "restore_rule",
    kind: "write",
    title: "Restore a Rule's Default",
    action: "rule.edit",
    sensitive: true,
    description: "Saves a new Version of a Rule with its Default Parameters.",
    input: z.object({ ruleId: z.enum(RULE_IDS as [string, ...string[]]) }),
  }),
  command({
    name: "advance_clock",
    kind: "write",
    title: "Fast-forward the clock",
    action: "clock.advance",
    sensitive: true,
    description:
      "Moves the bank's simulated clock forward by whole days. Each day crossed runs end-of-day (interest, scheduled payments, loan collections, maturities) and due payments settle.",
    input: z.object({
      days: z.number().int().min(1).max(LIMITS.clockDaysPerJump),
    }),
  }),
  command({
    name: "request_statement",
    kind: "write",
    title: "Generate a statement",
    action: "account.manage",
    description:
      "Asks for an account's statement for a month (YYYY-MM). A Workflow builds it; download it as PDF or CSV from the account.",
    input: z.object({
      accountId: id,
      month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "A month is YYYY-MM"),
    }),
  }),
  command({
    name: "mark_notifications_read",
    kind: "write",
    title: "Mark notifications read",
    action: "bank.read",
    description: "Marks one notification, or all of a customer's, as read.",
    input: z.object({
      notificationId: id.optional(),
      customerId: id.optional(),
    }),
  }),
  command({
    name: "raise_request",
    kind: "write",
    title: "Ask the bank to grow",
    action: "growth.raise",
    description:
      "Raises a Growth request when a person asks for something this bank cannot do yet, or reports a bug. It is triaged, filed as a GitHub issue, built by a scheduled agent, reviewed and merged, with no human in the loop. Quote the person's own words in `want`.",
    input: z.object({
      kind: z.enum(["feature", "bug"]),
      title: text(LIMITS.growthTitleChars).min(6),
      want: text(LIMITS.growthWantChars).min(12),
      evidence: text(600).optional(),
    }),
  }),
] as const;

export type Command = (typeof COMMANDS)[number];
export type CommandName = Command["name"];
export type CommandInput<Name extends CommandName> = z.infer<
  Extract<Command, { name: Name }>["input"]
>;

const BY_NAME = new Map<string, CommandDef>(
  COMMANDS.map((item) => [item.name, item as unknown as CommandDef]),
);

export function commandDef(commandName: string): CommandDef | undefined {
  return BY_NAME.get(commandName);
}

export const isCommandName = (value: string): value is CommandName =>
  BY_NAME.has(value);

/** Commands the app has and no MCP tool may have. Kept as short as it can be. */
export const HUMAN_ONLY: CommandName[] = COMMANDS.filter(
  (item) => "humanOnly" in item && item.humanOnly,
).map((item) => item.name);

/** Every command that is an MCP tool: all of them but the human-only ones. */
export const MCP_COMMANDS = COMMANDS.filter(
  (item) => !("humanOnly" in item && item.humanOnly),
);

/** Whether this call must wait for the person's click when an agent asks for it. */
export function isSensitive(def: CommandDef, input: unknown): boolean {
  return typeof def.sensitive === "function"
    ? def.sensitive(input as never)
    : def.sensitive === true;
}

/** Who is asking: the app (a person's own click), the Teller, or an outside MCP client. */
export type Via = "app" | "chat" | "mcp";

/** What a write answers with. A refusal is thrown, never returned. */
export type WriteOutcome<Result = unknown> =
  | { status: "done"; message: string; result: Result }
  | {
      status: "needs_confirmation";
      message: string;
      confirmationId: string;
      summary: string;
      expiresAt: string;
    }
  | {
      status: "needs_approval";
      message: string;
      approvalId: string;
      summary: string;
      reason: string;
    };
