import type { Owner } from "@/features/access/domain/owner";
import type { Finding } from "../domain/checks";
import type { BankDate } from "../domain/dates";
import type { Rulebook } from "../domain/rules";
import { type Actor, staffIdOf } from "./actor";
import { type Db, jsonb, type Tx } from "./db";

/**
 * What a write handler is given: the transaction it runs in, who is asking,
 * the Rulebook and the bank's clock, all read once.
 */
export type Ctx = {
  tx: Tx;
  owner: Owner;
  actor: Actor;
  book: Rulebook;
  /** Bank time now, ISO. */
  now: string;
  today: BankDate;
  /** A supervisor has approved this command (maker-checker is satisfied). */
  approved: boolean;
};

/** A ledger code of the bank's own books. The first digit is the section. */
export const GL = {
  cash: "1000",
  cardSettlement: "2100",
  clearing: "2200",
  interestPayable: "2300",
  capital: "3000",
  loanInterest: "4000",
  fees: "4100",
  interestExpense: "5000",
  losses: "5100",
} as const;

export const GL_ACCOUNTS: { code: string; name: string; normal: "D" | "C" }[] =
  [
    { code: GL.cash, name: "Cash at the Central Bank of Meridia", normal: "D" },
    { code: GL.cardSettlement, name: "Card scheme settlement", normal: "C" },
    { code: GL.clearing, name: "Payments in clearing", normal: "C" },
    { code: GL.interestPayable, name: "Interest payable", normal: "C" },
    { code: GL.capital, name: "Share capital", normal: "C" },
    { code: GL.loanInterest, name: "Loan interest income", normal: "C" },
    { code: GL.fees, name: "Fee income", normal: "C" },
    { code: GL.interestExpense, name: "Interest expense", normal: "D" },
    { code: GL.losses, name: "Dispute and fraud losses", normal: "D" },
  ];

export type Posting = { account: string; dir: "D" | "C"; amount: number };

export type PostOptions = {
  captureHold?: string;
  force?: boolean;
  allowFrozen?: boolean;
  ref?: Record<string, string | number>;
  reverses?: number;
  entryDate?: BankDate;
};

/** The id of one of the bank's own ledger accounts. */
export async function gl(db: Db, owner: Owner, code: string): Promise<string> {
  const [row] = await db<{ id: string }[]>`
    select id from bank.accounts where owner = ${owner} and gl_code = ${code}`;
  if (!row) throw new Error(`The bank has no ledger account ${code}`);
  return row.id;
}

export function postOpts(actor: Actor | null, options: PostOptions = {}) {
  return {
    ...(options.captureHold ? { capture_hold: options.captureHold } : {}),
    ...(options.force ? { force: true } : {}),
    ...(options.allowFrozen ? { allow_frozen: true } : {}),
    ...(options.ref ? { ref: options.ref } : {}),
    ...(options.reverses ? { reverses: options.reverses } : {}),
    ...(options.entryDate ? { entry_date: options.entryDate } : {}),
    ...(actor
      ? { staff_id: staffIdOf(actor), via: actor.via }
      : { via: "workflow" }),
  };
}

/**
 * Posts one balanced journal entry through `bank.post_entry`, the only way
 * money moves. The database locks the accounts, checks the funds and the
 * balance, and seals the entry.
 */
export async function post(
  db: Db,
  owner: Owner,
  actor: Actor | null,
  kind: string,
  description: string,
  postings: Posting[],
  options: PostOptions = {},
): Promise<number> {
  const [row] = await db<{ id: number }[]>`
    select bank.post_entry(
      ${owner}, ${kind}, ${description},
      ${jsonb(
        db,
        postings.filter((posting) => posting.amount > 0),
      )},
      ${jsonb(db, postOpts(actor, options))}
    ) as id`;
  if (!row) throw new Error("The entry was not posted");
  return row.id;
}

/** Locks these accounts' balance rows (in id order) for the rest of the transaction. */
export async function lock(db: Db, owner: Owner, accountIds: string[]) {
  await db`select bank.lock_accounts(${owner}, ${accountIds}::uuid[])`;
}

export async function placeHold(
  db: Db,
  owner: Owner,
  input: {
    accountId: string;
    amount: number;
    kind: "card" | "review" | "approval";
    ref: string;
    expiresOn?: BankDate | null;
  },
): Promise<string> {
  const [row] = await db<{ id: string }[]>`
    select bank.place_hold(
      ${owner}, ${input.accountId}, ${input.amount}, ${input.kind},
      ${input.ref}, ${input.expiresOn ?? null}
    ) as id`;
  if (!row) throw new Error("The hold was not placed");
  return row.id;
}

export async function endHold(
  db: Db,
  owner: Owner,
  holdId: string,
  status: "captured" | "released" | "expired",
): Promise<boolean> {
  const [row] = await db<{ ended: boolean }[]>`
    select bank.end_hold(${owner}, ${holdId}, ${status}) as ended`;
  return row?.ended ?? false;
}

/** The topics of the outbox: each is a Workflow (server/workflows). */
export type Topic =
  | "payment.clear"
  | "alert.review"
  | "loan.disburse"
  | "statement.generate"
  | "clock.advanced"
  | "notify"
  | "growth.triage";

/**
 * Writes a message to the outbox in the caller's transaction, so a
 * committed write always has its message and a rolled-back one never does.
 */
export async function enqueue(
  db: Db,
  owner: Owner,
  topic: Topic,
  payload: Record<string, unknown>,
): Promise<number> {
  const [row] = await db<{ id: number }[]>`
    insert into bank.outbox (owner, topic, payload)
    values (${owner}, ${topic}, ${jsonb(db, payload)})
    returning id`;
  if (!row) throw new Error("The outbox message was not written");
  return row.id;
}

/**
 * Writes a notification for a customer (or the bank's staff when there is
 * none). `fanout` hands it to the notification Workflow, which delivers it
 * on each channel; a Workflow that is already running delivers its own.
 */
export async function notify(
  db: Db,
  owner: Owner,
  input: {
    customerId: string | null;
    kind: string;
    title: string;
    body: string;
    fanout?: boolean;
  },
): Promise<string> {
  const fanout = input.fanout ?? true;
  const [row] = await db<{ id: string }[]>`
    insert into bank.notifications (owner, customer_id, kind, title, body, delivered, bank_time)
    values (
      ${owner}, ${input.customerId}, ${input.kind}, ${input.title.slice(0, 120)},
      ${input.body.slice(0, 500)},
      ${jsonb(db, fanout ? [] : ["inbox", "email", "push"])},
      bank.now(${owner})
    )
    returning id`;
  if (!row) throw new Error("The notification was not written");
  if (fanout) await enqueue(db, owner, "notify", { notificationId: row.id });
  return row.id;
}

/** Raises an Alert from Rule Findings. `holding` Alerts wait for compliance. */
export async function raiseAlert(
  db: Db,
  owner: Owner,
  input: {
    customerId: string | null;
    accountId: string | null;
    paymentId?: string | null;
    findings: Finding[];
    holding: boolean;
    reviewBy?: string | null;
  },
): Promise<string> {
  const severity = input.holding
    ? input.findings.length > 1
      ? "high"
      : "medium"
    : "low";
  const [row] = await db<{ id: string }[]>`
    insert into bank.alerts (
      owner, customer_id, account_id, payment_id, severity, holding, findings,
      summary, status, raised_at, review_by
    ) values (
      ${owner}, ${input.customerId}, ${input.accountId}, ${input.paymentId ?? null},
      ${severity}, ${input.holding}, ${jsonb(db, input.findings)},
      ${input.findings
        .map((finding) => finding.message)
        .join(" ")
        .slice(0, 400)},
      ${input.holding ? "open" : "noted"}, bank.now(${owner}), ${input.reviewBy ?? null}
    )
    returning id`;
  if (!row) throw new Error("The Alert was not raised");
  return row.id;
}

export async function nextSeq(
  db: Db,
  owner: Owner,
  name: string,
): Promise<number> {
  const [row] = await db<{ value: number }[]>`
    select bank.next_seq(${owner}, ${name}) as value`;
  if (!row) throw new Error("No sequence value");
  return row.value;
}

/** What a write handler answers with: words for the person and the data. */
export type Done = { message: string; result: unknown };

export type WriteHandler<Input> = {
  /**
   * Why this call needs a supervisor's Approval before it runs, or null.
   * Throws when the call would be refused anyway, so nothing waits for an
   * Approval it could never use.
   */
  gate?: (
    ctx: Ctx,
    input: Input,
  ) => Promise<{ reason: string; amount?: number } | null>;
  /** One line for the confirmation and Approval cards: what will happen, with names and amounts. */
  describe?: (ctx: Ctx, input: Input) => Promise<string>;
  run: (ctx: Ctx, input: Input) => Promise<Done>;
};
