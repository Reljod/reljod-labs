import type { Owner } from "@/features/access/domain/owner";
import { railOutcome, releaseOnTimeout, savingsRate } from "../domain/checks";
import {
  addDays,
  addMonths,
  type BankDate,
  datesAfter,
  formatDate,
  isMonthEnd,
  monthStart,
} from "../domain/dates";
import { dailyInterest, termInterest } from "../domain/lending";
import { formatMoney } from "../domain/money";
import { formatAccountNumber } from "../domain/numbers";
import { num } from "../domain/rules";
import type { StatementBody } from "../domain/views";
import { systemActor } from "./actor";
import { auditIn } from "./audit";
import { jsonb, type Pool, type Tx } from "./db";
import { fromDatabase, isSafeError } from "./errors";
import { type Ctx, endHold, GL, gl, lock, notify, post } from "./ledger";
import { accountById } from "./reads";
import { bankClock, loadRulebook } from "./rulebook";
import {
  loanRow,
  payInstalment,
  settleAuthorisation,
  settleLoanState,
} from "./write-cards-loans";
import { concludeReview, sendPayment } from "./write-money";

/**
 * What the bank does by itself, called from Workflow steps: clearing and
 * settlement, the review deadline, statements and end-of-day. Every function
 * here is safe to run twice: a step that is retried, or a message that is
 * delivered again, finds the work done and does nothing.
 */

async function systemCtx(tx: Tx, owner: Owner, name: string): Promise<Ctx> {
  const clock = await bankClock(tx, owner);
  return {
    tx,
    owner,
    actor: systemActor(owner, name),
    book: await loadRulebook(tx, owner),
    now: clock.now,
    today: clock.today,
    approved: true,
  };
}

/**
 * Runs `work` once for a key: the key is claimed in the same transaction as
 * the work (`bank.commands`), so a retry returns the first result.
 */
async function once<T>(
  pool: Pool,
  owner: Owner,
  key: string,
  work: (tx: Tx) => Promise<T>,
): Promise<T> {
  try {
    return (await pool.begin(async (tx) => {
      const [prior] = await tx<{ result: { value: T } | null }[]>`
        select bank.begin_command(${owner}, ${key}, 'system', 'system') as result`;
      if (prior?.result) return prior.result.value;
      const value = await work(tx as unknown as Tx);
      await tx`select bank.finish_command(${owner}, ${key}, ${tx.json({ value: value ?? null } as never)})`;
      return value;
    })) as T;
  } catch (error) {
    throw fromDatabase(error);
  }
}

// Clearing ---------------------------------------------------------------------

export type ClearingResult =
  | { state: "waiting"; settlesOn: BankDate; wakeAt: string }
  | { state: "settled" | "returned" | "gone"; note: string };

/**
 * One look at a payment in clearing. Before its settlement date it reports
 * when to look again (in real time, given the simulated clock). On or after
 * it, the rail's answer is posted: settled (the money leaves the bank's cash)
 * or returned (it goes back to the customer, with the reason).
 */
export async function clearPayment(
  pool: Pool,
  owner: Owner,
  paymentId: string,
): Promise<ClearingResult> {
  return pool.begin(async (raw) => {
    const tx = raw as unknown as Tx;
    const [payment] = await tx<
      {
        id: string;
        status: string;
        settlesOn: BankDate;
        amount: number;
        fromAccountId: string;
        customerId: string;
        payeeName: string;
        payeeNumber: string;
        today: BankDate;
        secondsToSettle: number;
      }[]
    >`
      select p.id, p.status, p.settles_on, p.amount, p.from_account_id,
             a.customer_id, coalesce(y.name, p.counterparty) as payee_name,
             coalesce(y.account_number, '') as payee_number,
             bank.today(${owner}) as today,
             extract(epoch from (p.settles_on::timestamp at time zone 'UTC') - bank.now(${owner}))::bigint as seconds_to_settle
      from bank.payments p
      join bank.accounts a on a.id = p.from_account_id
      left join bank.payees y on y.id = p.payee_id
      where p.owner = ${owner} and p.id = ${paymentId}
      for update of p`;
    if (!payment)
      return { state: "gone", note: "The payment no longer exists" };
    if (payment.status !== "clearing") {
      return { state: "gone", note: `The payment is ${payment.status}` };
    }
    if (payment.today < payment.settlesOn) {
      return {
        state: "waiting",
        settlesOn: payment.settlesOn,
        wakeAt: new Date(
          Date.now() + Math.max(1, payment.secondsToSettle) * 1000,
        ).toISOString(),
      };
    }
    const settledOn =
      payment.settlesOn && payment.settlesOn <= payment.today
        ? payment.settlesOn
        : payment.today;
    const outcome = railOutcome(payment.payeeNumber);
    const clearing = await gl(tx, owner, GL.clearing);
    if (outcome.settled) {
      const entryId = await post(
        tx,
        owner,
        null,
        "payment_settle",
        `Settled: ${payment.payeeName}`,
        [
          { account: clearing, dir: "D", amount: payment.amount },
          {
            account: await gl(tx, owner, GL.cash),
            dir: "C",
            amount: payment.amount,
          },
        ],
        { ref: { paymentId: payment.id }, entryDate: settledOn },
      );
      await tx`
        update bank.payments set status = 'settled', settled_on = ${settledOn},
               settle_entry_id = ${entryId}
        where id = ${payment.id}`;
      await auditIn(
        tx,
        { owner, system: "Clearing rail" },
        {
          action: "payment.settled",
          summary: `${formatMoney(payment.amount)} to ${payment.payeeName} settled`,
          target: { kind: "payment", id: payment.id },
          detail: { amount: payment.amount, entryId },
        },
      );
      return { state: "settled", note: `Settled on ${settledOn}` };
    }
    // Returned: the customer gets the money back. Bank-initiated, so it
    // credits even a frozen account.
    const book = await loadRulebook(tx, owner);
    const entryId = await post(
      tx,
      owner,
      null,
      "payment_return",
      `Returned: ${payment.payeeName} (${outcome.code})`,
      [
        { account: clearing, dir: "D", amount: payment.amount },
        { account: payment.fromAccountId, dir: "C", amount: payment.amount },
      ],
      { ref: { paymentId: payment.id }, entryDate: settledOn },
    );
    const fee = book["fees.payments"].enabled
      ? num(book, "fees.payments", "returned")
      : 0;
    const account = await accountById(tx, owner, payment.fromAccountId);
    let charged = 0;
    if (fee > 0 && account.status === "open" && account.available >= fee) {
      await post(
        tx,
        owner,
        null,
        "fee",
        "Returned payment fee",
        [
          { account: account.id, dir: "D", amount: fee },
          { account: await gl(tx, owner, GL.fees), dir: "C", amount: fee },
        ],
        { ref: { paymentId: payment.id }, entryDate: settledOn },
      );
      charged = fee;
    }
    await tx`
      update bank.payments set status = 'returned', settled_on = ${settledOn},
             settle_entry_id = ${entryId},
             status_reason = ${`${outcome.code}: ${outcome.reason}`}
      where id = ${payment.id}`;
    await notify(tx, owner, {
      customerId: payment.customerId,
      kind: "payment",
      title: "A payment came back",
      body: `Your payment of ${formatMoney(payment.amount)} to ${payment.payeeName} was returned: ${outcome.reason}.${charged ? ` A fee of ${formatMoney(charged)} was charged.` : ""}`,
      fanout: false,
    });
    await auditIn(
      tx,
      { owner, system: "Clearing rail" },
      {
        action: "payment.returned",
        summary: `${formatMoney(payment.amount)} to ${payment.payeeName} returned: ${outcome.code} ${outcome.reason}`,
        target: { kind: "payment", id: payment.id },
        detail: {
          amount: payment.amount,
          code: outcome.code,
          entryId,
          fee: charged,
        },
      },
    );
    return { state: "returned", note: `${outcome.code}: ${outcome.reason}` };
  }) as Promise<ClearingResult>;
}

// Review deadline --------------------------------------------------------------

export type ReviewResult =
  | { state: "waiting"; wakeAt: string }
  | { state: "decided" | "timed_out"; note: string };

/** One look at an open Alert: past its deadline, the Rule decides it. */
export async function reviewDeadline(
  pool: Pool,
  owner: Owner,
  alertId: string,
): Promise<ReviewResult> {
  return pool.begin(async (raw) => {
    const tx = raw as unknown as Tx;
    const [alert] = await tx<{ status: string; secondsLeft: number }[]>`
      select status,
             extract(epoch from review_by - bank.now(${owner}))::bigint as seconds_left
      from bank.alerts where owner = ${owner} and id = ${alertId}`;
    if (!alert || alert.status !== "open") {
      return {
        state: "decided",
        note: alert ? `The Alert was ${alert.status}` : "The Alert is gone",
      };
    }
    if (alert.secondsLeft > 0) {
      return {
        state: "waiting",
        wakeAt: new Date(Date.now() + alert.secondsLeft * 1000).toISOString(),
      };
    }
    const ctx = await systemCtx(tx, owner, "Review deadline");
    const release = releaseOnTimeout(ctx.book);
    await concludeReview(ctx, alertId, {
      release,
      status: "timed_out",
      note: `Nobody decided within ${num(ctx.book, "fraud.review", "hours")} hours`,
      decidedBy: null,
    });
    await auditIn(
      tx,
      { owner, system: "Review deadline" },
      {
        action: "alert.timed_out",
        summary: `Review deadline passed: the held payment was ${release ? "released" : "rejected"} by the Rule`,
        target: { kind: "alert", id: alertId },
        detail: { release },
      },
    );
    return {
      state: "timed_out",
      note: release ? "Released by the Rule" : "Rejected by the Rule",
    };
  }) as Promise<ReviewResult>;
}

// Statements -------------------------------------------------------------------

/** Builds (or rebuilds) an account's statement for a period from the ledger. */
export async function generateStatement(
  db: Pool | Tx,
  owner: Owner,
  accountId: string,
  periodStart: BankDate,
  periodEnd: BankDate,
): Promise<{ statementId: string; lines: number }> {
  const account = await accountById(db, owner, accountId);
  const [customer] = await db<
    { name: string; address: string; bankName: string }[]
  >`
    select c.name, c.address, k.name as bank_name
    from bank.customers c join bank.banks k on k.owner = c.owner
    where c.id = ${account.customerId}`;
  const [opening] = await db<{ balance: number }[]>`
    select coalesce(sum(case when p.direction = 'C' then p.amount else -p.amount end), 0)::bigint as balance
    from bank.postings p join bank.journal_entries e on e.id = p.entry_id
    where p.owner = ${owner} and p.account_id = ${accountId} and e.entry_date < ${periodStart}`;
  const rows = await db<
    {
      date: BankDate;
      description: string;
      direction: "D" | "C";
      amount: number;
    }[]
  >`
    select e.entry_date as date, e.description, p.direction, p.amount
    from bank.postings p join bank.journal_entries e on e.id = p.entry_id
    where p.owner = ${owner} and p.account_id = ${accountId}
      and e.entry_date between ${periodStart} and ${periodEnd}
    order by e.entry_date, p.id`;
  let balance = opening?.balance ?? 0;
  let totalIn = 0;
  let totalOut = 0;
  const lines = rows.map((row) => {
    const moneyIn = row.direction === "C" ? row.amount : 0;
    const moneyOut = row.direction === "D" ? row.amount : 0;
    balance += moneyIn - moneyOut;
    totalIn += moneyIn;
    totalOut += moneyOut;
    return {
      date: row.date,
      description: row.description,
      moneyIn,
      moneyOut,
      balance,
    };
  });
  const body: StatementBody = {
    bankName: customer?.bankName ?? "Tidewater Bank",
    customerName: customer?.name ?? "",
    customerAddress: customer?.address ?? "",
    accountNumber: account.number,
    accountName: account.name,
    periodStart,
    periodEnd,
    openingBalance: opening?.balance ?? 0,
    closingBalance: balance,
    totalIn,
    totalOut,
    lines,
  };
  const [row] = await db<{ id: string }[]>`
    insert into bank.statements (owner, account_id, period_start, period_end, body)
    values (${owner}, ${accountId}, ${periodStart}, ${periodEnd}, ${jsonb(db, body)})
    on conflict (account_id, period_start, period_end)
    do update set body = excluded.body, created_at = now()
    returning id`;
  if (!row) throw new Error("The statement was not saved");
  return { statementId: row.id, lines: lines.length };
}

// End-of-day -------------------------------------------------------------------

/** The dates whose end-of-day is owed: after the last one done, up to `through`. */
export async function eodDates(
  pool: Pool,
  owner: Owner,
  through: BankDate,
): Promise<BankDate[]> {
  const [bank] = await pool<{ eodThrough: BankDate | null; today: BankDate }[]>`
    select eod_through, bank.today(owner) as today from bank.banks where owner = ${owner}`;
  if (!bank) return [];
  const last = through < bank.today ? through : addDays(bank.today, -1);
  return datesAfter(bank.eodThrough ?? addDays(last, -1), last);
}

export const EOD_STEPS = [
  "cards",
  "scheduled",
  "loans",
  "interest",
  "terms",
  "statements",
  "close",
] as const;

export type EodStep = (typeof EOD_STEPS)[number];

/** One step of one date's end-of-day. Returns a line for the run's trail. */
export async function runEodStep(
  pool: Pool,
  owner: Owner,
  date: BankDate,
  step: EodStep,
): Promise<string> {
  return once(pool, owner, `eod:${date}:${step}`, async (tx) => {
    const ctx = {
      ...(await systemCtx(tx, owner, "End-of-day")),
      today: date,
      now: `${date}T12:00:00.000Z`,
    };
    switch (step) {
      case "cards":
        return settleCards(ctx, date);
      case "scheduled":
        return runScheduled(ctx, date);
      case "loans":
        return collectLoans(ctx, date);
      case "interest":
        return accrueInterest(ctx, date);
      case "terms":
        return matureTerms(ctx, date);
      case "statements":
        return monthStatements(ctx, date);
      case "close":
        return closeDay(ctx, date);
    }
  });
}

async function settleCards(ctx: Ctx, date: BankDate): Promise<string> {
  const { tx, owner } = ctx;
  // Merchants send their purchases in at the end of the day. A travel
  // pre-authorisation (a hotel, a hire car) is never sent in: it expires.
  const due = await tx<
    {
      id: string;
      cardId: string;
      accountId: string;
      merchant: string;
      amount: number;
      status: string;
      holdId: string | null;
      customerId: string;
    }[]
  >`
    select x.id, x.card_id, x.account_id, x.merchant, x.amount, x.status,
           x.hold_id, k.customer_id
    from bank.card_authorisations x join bank.cards k on k.id = x.card_id
    where x.owner = ${owner} and x.status = 'authorised'
      and x.authorised_on <= ${date} and x.category <> 'travel'
    order by x.created_at for update of x`;
  for (const auth of due)
    await settleAuthorisation(tx, owner, null, auth, date);
  const expired = await tx<{ id: string; holdId: string | null }[]>`
    select x.id, x.hold_id from bank.card_authorisations x
    where x.owner = ${owner} and x.status = 'authorised'
      and x.authorised_on + ${num(ctx.book, "cards.limits", "authDays")}::int <= ${date}
    for update of x`;
  for (const auth of expired) {
    if (auth.holdId) await endHold(tx, owner, auth.holdId, "expired");
    await tx`update bank.card_authorisations set status = 'expired' where id = ${auth.id}`;
  }
  // What was settled is paid to the card scheme from the bank's cash.
  const scheme = await gl(tx, owner, GL.cardSettlement);
  const [owed] = await tx<{ balance: number }[]>`
    select credits - debits as balance from bank.account_balances where account_id = ${scheme}`;
  if ((owed?.balance ?? 0) > 0) {
    await post(
      tx,
      owner,
      null,
      "card_scheme",
      "Paid to the card scheme",
      [
        { account: scheme, dir: "D", amount: owed?.balance ?? 0 },
        {
          account: await gl(tx, owner, GL.cash),
          dir: "C",
          amount: owed?.balance ?? 0,
        },
      ],
      { entryDate: date },
    );
  }
  if (due.length + expired.length > 0) {
    await auditIn(
      tx,
      { owner, system: "End-of-day" },
      {
        action: "card.settled",
        summary: `${date}: ${due.length} card purchase(s) settled, ${expired.length} authorisation(s) expired`,
        detail: { date, settled: due.length, expired: expired.length },
      },
    );
  }
  return `${due.length} card purchases settled, ${expired.length} expired`;
}

async function runScheduled(ctx: Ctx, date: BankDate): Promise<string> {
  const { tx, owner } = ctx;
  const due = await tx<
    {
      id: string;
      fromAccountId: string;
      toAccountId: string | null;
      payeeId: string | null;
      amount: number;
      frequency: "once" | "weekly" | "monthly";
      nextRunOn: BankDate;
      endsOn: BankDate | null;
      reference: string;
    }[]
  >`
    select id, from_account_id, to_account_id, payee_id, amount, frequency,
           next_run_on, ends_on, reference
    from bank.standing_orders
    where owner = ${owner} and status = 'active' and next_run_on <= ${date}
    order by created_at for update`;
  let ran = 0;
  let failed = 0;
  for (const order of due) {
    let result: string;
    try {
      result = await tx.savepoint(async (inner) => {
        const sp = inner as unknown as Tx;
        const inside = { ...ctx, tx: sp };
        await lock(
          sp,
          owner,
          order.toAccountId
            ? [order.fromAccountId, order.toAccountId]
            : [order.fromAccountId],
        );
        const from = await accountById(sp, owner, order.fromAccountId);
        if (from.status !== "open")
          throw new Error(`Account ${from.number} is ${from.status}`);
        const to = order.toAccountId
          ? await accountById(sp, owner, order.toAccountId)
          : null;
        const [payee] = order.payeeId
          ? await sp<
              {
                id: string;
                customerId: string;
                name: string;
                kind: "person" | "biller";
                bankCode: string;
                accountNumber: string;
                firstPaidOn: BankDate | null;
                createdOn: BankDate;
              }[]
            >`
              select id, customer_id, name, kind, bank_code, account_number, first_paid_on, created_on
              from bank.payees where id = ${order.payeeId} and removed_at is null`
          : [];
        if (!to && !payee) throw new Error("The payee was removed");
        const done = await sendPayment(inside, {
          from,
          kind: to
            ? "internal"
            : payee?.kind === "biller"
              ? "bill"
              : "external",
          to,
          payee: payee ?? null,
          amount: order.amount,
          reference: order.reference,
          scheduled: true,
          standingOrderId: order.id,
        });
        return done.message;
      });
      ran += 1;
    } catch (thrown) {
      const error = fromDatabase(thrown);
      if (!isSafeError(error) && !(error instanceof Error)) throw error;
      result = `Not paid: ${(error as Error).message}`;
      failed += 1;
      const from = await accountById(tx, owner, order.fromAccountId);
      await notify(tx, owner, {
        customerId: from.customerId,
        kind: "payment",
        title: "A scheduled payment was not made",
        body: `${formatMoney(order.amount)} due on ${formatDate(order.nextRunOn)}: ${(error as Error).message}`,
        fanout: false,
      });
    }
    const next =
      order.frequency === "weekly"
        ? addDays(order.nextRunOn, 7)
        : order.frequency === "monthly"
          ? addMonths(order.nextRunOn, 1)
          : null;
    const ended =
      next === null || (order.endsOn !== null && next > order.endsOn);
    await tx`
      update bank.standing_orders set runs = runs + 1, last_result = ${result.slice(0, 200)},
             next_run_on = ${next ?? order.nextRunOn}, status = ${ended ? "ended" : "active"}
      where id = ${order.id}`;
  }
  return `${ran} scheduled payments made, ${failed} failed`;
}

async function collectLoans(ctx: Ctx, date: BankDate): Promise<string> {
  const { tx, owner } = ctx;
  const due = await tx<
    {
      loanId: string;
      n: number;
      dueOn: BankDate;
      principal: number;
      interest: number;
      payment: number;
      status: "due" | "missed";
    }[]
  >`
    select i.loan_id, i.n, i.due_on, i.principal, i.interest, i.payment, i.status
    from bank.loan_instalments i join bank.loans l on l.id = i.loan_id
    where i.owner = ${owner} and i.status <> 'paid' and i.due_on <= ${date}
      and l.status in ('active', 'arrears')
    order by i.loan_id, i.n`;
  let collected = 0;
  let missed = 0;
  const touched = new Set<string>();
  for (const instalment of due) {
    const loan = await loanRow(tx, owner, instalment.loanId);
    if (!loan.loanAccountId) continue;
    touched.add(loan.id);
    await lock(tx, owner, [loan.disburseAccountId, loan.loanAccountId]);
    const account = await accountById(tx, owner, loan.disburseAccountId);
    if (account.status === "open" && account.available >= instalment.payment) {
      await payInstalment(tx, owner, null, loan, instalment, date);
      collected += 1;
      continue;
    }
    if (instalment.status === "due") {
      missed += 1;
      await tx`
        update bank.loan_instalments set status = 'missed'
        where loan_id = ${loan.id} and n = ${instalment.n}`;
      const fee = ctx.book["fees.lending"].enabled
        ? num(ctx.book, "fees.lending", "late")
        : 0;
      const charged =
        fee > 0 && account.status === "open" && account.available >= fee;
      if (charged) {
        await post(
          tx,
          owner,
          null,
          "fee",
          `Late fee, loan ${loan.number}`,
          [
            { account: account.id, dir: "D", amount: fee },
            { account: await gl(tx, owner, GL.fees), dir: "C", amount: fee },
          ],
          { ref: { loanId: loan.id }, entryDate: date },
        );
      }
      await notify(tx, owner, {
        customerId: loan.customerId,
        kind: "loan",
        title: "A loan repayment was missed",
        body: `Instalment ${instalment.n} of loan ${loan.number} (${formatMoney(instalment.payment)}) could not be collected from ${formatAccountNumber(account.number)}.${charged ? ` A late fee of ${formatMoney(fee)} was charged.` : ""} We will try again each day.`,
        fanout: false,
      });
      await auditIn(
        tx,
        { owner, system: "End-of-day" },
        {
          action: "loan.missed",
          summary: `Loan ${loan.number}: instalment ${instalment.n} missed on ${date}`,
          target: { kind: "loan", id: loan.id },
          detail: {
            n: instalment.n,
            payment: instalment.payment,
            lateFee: charged ? fee : 0,
          },
        },
      );
    }
  }
  for (const loanId of touched) {
    await settleLoanState(tx, await loanRow(tx, owner, loanId), date);
  }
  if (collected > 0) {
    await auditIn(
      tx,
      { owner, system: "End-of-day" },
      {
        action: "loan.collected",
        summary: `${date}: ${collected} loan instalment(s) collected`,
        detail: { date, collected, missed },
      },
    );
  }
  return `${collected} loan instalments collected, ${missed} missed`;
}

async function accrueInterest(ctx: Ctx, date: BankDate): Promise<string> {
  const { tx, owner } = ctx;
  const rate = savingsRate(ctx.book);
  const savings = await tx<
    {
      id: string;
      number: string;
      balance: number;
      interestCarry: number;
      interestAccrued: number;
    }[]
  >`
    select a.id, a.number, b.credits - b.debits as balance, a.interest_carry, a.interest_accrued
    from bank.accounts a join bank.account_balances b on b.account_id = a.id
    where a.owner = ${owner} and a.kind = 'savings' and a.status <> 'closed'
    order by a.id for update of a`;
  let accrued = 0;
  const pay: { id: string; number: string; amount: number }[] = [];
  const monthEnds = isMonthEnd(date);
  for (const account of savings) {
    const day = dailyInterest(account.balance, rate, account.interestCarry);
    accrued += day.amount;
    const total = account.interestAccrued + day.amount;
    if (monthEnds && total > 0)
      pay.push({ id: account.id, number: account.number, amount: total });
    if (
      day.amount > 0 ||
      day.carry !== account.interestCarry ||
      (monthEnds && total > 0)
    ) {
      await tx`
        update bank.accounts set interest_carry = ${day.carry},
               interest_accrued = ${monthEnds ? 0 : total}
        where id = ${account.id}`;
    }
  }
  const payable = await gl(tx, owner, GL.interestPayable);
  if (accrued > 0) {
    await post(
      tx,
      owner,
      null,
      "interest_accrual",
      `Savings interest accrued for ${date}`,
      [
        {
          account: await gl(tx, owner, GL.interestExpense),
          dir: "D",
          amount: accrued,
        },
        { account: payable, dir: "C", amount: accrued },
      ],
      { entryDate: date },
    );
  }
  for (const item of pay) {
    await post(
      tx,
      owner,
      null,
      "interest_paid",
      "Savings interest",
      [
        { account: payable, dir: "D", amount: item.amount },
        { account: item.id, dir: "C", amount: item.amount },
      ],
      { entryDate: date },
    );
  }
  if (pay.length > 0) {
    await auditIn(
      tx,
      { owner, system: "End-of-day" },
      {
        action: "interest.paid",
        summary: `${date}: savings interest paid into ${pay.length} account(s), ${formatMoney(pay.reduce((sum, item) => sum + item.amount, 0))} in all`,
        detail: { date, accounts: pay.length, rateBps: rate },
      },
    );
  }
  return `${formatMoney(accrued)} interest accrued on ${savings.length} savings accounts${pay.length ? `, ${pay.length} paid` : ""}`;
}

async function matureTerms(ctx: Ctx, date: BankDate): Promise<string> {
  const { tx, owner } = ctx;
  const due = await tx<
    {
      id: string;
      number: string;
      customerId: string;
      rateBps: number;
      termMonths: number;
      payoutAccountId: string | null;
      balance: number;
    }[]
  >`
    select a.id, a.number, a.customer_id, a.rate_bps, a.term_months,
           a.payout_account_id, b.credits - b.debits as balance
    from bank.accounts a join bank.account_balances b on b.account_id = a.id
    where a.owner = ${owner} and a.kind = 'term' and a.status = 'open' and a.matures_on <= ${date}
    order by a.id for update of a`;
  let matured = 0;
  for (const term of due) {
    if (!term.payoutAccountId) continue;
    const payout = await accountById(tx, owner, term.payoutAccountId);
    // A closed payout account cannot take the money: the deposit waits.
    if (payout.status === "closed") continue;
    const interest = termInterest(term.balance, term.rateBps, term.termMonths);
    // No interest (a 0 rate, or a tiny deposit): an entry of zeros would not balance.
    if (interest > 0)
      await post(
        tx,
        owner,
        null,
        "interest_paid",
        `Term deposit interest, ${term.number}`,
        [
          {
            account: await gl(tx, owner, GL.interestExpense),
            dir: "D",
            amount: interest,
          },
          { account: term.id, dir: "C", amount: interest },
        ],
        { entryDate: date },
      );
    await post(
      tx,
      owner,
      null,
      "term_maturity",
      `Term deposit ${formatAccountNumber(term.number)} matured`,
      [
        { account: term.id, dir: "D", amount: term.balance + interest },
        { account: payout.id, dir: "C", amount: term.balance + interest },
      ],
      { entryDate: date, force: true },
    );
    await tx`update bank.accounts set status = 'closed', closed_on = ${date} where id = ${term.id}`;
    await notify(tx, owner, {
      customerId: term.customerId,
      kind: "account",
      title: "Your term deposit matured",
      body: `${formatMoney(term.balance)} plus ${formatMoney(interest)} interest was paid into ${formatAccountNumber(payout.number)}.`,
      fanout: false,
    });
    await auditIn(
      tx,
      { owner, system: "End-of-day" },
      {
        action: "term.matured",
        summary: `Term deposit ${term.number} matured: ${formatMoney(term.balance)} and ${formatMoney(interest)} interest paid out`,
        target: { kind: "account", id: term.id },
        detail: { principal: term.balance, interest },
      },
    );
    matured += 1;
  }
  return `${matured} term deposits matured`;
}

async function monthStatements(ctx: Ctx, date: BankDate): Promise<string> {
  if (!isMonthEnd(date)) return "Not a month end: no statements";
  const { tx, owner } = ctx;
  const accounts = await tx<{ id: string }[]>`
    select id from bank.accounts
    where owner = ${owner} and kind in ('current', 'savings')
      and opened_on <= ${date} and (closed_on is null or closed_on >= ${monthStart(date)})`;
  for (const account of accounts) {
    await generateStatement(tx, owner, account.id, monthStart(date), date);
  }
  await auditIn(
    tx,
    { owner, system: "End-of-day" },
    {
      action: "statement.generated",
      summary: `${date}: ${accounts.length} monthly statement(s) generated`,
      detail: { date, statements: accounts.length },
    },
  );
  return `${accounts.length} monthly statements generated`;
}

/** Proves the books before the day is closed: balanced and reconciled, or the day does not close. */
async function closeDay(ctx: Ctx, date: BankDate): Promise<string> {
  const { tx, owner } = ctx;
  const [totals] = await tx<{ debits: number; credits: number }[]>`
    select coalesce(sum(debits), 0)::bigint as debits, coalesce(sum(credits), 0)::bigint as credits
    from bank.account_balances where owner = ${owner}`;
  const problems = await tx`select 1 from bank.reconcile(${owner}) limit 1`;
  if (!totals || totals.debits !== totals.credits || problems.length > 0) {
    throw new Error(`End-of-day ${date}: the books do not reconcile`);
  }
  await tx`
    update bank.banks set eod_through = ${date}
    where owner = ${owner} and (eod_through is null or eod_through < ${date})`;
  await auditIn(
    tx,
    { owner, system: "End-of-day" },
    {
      action: "eod.completed",
      summary: `End-of-day ${date} closed: trial balance ${formatMoney(totals.debits)} each side, reconciled`,
      target: { kind: "bank", id: owner },
      detail: { date, debits: totals.debits, credits: totals.credits },
    },
  );
  return `Closed: trial balance ${formatMoney(totals.debits)} each side, reconciled`;
}
