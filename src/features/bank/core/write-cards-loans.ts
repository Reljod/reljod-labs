import { randomBytes } from "node:crypto";
import type { Owner } from "@/features/access/domain/owner";
import { cardLimitsRefusal, checkCardAuth, decideLoan } from "../domain/checks";
import type { CommandInput } from "../domain/commands";
import { addDays, addMonths, type BankDate, monthEnd } from "../domain/dates";
import { amortise } from "../domain/lending";
import { LIMITS } from "../domain/limits";
import { formatMoney } from "../domain/money";
import {
  accountNumber,
  cardLastFour,
  formatAccountNumber,
  loanNumber,
  maskedCard,
} from "../domain/numbers";
import { bool, num } from "../domain/rules";
import type { Actor } from "./actor";
import { auditIn } from "./audit";
import type { Db } from "./db";
import {
  InvalidError,
  LimitError,
  NotFoundError,
  RuleRefusedError,
  StateError,
} from "./errors";
import {
  type Ctx,
  endHold,
  enqueue,
  GL,
  gl,
  lock,
  nextSeq,
  notify,
  placeHold,
  post,
  type WriteHandler,
} from "./ledger";
import { accountById } from "./reads";
import { customerRow } from "./write-customers";

// Cards ------------------------------------------------------------------------

type CardRow = {
  id: string;
  customerId: string;
  accountId: string;
  lastFour: string;
  status: "active" | "frozen" | "cancelled";
  perTransactionLimit: number;
  dailyLimit: number;
  expiresOn: BankDate;
  onlineEnabled: boolean;
};

async function cardRow(ctx: Ctx, cardId: string): Promise<CardRow> {
  const [card] = await ctx.tx<CardRow[]>`
    select id, customer_id, account_id, last_four, status,
           per_transaction_limit, daily_limit, expires_on, online_enabled
    from bank.cards where owner = ${ctx.owner} and id = ${cardId}`;
  if (!card) throw new NotFoundError("That card is not in this bank.");
  return card;
}

export const issueCard: WriteHandler<CommandInput<"issue_card">> = {
  async run(ctx, input) {
    const account = await accountById(ctx.tx, ctx.owner, input.accountId);
    if (account.kind !== "current" || !account.customerId) {
      throw new InvalidError("A debit card is issued on a current account.");
    }
    if (account.status !== "open")
      throw new StateError(`That account is ${account.status}.`);
    const customer = await customerRow(ctx, account.customerId);
    if (
      customer.kycStatus !== "verified" &&
      !bool(ctx.book, "limits.kyc", "pendingMayBorrow")
    ) {
      throw new RuleRefusedError({
        ruleId: "limits.kyc",
        version: ctx.book["limits.kyc"].version,
        outcome: "refuse",
        message: "A card needs a verified identity.",
        facts: { kycStatus: customer.kycStatus },
      });
    }
    const [count] = await ctx.tx<{ count: number }[]>`
      select count(*)::int as count from bank.cards
      where owner = ${ctx.owner} and account_id = ${account.id} and status <> 'cancelled'`;
    if ((count?.count ?? 0) >= LIMITS.cardsPerAccount) {
      throw new LimitError(
        `An account holds at most ${LIMITS.cardsPerAccount} cards.`,
      );
    }
    const lastFour = cardLastFour(await nextSeq(ctx.tx, ctx.owner, "card"));
    // The card is this random token. No card number is generated or kept.
    const token = `tok_${randomBytes(16).toString("hex")}`;
    const expiresOn = monthEnd(addMonths(ctx.today, 36));
    const [row] = await ctx.tx<{ id: string }[]>`
      insert into bank.cards (
        owner, customer_id, account_id, token, last_four, name_on_card,
        expires_on, per_transaction_limit, daily_limit, issued_on
      ) values (
        ${ctx.owner}, ${customer.id}, ${account.id}, ${token}, ${lastFour},
        ${customer.name.toUpperCase().slice(0, 26)}, ${expiresOn},
        ${num(ctx.book, "cards.limits", "perTransaction")},
        ${num(ctx.book, "cards.limits", "perDay")}, ${ctx.today}
      ) returning id`;
    if (!row) throw new Error("The card was not issued");
    await auditIn(
      ctx.tx,
      { actor: ctx.actor },
      {
        action: "issue_card",
        summary: `Issued a debit card ending ${lastFour} on ${account.number}`,
        target: { kind: "card", id: row.id },
        detail: { lastFour, account: account.number },
      },
    );
    await notify(ctx.tx, ctx.owner, {
      customerId: customer.id,
      kind: "card",
      title: "Your new debit card",
      body: `Card ${maskedCard(lastFour)} is ready to use.`,
    });
    return {
      message: `Issued debit card ${maskedCard(lastFour)} on ${formatAccountNumber(account.number)}.`,
      result: { cardId: row.id, lastFour, expiresOn },
    };
  },
};

export const setCardStatus: WriteHandler<CommandInput<"set_card_status">> = {
  async describe(ctx, input) {
    const card = await cardRow(ctx, input.cardId);
    return `Cancel card ${maskedCard(card.lastFour)} for good`;
  },
  async run(ctx, input) {
    const card = await cardRow(ctx, input.cardId);
    if (card.status === "cancelled")
      throw new StateError("A cancelled card cannot be changed.");
    if (card.status === input.status)
      throw new StateError(`That card is already ${input.status}.`);
    await ctx.tx`
      update bank.cards set status = ${input.status}
      where owner = ${ctx.owner} and id = ${card.id}`;
    await auditIn(
      ctx.tx,
      { actor: ctx.actor },
      {
        action: "set_card_status",
        summary: `Card ending ${card.lastFour} is now ${input.status}`,
        target: { kind: "card", id: card.id },
        detail: { status: input.status, was: card.status },
      },
    );
    return {
      message: `Card ${maskedCard(card.lastFour)} is now ${input.status}.`,
      result: { cardId: card.id, status: input.status },
    };
  },
};

export const setCardLimits: WriteHandler<CommandInput<"set_card_limits">> = {
  async describe(ctx, input) {
    const card = await cardRow(ctx, input.cardId);
    return `Set card ${maskedCard(card.lastFour)} to ${formatMoney(input.perTransaction)} a purchase and ${formatMoney(input.perDay)} a day`;
  },
  async run(ctx, input) {
    const card = await cardRow(ctx, input.cardId);
    if (card.status === "cancelled")
      throw new StateError("A cancelled card cannot be changed.");
    const refusal = cardLimitsRefusal(
      ctx.book,
      input.perTransaction,
      input.perDay,
    );
    if (refusal) throw new InvalidError(refusal);
    await ctx.tx`
      update bank.cards set per_transaction_limit = ${input.perTransaction},
             daily_limit = ${input.perDay},
             online_enabled = coalesce(${input.onlineEnabled ?? null}, online_enabled)
      where owner = ${ctx.owner} and id = ${card.id}`;
    await auditIn(
      ctx.tx,
      { actor: ctx.actor },
      {
        action: "set_card_limits",
        summary: `Limits of card ending ${card.lastFour}: ${formatMoney(input.perTransaction)} a purchase, ${formatMoney(input.perDay)} a day`,
        target: { kind: "card", id: card.id },
        detail: {
          perTransaction: input.perTransaction,
          perDay: input.perDay,
          onlineEnabled: input.onlineEnabled ?? card.onlineEnabled,
        },
      },
    );
    return {
      message: `Card ${maskedCard(card.lastFour)} may now spend ${formatMoney(input.perTransaction)} at a time and ${formatMoney(input.perDay)} a day.`,
      result: { cardId: card.id },
    };
  },
};

export const cardPurchase: WriteHandler<CommandInput<"card_purchase">> = {
  async run(ctx, input) {
    const card = await cardRow(ctx, input.cardId);
    // The decision and the hold are made under the account's lock, so two
    // purchases at once cannot both spend the same money.
    await lock(ctx.tx, ctx.owner, [card.accountId]);
    const account = await accountById(ctx.tx, ctx.owner, card.accountId);
    const [spent] = await ctx.tx<{ spent: number }[]>`
      select coalesce(sum(amount), 0)::bigint as spent from bank.card_authorisations
      where owner = ${ctx.owner} and card_id = ${card.id}
        and authorised_on = ${ctx.today} and status in ('authorised', 'settled')`;
    const decision = checkCardAuth(ctx.book, {
      amount: input.amount,
      channel: input.channel,
      category: input.category,
      today: ctx.today,
      card,
      account: { status: account.status, available: account.available },
      spentToday: spent?.spent ?? 0,
    });
    const authId = crypto.randomUUID();
    let holdId: string | null = null;
    if (decision.approved) {
      holdId = await placeHold(ctx.tx, ctx.owner, {
        accountId: account.id,
        amount: input.amount,
        kind: "card",
        ref: authId,
        expiresOn: addDays(
          ctx.today,
          num(ctx.book, "cards.limits", "authDays"),
        ),
      });
    }
    await ctx.tx`
      insert into bank.card_authorisations (
        id, owner, card_id, account_id, merchant, category, channel, amount,
        status, decline_code, decline_reason, hold_id, authorised_on
      ) values (
        ${authId}, ${ctx.owner}, ${card.id}, ${account.id}, ${input.merchant},
        ${input.category}, ${input.channel}, ${input.amount},
        ${decision.approved ? "authorised" : "declined"},
        ${decision.approved ? null : decision.code},
        ${decision.approved ? null : decision.reason},
        ${holdId}, ${ctx.today}
      )`;
    await auditIn(
      ctx.tx,
      { actor: ctx.actor },
      {
        action: "card_purchase",
        summary: decision.approved
          ? `Authorised ${formatMoney(input.amount)} at ${input.merchant} on card ending ${card.lastFour}`
          : `Declined ${formatMoney(input.amount)} at ${input.merchant} on card ending ${card.lastFour}: ${decision.code} ${decision.reason}`,
        target: { kind: "card_authorisation", id: authId },
        detail: {
          amount: input.amount,
          merchant: input.merchant,
          channel: input.channel,
          finding: decision.finding,
        },
      },
    );
    if (!decision.approved) {
      await notify(ctx.tx, ctx.owner, {
        customerId: card.customerId,
        kind: "card",
        title: "A card payment was declined",
        body: `${formatMoney(input.amount)} at ${input.merchant}: ${decision.reason}.`,
      });
    }
    return {
      message: decision.approved
        ? `Authorised ${formatMoney(input.amount)} at ${input.merchant}. The money is held until the purchase settles.`
        : `Declined (code ${decision.code}): ${decision.reason}.`,
      result: {
        authorisationId: authId,
        status: decision.approved ? "authorised" : "declined",
        declineCode: decision.approved ? null : decision.code,
        declineReason: decision.approved ? null : decision.reason,
      },
    };
  },
};

type AuthRow = {
  id: string;
  cardId: string;
  accountId: string;
  merchant: string;
  amount: number;
  status: string;
  holdId: string | null;
  customerId: string;
};

/** Settles one authorised purchase: its hold is captured by the posting. */
export async function settleAuthorisation(
  db: Db,
  owner: Owner,
  actor: Actor | null,
  auth: AuthRow,
  today: BankDate,
): Promise<number> {
  const entryId = await post(
    db,
    owner,
    actor,
    "card_settle",
    `Card: ${auth.merchant}`,
    [
      { account: auth.accountId, dir: "D", amount: auth.amount },
      {
        account: await gl(db, owner, GL.cardSettlement),
        dir: "C",
        amount: auth.amount,
      },
    ],
    {
      ...(auth.holdId ? { captureHold: auth.holdId } : {}),
      // Authorised money is the merchant's: it settles even from a frozen account.
      allowFrozen: true,
      ref: { cardAuthId: auth.id },
    },
  );
  await db`
    update bank.card_authorisations
    set status = 'settled', settled_on = ${today}, entry_id = ${entryId}
    where id = ${auth.id}`;
  return entryId;
}

async function authRow(ctx: Ctx, authId: string): Promise<AuthRow> {
  const [auth] = await ctx.tx<AuthRow[]>`
    select x.id, x.card_id, x.account_id, x.merchant, x.amount, x.status,
           x.hold_id, k.customer_id
    from bank.card_authorisations x join bank.cards k on k.id = x.card_id
    where x.owner = ${ctx.owner} and x.id = ${authId} for update of x`;
  if (!auth) throw new NotFoundError("That card purchase is not in this bank.");
  if (auth.status !== "authorised") {
    throw new StateError(
      `That purchase is ${auth.status}, not waiting to settle.`,
    );
  }
  return auth;
}

export const settleCardPurchase: WriteHandler<
  CommandInput<"settle_card_purchase">
> = {
  async run(ctx, input) {
    const auth = await authRow(ctx, input.authorisationId);
    const entryId = await settleAuthorisation(
      ctx.tx,
      ctx.owner,
      ctx.actor,
      auth,
      ctx.today,
    );
    await auditIn(
      ctx.tx,
      { actor: ctx.actor },
      {
        action: "settle_card_purchase",
        summary: `Settled ${formatMoney(auth.amount)} at ${auth.merchant}`,
        target: { kind: "card_authorisation", id: auth.id },
        detail: { amount: auth.amount, entryId },
      },
    );
    return {
      message: `Settled ${formatMoney(auth.amount)} at ${auth.merchant}: the hold became a posted transaction.`,
      result: { authorisationId: auth.id, status: "settled", entryId },
    };
  },
};

export const reverseCardPurchase: WriteHandler<
  CommandInput<"reverse_card_purchase">
> = {
  async run(ctx, input) {
    const auth = await authRow(ctx, input.authorisationId);
    if (auth.holdId) await endHold(ctx.tx, ctx.owner, auth.holdId, "released");
    await ctx.tx`
      update bank.card_authorisations set status = 'reversed' where id = ${auth.id}`;
    await auditIn(
      ctx.tx,
      { actor: ctx.actor },
      {
        action: "reverse_card_purchase",
        summary: `Authorisation of ${formatMoney(auth.amount)} at ${auth.merchant} reversed`,
        target: { kind: "card_authorisation", id: auth.id },
        detail: { amount: auth.amount },
      },
    );
    return {
      message: `Reversed the authorisation of ${formatMoney(auth.amount)} at ${auth.merchant}; the hold is released.`,
      result: { authorisationId: auth.id, status: "reversed" },
    };
  },
};

// Loans ------------------------------------------------------------------------

type LoanRow = {
  id: string;
  customerId: string;
  number: string;
  principal: number;
  rateBps: number;
  termMonths: number;
  monthlyPayment: number;
  status: string;
  loanAccountId: string | null;
  disburseAccountId: string;
  arrears: number;
};

export async function loanRow(
  db: Db,
  owner: Owner,
  loanId: string,
  forUpdate = true,
): Promise<LoanRow> {
  const [loan] = await db<LoanRow[]>`
    select id, customer_id, number, principal, rate_bps, term_months,
           monthly_payment, status, loan_account_id, disburse_account_id, arrears
    from bank.loans where owner = ${owner} and id = ${loanId}
    ${forUpdate ? db`for update` : db``}`;
  if (!loan) throw new NotFoundError("That loan is not in this bank.");
  return loan;
}

export const applyForLoan: WriteHandler<CommandInput<"apply_for_loan">> = {
  async run(ctx, input) {
    const customer = await customerRow(ctx, input.customerId);
    const account = await accountById(
      ctx.tx,
      ctx.owner,
      input.disburseAccountId,
    );
    if (
      account.customerId !== customer.id ||
      account.kind !== "current" ||
      account.status !== "open"
    ) {
      throw new InvalidError(
        "A loan is paid into, and repaid from, the customer's own open current account.",
      );
    }
    const [facts] = await ctx.tx<
      { loans: number; repayments: number; inArrears: boolean }[]
    >`
      select count(*)::int as loans,
             coalesce(sum(monthly_payment) filter (where status in ('accepted', 'active', 'arrears')), 0)::bigint as repayments,
             coalesce(bool_or(status = 'arrears'), false) as in_arrears
      from bank.loans where owner = ${ctx.owner} and customer_id = ${customer.id}`;
    if ((facts?.loans ?? 0) >= LIMITS.loansPerCustomer) {
      throw new LimitError(
        `A customer may have at most ${LIMITS.loansPerCustomer} loan applications on file.`,
      );
    }
    const decision = decideLoan(ctx.book, {
      amount: input.amount,
      termMonths: input.termMonths,
      monthlyIncome: input.monthlyIncome,
      monthlyExpenses: input.monthlyExpenses,
      existingRepayments: facts?.repayments ?? 0,
      kycStatus: customer.kycStatus,
      risk: customer.risk,
      inArrears: facts?.inArrears ?? false,
    });
    const number = loanNumber(await nextSeq(ctx.tx, ctx.owner, "loan"));
    const [row] = await ctx.tx<{ id: string }[]>`
      insert into bank.loans (
        owner, customer_id, number, purpose, principal, rate_bps, term_months,
        monthly_payment, declared_income, declared_expenses, status, decision,
        disburse_account_id, applied_on
      ) values (
        ${ctx.owner}, ${customer.id}, ${number}, ${input.purpose}, ${input.amount},
        ${decision.rateBps}, ${input.termMonths}, ${decision.monthlyPayment},
        ${input.monthlyIncome}, ${input.monthlyExpenses},
        ${decision.approved ? "offered" : "declined"},
        ${ctx.tx.json({ approved: decision.approved, findings: decision.findings } as never)},
        ${account.id}, ${ctx.today}
      ) returning id`;
    if (!row) throw new Error("The application was not saved");
    await auditIn(
      ctx.tx,
      { actor: ctx.actor },
      {
        action: "apply_for_loan",
        summary: `Loan ${number} for ${customer.name}: ${formatMoney(input.amount)} over ${input.termMonths} months ${decision.approved ? "offered" : "declined"} by the affordability Rules`,
        target: { kind: "loan", id: row.id },
        detail: {
          amount: input.amount,
          approved: decision.approved,
          rateBps: decision.rateBps,
          findings: decision.findings,
        },
      },
    );
    const failed = decision.findings.filter((item) => item.outcome !== "pass");
    await notify(ctx.tx, ctx.owner, {
      customerId: customer.id,
      kind: "loan",
      title: decision.approved
        ? "Your loan offer"
        : "About your loan application",
      body: decision.approved
        ? `${formatMoney(input.amount)} over ${input.termMonths} months at ${(decision.rateBps / 100).toFixed(2)}%: ${formatMoney(decision.monthlyPayment)} a month.`
        : `We cannot offer this loan. ${failed.map((item) => item.message).join(" ")}`,
    });
    return {
      message: decision.approved
        ? `Offered: ${formatMoney(input.amount)} over ${input.termMonths} months at ${(decision.rateBps / 100).toFixed(2)}% a year, ${formatMoney(decision.monthlyPayment)} a month. Accept the offer to have it paid out.`
        : `Declined by the affordability Rules. ${failed.map((item) => item.message).join(" ")}`,
      result: {
        loanId: row.id,
        number,
        status: decision.approved ? "offered" : "declined",
        rateBps: decision.rateBps,
        monthlyPayment: decision.monthlyPayment,
        findings: decision.findings,
      },
    };
  },
};

export const acceptLoan: WriteHandler<CommandInput<"accept_loan">> = {
  async describe(ctx, input) {
    const loan = await loanRow(ctx.tx, ctx.owner, input.loanId, false);
    return `Accept loan ${loan.number}: ${formatMoney(loan.principal)} over ${loan.termMonths} months, ${formatMoney(loan.monthlyPayment)} a month`;
  },
  async run(ctx, input) {
    const loan = await loanRow(ctx.tx, ctx.owner, input.loanId);
    if (loan.status !== "offered")
      throw new StateError(`That loan is ${loan.status}, not an open offer.`);
    await ctx.tx`update bank.loans set status = 'accepted' where id = ${loan.id}`;
    await enqueue(ctx.tx, ctx.owner, "loan.disburse", { loanId: loan.id });
    await auditIn(
      ctx.tx,
      { actor: ctx.actor },
      {
        action: "accept_loan",
        summary: `Loan ${loan.number} accepted; disbursement queued`,
        target: { kind: "loan", id: loan.id },
        detail: { principal: loan.principal },
      },
    );
    return {
      message: `Accepted loan ${loan.number}. A Workflow is paying ${formatMoney(loan.principal)} into the account and building the repayment schedule.`,
      result: { loanId: loan.id, status: "accepted" },
    };
  },
};

/**
 * Pays a loan out: opens its loan account (an asset of the bank), posts the
 * principal to the customer and writes the schedule. Idempotent: a loan that
 * is no longer `accepted` is left alone. Run by the disbursement Workflow.
 */
export async function disburseLoan(
  db: Db,
  owner: Owner,
  loanId: string,
  today: BankDate,
): Promise<{
  disbursed: boolean;
  reason?: string;
  number: string;
  customerId: string;
  principal: number;
}> {
  const loan = await loanRow(db, owner, loanId);
  const base = {
    number: loan.number,
    customerId: loan.customerId,
    principal: loan.principal,
  };
  if (loan.status !== "accepted")
    return { ...base, disbursed: false, reason: `The loan is ${loan.status}` };
  await lock(db, owner, [loan.disburseAccountId]);
  const account = await accountById(db, owner, loan.disburseAccountId);
  if (account.status !== "open") {
    await db`update bank.loans set status = 'withdrawn' where id = ${loan.id}`;
    return {
      ...base,
      disbursed: false,
      reason: `Account ${account.number} is ${account.status}`,
    };
  }
  const number = accountNumber(
    "loan",
    await nextSeq(db, owner, "account:loan"),
  );
  const [loanAccount] = await db<{ id: string }[]>`
    insert into bank.accounts (owner, customer_id, number, kind, normal_side, name, rate_bps, term_months, opened_on)
    values (${owner}, ${loan.customerId}, ${number}, 'loan', 'D', ${`Loan ${loan.number}`},
            ${loan.rateBps}, ${loan.termMonths}, ${today})
    returning id`;
  if (!loanAccount) throw new Error("The loan account was not opened");
  const entryId = await post(
    db,
    owner,
    null,
    "loan_disbursement",
    `Loan ${loan.number} paid out`,
    [
      { account: loanAccount.id, dir: "D", amount: loan.principal },
      { account: account.id, dir: "C", amount: loan.principal },
    ],
    { ref: { loanId: loan.id } },
  );
  const schedule = amortise(
    loan.principal,
    loan.rateBps,
    loan.termMonths,
    today,
    loan.monthlyPayment,
  );
  await db`
    insert into bank.loan_instalments ${db(
      schedule.map((item) => ({
        loan_id: loan.id,
        owner,
        n: item.n,
        due_on: item.dueOn,
        principal: item.principal,
        interest: item.interest,
        payment: item.payment,
        balance_after: item.balanceAfter,
      })),
    )}`;
  await db`
    update bank.loans set status = 'active', loan_account_id = ${loanAccount.id}, disbursed_on = ${today}
    where id = ${loan.id}`;
  await auditIn(
    db,
    { owner, system: "Loan disbursement" },
    {
      action: "loan.disbursed",
      summary: `Loan ${loan.number}: ${formatMoney(loan.principal)} paid into ${account.number}; ${schedule.length} instalments scheduled`,
      target: { kind: "loan", id: loan.id },
      detail: {
        principal: loan.principal,
        entryId,
        instalments: schedule.length,
      },
    },
  );
  return { ...base, disbursed: true };
}

type InstalmentRow = {
  n: number;
  dueOn: BankDate;
  principal: number;
  interest: number;
  payment: number;
  status: "due" | "paid" | "missed";
};

/** Posts one instalment: principal to the loan account, interest to income. */
export async function payInstalment(
  db: Db,
  owner: Owner,
  actor: Actor | null,
  loan: LoanRow,
  instalment: InstalmentRow,
  today: BankDate,
): Promise<number> {
  const entryId = await post(
    db,
    owner,
    actor,
    "loan_repayment",
    `Loan ${loan.number} instalment ${instalment.n}`,
    [
      { account: loan.disburseAccountId, dir: "D", amount: instalment.payment },
      {
        account: loan.loanAccountId as string,
        dir: "C",
        amount: instalment.principal,
      },
      {
        account: await gl(db, owner, GL.loanInterest),
        dir: "C",
        amount: instalment.interest,
      },
    ],
    { ref: { loanId: loan.id } },
  );
  await db`
    update bank.loan_instalments set status = 'paid', paid_on = ${today}, entry_id = ${entryId}
    where loan_id = ${loan.id} and n = ${instalment.n}`;
  return entryId;
}

/** Brings a loan's arrears and status in line with its instalments. */
export async function settleLoanState(db: Db, loan: LoanRow, today: BankDate) {
  const [state] = await db<
    { arrears: number; open: number; outstanding: number }[]
  >`
    select coalesce(sum(i.payment) filter (where i.status = 'missed'), 0)::bigint as arrears,
           count(*) filter (where i.status <> 'paid')::int as open,
           (select b.debits - b.credits from bank.account_balances b
             where b.account_id = ${loan.loanAccountId}) as outstanding
    from bank.loan_instalments i where i.loan_id = ${loan.id}`;
  const closed = (state?.outstanding ?? 0) <= 0;
  await db`
    update bank.loans set arrears = ${state?.arrears ?? 0},
      status = ${closed ? "closed" : (state?.arrears ?? 0) > 0 ? "arrears" : "active"},
      closed_on = ${closed ? today : null}
    where id = ${loan.id}`;
  if (closed) {
    await db`delete from bank.loan_instalments where loan_id = ${loan.id} and status <> 'paid'`;
    await db`update bank.accounts set status = 'closed', closed_on = ${today} where id = ${loan.loanAccountId}`;
  }
  return {
    closed,
    arrears: state?.arrears ?? 0,
    outstanding: Math.max(0, state?.outstanding ?? 0),
  };
}

export const repayLoan: WriteHandler<CommandInput<"repay_loan">> = {
  async describe(ctx, input) {
    const loan = await loanRow(ctx.tx, ctx.owner, input.loanId, false);
    return `Pay ${formatMoney(input.amount)} towards loan ${loan.number}`;
  },
  async run(ctx, input) {
    const loan = await loanRow(ctx.tx, ctx.owner, input.loanId);
    if (!["active", "arrears"].includes(loan.status) || !loan.loanAccountId) {
      throw new StateError(
        `That loan is ${loan.status}; there is nothing to repay.`,
      );
    }
    await lock(ctx.tx, ctx.owner, [loan.disburseAccountId, loan.loanAccountId]);
    const account = await accountById(
      ctx.tx,
      ctx.owner,
      loan.disburseAccountId,
    );
    if (account.status !== "open")
      throw new StateError(`Account ${account.number} is ${account.status}.`);
    if (account.available < input.amount) {
      throw new InvalidError(
        `Not enough available in ${formatAccountNumber(account.number)}: ${formatMoney(account.available)}.`,
      );
    }
    const unpaid = await ctx.tx<InstalmentRow[]>`
      select n, due_on, principal, interest, payment, status
      from bank.loan_instalments
      where loan_id = ${loan.id} and status <> 'paid' order by n`;
    let remaining = input.amount;
    let paid = 0;
    const left: InstalmentRow[] = [];
    for (const instalment of unpaid) {
      // Instalments already due are paid whole, oldest first. Anything more
      // comes off the principal, so paying early never pays interest that
      // has not been earned yet.
      const owed =
        instalment.status === "missed" || instalment.dueOn <= ctx.today;
      if (left.length === 0 && owed && remaining >= instalment.payment) {
        await payInstalment(
          ctx.tx,
          ctx.owner,
          ctx.actor,
          loan,
          instalment,
          ctx.today,
        );
        remaining -= instalment.payment;
        paid += 1;
      } else left.push(instalment);
    }
    let overpaid = 0;
    if (remaining > 0 && left[0]?.status === "missed") {
      throw new InvalidError(
        `Clear the missed instalment first: pay at least ${formatMoney(input.amount - remaining + left[0].payment)}.`,
      );
    }
    if (remaining > 0 && left.length > 0) {
      const outstanding = left.reduce((sum, item) => sum + item.principal, 0);
      if (remaining > outstanding) {
        throw new InvalidError(
          `That is more than the loan needs. ${formatMoney(input.amount - remaining + outstanding)} clears it.`,
        );
      }
      overpaid = remaining;
      await post(
        ctx.tx,
        ctx.owner,
        ctx.actor,
        "loan_repayment",
        `Loan ${loan.number} overpayment`,
        [
          { account: loan.disburseAccountId, dir: "D", amount: overpaid },
          { account: loan.loanAccountId, dir: "C", amount: overpaid },
        ],
        { ref: { loanId: loan.id } },
      );
      // The same monthly payment over a shorter term: rebuild what is left.
      const first = left[0] as InstalmentRow;
      await ctx.tx`delete from bank.loan_instalments where loan_id = ${loan.id} and status <> 'paid'`;
      const rebuilt = amortise(
        outstanding - overpaid,
        loan.rateBps,
        left.length,
        addMonths(first.dueOn, -1),
        loan.monthlyPayment,
      );
      if (rebuilt.length > 0) {
        await ctx.tx`
          insert into bank.loan_instalments ${ctx.tx(
            rebuilt.map((item, index) => ({
              loan_id: loan.id,
              owner: ctx.owner,
              n: first.n + index,
              due_on: item.dueOn,
              principal: item.principal,
              interest: item.interest,
              payment: item.payment,
              balance_after: item.balanceAfter,
            })),
          )}`;
      }
    } else if (remaining > 0) {
      throw new InvalidError("That is more than the loan needs.");
    }
    const state = await settleLoanState(ctx.tx, loan, ctx.today);
    await auditIn(
      ctx.tx,
      { actor: ctx.actor },
      {
        action: "repay_loan",
        summary: `Paid ${formatMoney(input.amount)} towards loan ${loan.number}: ${paid} instalment(s)${overpaid ? `, ${formatMoney(overpaid)} off the principal` : ""}`,
        target: { kind: "loan", id: loan.id },
        detail: {
          amount: input.amount,
          instalments: paid,
          overpaid,
          outstanding: state.outstanding,
          closed: state.closed,
        },
      },
    );
    return {
      message: state.closed
        ? `Paid ${formatMoney(input.amount)}. Loan ${loan.number} is repaid in full and closed.`
        : `Paid ${formatMoney(input.amount)} towards loan ${loan.number}: ${paid} instalment(s)${overpaid ? ` and ${formatMoney(overpaid)} off the principal, which shortens the term` : ""}. ${formatMoney(state.outstanding)} is still owed.`,
      result: {
        loanId: loan.id,
        instalmentsPaid: paid,
        overpaid,
        outstanding: state.outstanding,
        closed: state.closed,
      },
    };
  },
};
