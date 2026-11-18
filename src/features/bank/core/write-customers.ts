import { savingsRate, termRate, termRefusal } from "../domain/checks";
import type { CommandInput } from "../domain/commands";
import { addMonths, formatDate } from "../domain/dates";
import { LIMITS } from "../domain/limits";
import { formatMoney } from "../domain/money";
import {
  accountNumber,
  customerNumber,
  formatAccountNumber,
} from "../domain/numbers";
import { bool } from "../domain/rules";
import { auditIn } from "./audit";
import { InvalidError, LimitError, NotFoundError, StateError } from "./errors";
import {
  type Ctx,
  GL,
  gl,
  lock,
  nextSeq,
  notify,
  post,
  type WriteHandler,
} from "./ledger";
import { accountById } from "./reads";

type CustomerRow = {
  id: string;
  number: string;
  name: string;
  kycStatus: "pending" | "verified" | "rejected";
  risk: "low" | "standard" | "high";
  monthlyIncome: number;
};

export async function customerRow(
  ctx: Ctx,
  customerId: string,
): Promise<CustomerRow> {
  const [customer] = await ctx.tx<CustomerRow[]>`
    select id, number, name, kyc_status, risk, monthly_income
    from bank.customers where owner = ${ctx.owner} and id = ${customerId}`;
  if (!customer) throw new NotFoundError("That customer is not in this bank.");
  return customer;
}

export const openCustomer: WriteHandler<CommandInput<"open_customer">> = {
  async run(ctx, input) {
    const [count] = await ctx.tx<{ count: number }[]>`
      select count(*)::int as count from bank.customers where owner = ${ctx.owner}`;
    if ((count?.count ?? 0) >= LIMITS.customersPerBank) {
      throw new LimitError(
        `This bank holds at most ${LIMITS.customersPerBank} customers.`,
      );
    }
    if (input.dateOfBirth > addMonths(ctx.today, -18 * 12)) {
      throw new InvalidError("A customer must be at least 18.");
    }
    const number = customerNumber(await nextSeq(ctx.tx, ctx.owner, "customer"));
    const [row] = await ctx.tx<{ id: string }[]>`
      insert into bank.customers (
        owner, number, name, email, phone, address, date_of_birth, occupation,
        monthly_income
      ) values (
        ${ctx.owner}, ${number}, ${input.name}, ${input.email}, ${input.phone},
        ${input.address}, ${input.dateOfBirth}, ${input.occupation},
        ${input.monthlyIncome}
      ) returning id`;
    if (!row) throw new Error("The customer was not saved");
    await auditIn(
      ctx.tx,
      { actor: ctx.actor },
      {
        action: "open_customer",
        summary: `Opened customer ${input.name} (${number}); identity pending`,
        target: { kind: "customer", id: row.id },
        detail: { number },
      },
    );
    await notify(ctx.tx, ctx.owner, {
      customerId: row.id,
      kind: "welcome",
      title: "Welcome to Tidewater Bank",
      body: `Your customer number is ${number}. We are verifying your identity; until then some limits apply.`,
    });
    return {
      message: `Opened ${input.name} as customer ${number}. Their identity check is pending.`,
      result: { customerId: row.id, number },
    };
  },
};

export const updateCustomer: WriteHandler<CommandInput<"update_customer">> = {
  async run(ctx, input) {
    const customer = await customerRow(ctx, input.customerId);
    const changed = (
      ["email", "phone", "address", "occupation", "monthlyIncome"] as const
    ).filter((key) => input[key] !== undefined);
    if (changed.length === 0) throw new InvalidError("Nothing to change.");
    await ctx.tx`
      update bank.customers set
        email = coalesce(${input.email ?? null}, email),
        phone = coalesce(${input.phone ?? null}, phone),
        address = coalesce(${input.address ?? null}, address),
        occupation = coalesce(${input.occupation ?? null}, occupation),
        monthly_income = coalesce(${input.monthlyIncome ?? null}, monthly_income)
      where owner = ${ctx.owner} and id = ${customer.id}`;
    await auditIn(
      ctx.tx,
      { actor: ctx.actor },
      {
        action: "update_customer",
        summary: `Updated ${customer.name}'s ${changed.join(", ")}`,
        target: { kind: "customer", id: customer.id },
        detail: { changed },
      },
    );
    return {
      message: `Updated ${customer.name}'s ${changed.join(", ")}.`,
      result: { customerId: customer.id, changed },
    };
  },
};

export const decideKyc: WriteHandler<CommandInput<"decide_kyc">> = {
  async describe(ctx, input) {
    const customer = await customerRow(ctx, input.customerId);
    return `Mark ${customer.name}'s identity as ${input.decision}`;
  },
  async run(ctx, input) {
    const customer = await customerRow(ctx, input.customerId);
    if (customer.kycStatus === input.decision) {
      throw new StateError(
        `${customer.name}'s identity is already ${input.decision}.`,
      );
    }
    await ctx.tx`
      update bank.customers set kyc_status = ${input.decision}, kyc_note = ${input.note}
      where owner = ${ctx.owner} and id = ${customer.id}`;
    await auditIn(
      ctx.tx,
      { actor: ctx.actor },
      {
        action: "decide_kyc",
        summary: `Identity of ${customer.name} ${input.decision}`,
        target: { kind: "customer", id: customer.id },
        detail: {
          decision: input.decision,
          note: input.note,
          was: customer.kycStatus,
        },
      },
    );
    await notify(ctx.tx, ctx.owner, {
      customerId: customer.id,
      kind: "kyc",
      title:
        input.decision === "verified"
          ? "Your identity is verified"
          : "We could not verify your identity",
      body:
        input.decision === "verified"
          ? "The limits for unverified customers no longer apply to you."
          : "Please visit a branch with your documents.",
    });
    return {
      message: `${customer.name}'s identity is now ${input.decision}.`,
      result: { customerId: customer.id, kycStatus: input.decision },
    };
  },
};

async function openAccounts(ctx: Ctx, customerId: string): Promise<number> {
  const [row] = await ctx.tx<{ count: number }[]>`
    select count(*)::int as count from bank.accounts
    where owner = ${ctx.owner} and customer_id = ${customerId}
      and kind <> 'loan' and status <> 'closed'`;
  return row?.count ?? 0;
}

export const openAccount: WriteHandler<CommandInput<"open_account">> = {
  async run(ctx, input) {
    const customer = await customerRow(ctx, input.customerId);
    if (customer.kycStatus === "rejected") {
      throw new StateError(
        "This customer's identity check was rejected; they cannot open accounts.",
      );
    }
    if ((await openAccounts(ctx, customer.id)) >= LIMITS.accountsPerCustomer) {
      throw new LimitError(
        `A customer holds at most ${LIMITS.accountsPerCustomer} accounts.`,
      );
    }
    const number = accountNumber(
      input.kind,
      await nextSeq(ctx.tx, ctx.owner, `account:${input.kind}`),
    );
    const label =
      input.name?.trim() ||
      (input.kind === "current" ? "Current account" : "Savings account");
    const [row] = await ctx.tx<{ id: string }[]>`
      insert into bank.accounts (owner, customer_id, number, kind, normal_side, name, rate_bps, opened_on)
      values (${ctx.owner}, ${customer.id}, ${number}, ${input.kind}, 'C', ${label},
              ${input.kind === "savings" ? savingsRate(ctx.book) : 0}, ${ctx.today})
      returning id`;
    if (!row) throw new Error("The account was not opened");
    await auditIn(
      ctx.tx,
      { actor: ctx.actor },
      {
        action: "open_account",
        summary: `Opened ${input.kind} account ${number} for ${customer.name}`,
        target: { kind: "account", id: row.id },
        detail: { number, kind: input.kind },
      },
    );
    return {
      message: `Opened ${label} ${formatAccountNumber(number)} for ${customer.name}.`,
      result: { accountId: row.id, number, kind: input.kind },
    };
  },
};

export const openTermDeposit: WriteHandler<CommandInput<"open_term_deposit">> =
  {
    async describe(ctx, input) {
      const from = await accountById(ctx.tx, ctx.owner, input.fromAccountId);
      return `Move ${formatMoney(input.amount)} from ${formatAccountNumber(from.number)} into a ${input.termMonths}-month term deposit at ${(termRate(ctx.book, input.termMonths) / 100).toFixed(2)}%`;
    },
    async run(ctx, input) {
      const customer = await customerRow(ctx, input.customerId);
      const refusal = termRefusal(ctx.book, input.amount);
      if (refusal) throw new InvalidError(refusal);
      await lock(ctx.tx, ctx.owner, [input.fromAccountId]);
      const from = await accountById(ctx.tx, ctx.owner, input.fromAccountId);
      if (
        from.customerId !== customer.id ||
        !["current", "savings"].includes(from.kind)
      ) {
        throw new InvalidError(
          "A term deposit is funded from the customer's own current or savings account.",
        );
      }
      if (
        (await openAccounts(ctx, customer.id)) >= LIMITS.accountsPerCustomer
      ) {
        throw new LimitError(
          `A customer holds at most ${LIMITS.accountsPerCustomer} accounts.`,
        );
      }
      const number = accountNumber(
        "term",
        await nextSeq(ctx.tx, ctx.owner, "account:term"),
      );
      const rateBps = termRate(ctx.book, input.termMonths);
      const maturesOn = addMonths(ctx.today, input.termMonths);
      const [row] = await ctx.tx<{ id: string }[]>`
      insert into bank.accounts (
        owner, customer_id, number, kind, normal_side, name, rate_bps,
        term_months, matures_on, payout_account_id, opened_on
      ) values (
        ${ctx.owner}, ${customer.id}, ${number}, 'term', 'C',
        ${`${input.termMonths}-month term deposit`}, ${rateBps},
        ${input.termMonths}, ${maturesOn}, ${from.id}, ${ctx.today}
      ) returning id`;
      if (!row) throw new Error("The term deposit was not opened");
      const entryId = await post(
        ctx.tx,
        ctx.owner,
        ctx.actor,
        "term_open",
        `To term deposit ${formatAccountNumber(number)}`,
        [
          { account: from.id, dir: "D", amount: input.amount },
          { account: row.id, dir: "C", amount: input.amount },
        ],
        { ref: { accountId: row.id } },
      );
      await auditIn(
        ctx.tx,
        { actor: ctx.actor },
        {
          action: "open_term_deposit",
          summary: `Opened term deposit ${number} for ${customer.name}: ${formatMoney(input.amount)} for ${input.termMonths} months`,
          target: { kind: "account", id: row.id },
          detail: { number, amount: input.amount, rateBps, maturesOn, entryId },
        },
      );
      return {
        message: `Opened a ${input.termMonths}-month term deposit of ${formatMoney(input.amount)} at ${(rateBps / 100).toFixed(2)}%. It matures on ${formatDate(maturesOn)}.`,
        result: { accountId: row.id, number, maturesOn, rateBps, entryId },
      };
    },
  };

export const setAccountStatus: WriteHandler<
  CommandInput<"set_account_status">
> = {
  async describe(ctx, input) {
    const account = await accountById(ctx.tx, ctx.owner, input.accountId);
    return `${input.status === "frozen" ? "Freeze" : "Unfreeze"} account ${formatAccountNumber(account.number)} (${account.customerName})`;
  },
  async run(ctx, input) {
    await lock(ctx.tx, ctx.owner, [input.accountId]);
    const account = await accountById(ctx.tx, ctx.owner, input.accountId);
    if (!["current", "savings"].includes(account.kind)) {
      throw new InvalidError(
        "Only current and savings accounts can be frozen.",
      );
    }
    if (account.status === "closed")
      throw new StateError("That account is closed.");
    if (account.status === input.status) {
      throw new StateError(`That account is already ${input.status}.`);
    }
    await ctx.tx`
      update bank.accounts set status = ${input.status}
      where owner = ${ctx.owner} and id = ${account.id}`;
    await auditIn(
      ctx.tx,
      { actor: ctx.actor },
      {
        action: "set_account_status",
        summary: `Account ${account.number} ${input.status === "frozen" ? "frozen" : "unfrozen"}: ${input.reason}`,
        target: { kind: "account", id: account.id },
        detail: { status: input.status, reason: input.reason },
      },
    );
    await notify(ctx.tx, ctx.owner, {
      customerId: account.customerId,
      kind: "account",
      title:
        input.status === "frozen"
          ? "Your account is frozen"
          : "Your account is open again",
      body: `Account ${formatAccountNumber(account.number)}: ${input.reason}`,
    });
    return {
      message: `Account ${formatAccountNumber(account.number)} is now ${input.status}.`,
      result: { accountId: account.id, status: input.status },
    };
  },
};

export const closeAccount: WriteHandler<CommandInput<"close_account">> = {
  async describe(ctx, input) {
    const account = await accountById(ctx.tx, ctx.owner, input.accountId);
    return `Close account ${formatAccountNumber(account.number)} (${account.customerName}) for good`;
  },
  async run(ctx, input) {
    await lock(ctx.tx, ctx.owner, [input.accountId]);
    const account = await accountById(ctx.tx, ctx.owner, input.accountId);
    if (!["current", "savings"].includes(account.kind)) {
      throw new InvalidError(
        "Only current and savings accounts can be closed here.",
      );
    }
    if (account.status === "closed")
      throw new StateError("That account is already closed.");
    if (account.balance !== 0) {
      throw new StateError(
        `The balance must be zero first; it is ${formatMoney(account.balance)}.`,
      );
    }
    if (account.held !== 0)
      throw new StateError("The account still has holds on it.");
    const [busy] = await ctx.tx<
      { loans: number; clearing: number; terms: number }[]
    >`
      select
        (select count(*)::int from bank.loans where owner = ${ctx.owner}
          and disburse_account_id = ${account.id} and status in ('accepted', 'active', 'arrears')) as loans,
        (select count(*)::int from bank.payments where owner = ${ctx.owner}
          and from_account_id = ${account.id} and status in ('clearing', 'held')) as clearing,
        (select count(*)::int from bank.accounts where owner = ${ctx.owner}
          and payout_account_id = ${account.id} and status <> 'closed') as terms`;
    if (busy?.loans)
      throw new StateError("A loan is repaid from this account.");
    if (busy?.clearing)
      throw new StateError("A payment from this account is still clearing.");
    if (busy?.terms)
      throw new StateError("A term deposit pays out into this account.");
    if (account.interestAccrued > 0) {
      // Interest accrued but not yet paid is given up with the account.
      await post(
        ctx.tx,
        ctx.owner,
        ctx.actor,
        "interest_forfeit",
        `Accrued interest given up on closing ${account.number}`,
        [
          {
            account: await gl(ctx.tx, ctx.owner, GL.interestPayable),
            dir: "D",
            amount: account.interestAccrued,
          },
          {
            account: await gl(ctx.tx, ctx.owner, GL.interestExpense),
            dir: "C",
            amount: account.interestAccrued,
          },
        ],
      );
    }
    const cards = await ctx.tx`
      update bank.cards set status = 'cancelled'
      where owner = ${ctx.owner} and account_id = ${account.id} and status <> 'cancelled'`;
    const orders = await ctx.tx`
      update bank.standing_orders set status = 'cancelled'
      where owner = ${ctx.owner} and status = 'active'
        and (from_account_id = ${account.id} or to_account_id = ${account.id})`;
    await ctx.tx`
      update bank.accounts set status = 'closed', closed_on = ${ctx.today},
             interest_accrued = 0, interest_carry = 0
      where owner = ${ctx.owner} and id = ${account.id}`;
    await auditIn(
      ctx.tx,
      { actor: ctx.actor },
      {
        action: "close_account",
        summary: `Closed account ${account.number}`,
        target: { kind: "account", id: account.id },
        detail: {
          cardsCancelled: cards.count,
          standingOrdersCancelled: orders.count,
        },
      },
    );
    return {
      message: `Closed account ${formatAccountNumber(account.number)}${cards.count ? `, cancelling ${cards.count} card(s)` : ""}${orders.count ? ` and ${orders.count} scheduled payment(s)` : ""}.`,
      result: { accountId: account.id, status: "closed" },
    };
  },
};

export const setOverdraft: WriteHandler<CommandInput<"set_overdraft">> = {
  async gate(ctx, input) {
    const account = await accountById(ctx.tx, ctx.owner, input.accountId);
    if (account.kind !== "current")
      throw new InvalidError("Only a current account can have an overdraft.");
    return bool(ctx.book, "approval.threshold", "overdrafts") &&
      input.limit > account.overdraftLimit
      ? {
          reason: "Raising an overdraft limit needs a second supervisor.",
          amount: input.limit,
        }
      : null;
  },
  async describe(ctx, input) {
    const account = await accountById(ctx.tx, ctx.owner, input.accountId);
    return `Set the overdraft limit of ${formatAccountNumber(account.number)} (${account.customerName}) to ${formatMoney(input.limit)}`;
  },
  async run(ctx, input) {
    await lock(ctx.tx, ctx.owner, [input.accountId]);
    const account = await accountById(ctx.tx, ctx.owner, input.accountId);
    if (account.kind !== "current")
      throw new InvalidError("Only a current account can have an overdraft.");
    if (account.status === "closed")
      throw new StateError("That account is closed.");
    if (account.balance - account.held + input.limit < 0) {
      throw new StateError("The account is already overdrawn past that limit.");
    }
    await ctx.tx`
      update bank.accounts set overdraft_limit = ${input.limit}
      where owner = ${ctx.owner} and id = ${account.id}`;
    await auditIn(
      ctx.tx,
      { actor: ctx.actor },
      {
        action: "set_overdraft",
        summary: `Overdraft limit of ${account.number} set to ${formatMoney(input.limit)}`,
        target: { kind: "account", id: account.id },
        detail: { limit: input.limit, was: account.overdraftLimit },
      },
    );
    return {
      message: `The overdraft limit of ${formatAccountNumber(account.number)} is now ${formatMoney(input.limit)}.`,
      result: { accountId: account.id, overdraftLimit: input.limit },
    };
  },
};
