import {
  checkIncoming,
  checkPayment,
  type PaymentDecision,
  type PaymentKind,
  reviewDeadline,
  settlementDate,
} from "../domain/checks";
import type { CommandInput } from "../domain/commands";
import { type BankDate, formatDate } from "../domain/dates";
import { LIMITS } from "../domain/limits";
import { formatMoney } from "../domain/money";
import { formatAccountNumber } from "../domain/numbers";
import { bool, num } from "../domain/rules";
import type { AccountView, PaymentView } from "../domain/views";
import { staffIdOf } from "./actor";
import { auditIn } from "./audit";
import {
  InsufficientFundsError,
  InvalidError,
  LimitError,
  NotFoundError,
  RuleRefusedError,
  StateError,
} from "./errors";
import {
  type Ctx,
  type Done,
  endHold,
  enqueue,
  GL,
  gl,
  lock,
  notify,
  placeHold,
  post,
  raiseAlert,
  type WriteHandler,
} from "./ledger";
import { accountById, accountByNumber, paymentById } from "./reads";

type PayeeRow = {
  id: string;
  customerId: string;
  name: string;
  kind: "person" | "biller";
  bankCode: string;
  accountNumber: string;
  firstPaidOn: BankDate | null;
  createdOn: BankDate;
};

async function payeeRow(ctx: Ctx, payeeId: string): Promise<PayeeRow> {
  const [payee] = await ctx.tx<PayeeRow[]>`
    select id, customer_id, name, kind, bank_code, account_number,
           first_paid_on, created_on
    from bank.payees
    where owner = ${ctx.owner} and id = ${payeeId} and removed_at is null`;
  if (!payee) throw new NotFoundError("That payee is not in this bank.");
  return payee;
}

/** An account money may be sent from: the customer's own current or savings account. */
function assertSource(account: AccountView) {
  if (!["current", "savings"].includes(account.kind)) {
    throw new InvalidError("Money is sent from a current or savings account.");
  }
  if (account.status !== "open") {
    throw new StateError(
      `Account ${formatAccountNumber(account.number)} is ${account.status}.`,
    );
  }
}

/** The facts the payment Rules need, read under the account's lock. */
async function paymentDecision(
  ctx: Ctx,
  from: AccountView,
  kind: PaymentKind,
  amount: number,
  payee: PayeeRow | null,
  scheduled: boolean,
): Promise<PaymentDecision> {
  const [facts] = await ctx.tx<
    { kycStatus: "pending" | "verified" | "rejected"; sentToday: number }[]
  >`
    select c.kyc_status,
      coalesce((select sum(p.amount) from bank.payments p
        where p.owner = ${ctx.owner} and p.from_account_id = ${from.id}
          and p.submitted_on = ${ctx.today}
          and p.status not in ('rejected', 'returned', 'reversed')), 0)::bigint as sent_today
    from bank.customers c where c.id = ${from.customerId}`;
  const windowHours = Math.max(
    num(ctx.book, "fraud.velocity", "hours"),
    num(ctx.book, "aml.structuring", "days") * 24,
  );
  const recent = await ctx.tx<{ at: string; amount: number }[]>`
    select bank_time as at, amount from bank.payments
    where owner = ${ctx.owner} and from_account_id = ${from.id}
      and status not in ('rejected')
      and bank_time > ${ctx.now}::timestamptz - make_interval(hours => ${windowHours})
    order by bank_time desc limit 200`;
  return checkPayment(ctx.book, {
    kind,
    amount,
    sentToday: facts?.sentToday ?? 0,
    kycStatus: facts?.kycStatus ?? "pending",
    recentOutgoing: recent,
    now: ctx.now,
    payee: payee
      ? { createdOn: payee.createdOn, firstPaidOn: payee.firstPaidOn }
      : null,
    scheduled,
  });
}

export type SendInput = {
  from: AccountView;
  kind: PaymentKind;
  to: AccountView | null;
  payee: PayeeRow | null;
  amount: number;
  reference: string;
  scheduled?: boolean;
  standingOrderId?: string | null;
};

/**
 * Sends one payment: applies the Rules under the account's lock, then posts
 * it (an internal transfer), sends it to the clearing rail, or holds it for
 * review. The caller has already taken the lock on the source account.
 */
export async function sendPayment(ctx: Ctx, input: SendInput): Promise<Done> {
  const { from, kind, to, payee, amount } = input;
  const decision = await paymentDecision(
    ctx,
    from,
    kind,
    amount,
    payee,
    input.scheduled ?? false,
  );
  if (decision.refusal) throw new RuleRefusedError(decision.refusal);
  const total = amount + decision.fee;
  if (from.available < total) {
    throw new InsufficientFundsError(
      `Not enough available in ${formatAccountNumber(from.number)}: ${formatMoney(from.available)} available, ${formatMoney(total)} needed${decision.fee ? ` (${formatMoney(decision.fee)} fee)` : ""}.`,
    );
  }
  const counterparty = to
    ? `${to.customerName ?? to.name} ${formatAccountNumber(to.number)}`
    : `${payee?.name} (${payee?.bankCode} ${payee?.accountNumber})`;
  const reference = input.reference.trim();
  const insert = async (
    status: PaymentView["status"],
    extra: {
      settlesOn?: BankDate | null;
      settledOn?: BankDate | null;
      holdId?: string | null;
      entryId?: number | null;
      reason?: string;
    },
  ) => {
    const [row] = await ctx.tx<{ id: string }[]>`
      insert into bank.payments (
        owner, kind, from_account_id, to_account_id, payee_id, counterparty,
        amount, fee, reference, status, status_reason, submitted_on,
        settles_on, settled_on, hold_id, entry_id, standing_order_id,
        staff_id, via, bank_time
      ) values (
        ${ctx.owner}, ${kind}, ${from.id}, ${to?.id ?? null}, ${payee?.id ?? null},
        ${counterparty}, ${amount}, ${decision.fee}, ${reference}, ${status},
        ${extra.reason ?? ""}, ${ctx.today}, ${extra.settlesOn ?? null},
        ${extra.settledOn ?? null}, ${extra.holdId ?? null}, ${extra.entryId ?? null},
        ${input.standingOrderId ?? null}, ${staffIdOf(ctx.actor)}, ${ctx.actor.via},
        ${ctx.now}
      ) returning id`;
    if (!row) throw new Error("The payment was not saved");
    return row.id;
  };

  if (decision.alerts.length > 0) {
    await raiseAlert(ctx.tx, ctx.owner, {
      customerId: from.customerId,
      accountId: from.id,
      findings: decision.alerts,
      holding: false,
    });
  }

  if (kind === "internal" && to) {
    const entryId = await post(
      ctx.tx,
      ctx.owner,
      ctx.actor,
      "transfer",
      reference || `Transfer to ${to.customerName ?? to.name}`,
      [
        { account: from.id, dir: "D", amount },
        { account: to.id, dir: "C", amount },
      ],
    );
    const paymentId = await insert("settled", {
      settledOn: ctx.today,
      entryId,
    });
    await auditIn(
      ctx.tx,
      { actor: ctx.actor },
      {
        action: input.scheduled ? "standing_order.ran" : "transfer",
        summary: `Transferred ${formatMoney(amount)} from ${from.number} to ${to.number}`,
        target: { kind: "payment", id: paymentId },
        detail: {
          amount,
          from: from.number,
          to: to.number,
          entryId,
          findings: decision.findings,
        },
      },
    );
    if (to.customerId && to.customerId !== from.customerId) {
      await notify(ctx.tx, ctx.owner, {
        customerId: to.customerId,
        kind: "credit",
        title: `You received ${formatMoney(amount)}`,
        body: `From ${from.customerName ?? "a Tidewater account"}${reference ? `: ${reference}` : ""}.`,
        fanout: !input.scheduled,
      });
    }
    return {
      message: `Transferred ${formatMoney(amount)} to ${counterparty}. It posted at once.`,
      result: { paymentId, status: "settled", entryId },
    };
  }

  if (!payee)
    throw new InvalidError("A payment to another bank needs a payee.");
  if (!payee.firstPaidOn) {
    await ctx.tx`
      update bank.payees set first_paid_on = ${ctx.today}
      where owner = ${ctx.owner} and id = ${payee.id}`;
  }

  if (decision.holds.length > 0) {
    // Held for review: the money is set aside, nothing posts, an Alert waits.
    const paymentId = crypto.randomUUID();
    const holdId = await placeHold(ctx.tx, ctx.owner, {
      accountId: from.id,
      amount: total,
      kind: "review",
      ref: paymentId,
    });
    const reviewBy = reviewDeadline(ctx.book, new Date(ctx.now)).toISOString();
    await ctx.tx`
      insert into bank.payments (
        id, owner, kind, from_account_id, payee_id, counterparty, amount, fee,
        reference, status, status_reason, submitted_on, hold_id,
        standing_order_id, staff_id, via, bank_time
      ) values (
        ${paymentId}, ${ctx.owner}, ${kind}, ${from.id}, ${payee.id},
        ${counterparty}, ${amount}, ${decision.fee}, ${reference}, 'held',
        ${decision.holds[0]?.message ?? "Held for review"}, ${ctx.today},
        ${holdId}, ${input.standingOrderId ?? null}, ${staffIdOf(ctx.actor)},
        ${ctx.actor.via}, ${ctx.now}
      )`;
    const alertId = await raiseAlert(ctx.tx, ctx.owner, {
      customerId: from.customerId,
      accountId: from.id,
      paymentId,
      findings: decision.holds,
      holding: true,
      reviewBy,
    });
    await enqueue(ctx.tx, ctx.owner, "alert.review", { alertId, reviewBy });
    await auditIn(
      ctx.tx,
      { actor: ctx.actor },
      {
        action: "pay_payee",
        summary: `Payment of ${formatMoney(amount)} to ${payee.name} held for review`,
        target: { kind: "payment", id: paymentId },
        detail: {
          amount,
          fee: decision.fee,
          alertId,
          findings: decision.findings,
        },
      },
    );
    await auditIn(
      ctx.tx,
      { owner: ctx.owner, system: "Fraud monitoring" },
      {
        action: "alert.raised",
        summary: decision.holds.map((item) => item.message).join(" "),
        target: { kind: "alert", id: alertId },
        detail: { paymentId, rules: decision.holds.map((item) => item.ruleId) },
      },
    );
    await notify(ctx.tx, ctx.owner, {
      customerId: from.customerId,
      kind: "payment",
      title: "We are checking a payment",
      body: `Your payment of ${formatMoney(amount)} to ${payee.name} is held while we review it.`,
      fanout: !input.scheduled,
    });
    return {
      message: `The payment of ${formatMoney(amount)} to ${payee.name} is held for review (${decision.holds.map((item) => item.message).join(" ")}). The money is set aside until compliance decides, by ${formatDate(reviewBy.slice(0, 10))} at the latest.`,
      result: { paymentId, status: "held", alertId },
    };
  }

  const settlesOn = settlementDate(ctx.book, new Date(ctx.now));
  const entryId = await postToClearing(
    ctx,
    from,
    payee.name,
    amount,
    decision.fee,
    reference,
  );
  const paymentId = await insert("clearing", { settlesOn, entryId });
  await enqueue(ctx.tx, ctx.owner, "payment.clear", { paymentId });
  await auditIn(
    ctx.tx,
    { actor: ctx.actor },
    {
      action: input.scheduled ? "standing_order.ran" : "pay_payee",
      summary: `Sent ${formatMoney(amount)} from ${from.number} to ${payee.name}; settles ${settlesOn}`,
      target: { kind: "payment", id: paymentId },
      detail: {
        amount,
        fee: decision.fee,
        settlesOn,
        entryId,
        findings: decision.findings,
      },
    },
  );
  return {
    message: `Sent ${formatMoney(amount)} to ${payee.name}${decision.fee ? ` (fee ${formatMoney(decision.fee)})` : ""}. It is in clearing and settles on ${formatDate(settlesOn)}.`,
    result: { paymentId, status: "clearing", settlesOn, entryId },
  };
}

/** The customer is debited; the money sits in "Payments in clearing" until the rail settles it. */
async function postToClearing(
  ctx: Ctx,
  from: Pick<AccountView, "id">,
  payeeName: string,
  amount: number,
  fee: number,
  reference: string,
  captureHold?: string,
): Promise<number> {
  return post(
    ctx.tx,
    ctx.owner,
    ctx.actor,
    "payment_out",
    reference ? `${payeeName}: ${reference}` : `Payment to ${payeeName}`,
    [
      { account: from.id, dir: "D", amount: amount + fee },
      { account: await gl(ctx.tx, ctx.owner, GL.clearing), dir: "C", amount },
      { account: await gl(ctx.tx, ctx.owner, GL.fees), dir: "C", amount: fee },
    ],
    captureHold ? { captureHold } : {},
  );
}

type HeldPayment = {
  id: string;
  fromAccountId: string;
  payeeName: string;
  amount: number;
  fee: number;
  reference: string;
  holdId: string;
  customerId: string;
  status: string;
};

/**
 * Ends the review of a held payment: released, it goes to the clearing rail
 * (its hold captured by the posting); rejected, its hold is freed. Shared by
 * a compliance officer's decision and the review-timeout Workflow.
 */
export async function concludeReview(
  ctx: Ctx,
  alertId: string,
  outcome: {
    release: boolean;
    status: "released" | "rejected" | "timed_out";
    note: string;
    decidedBy: string | null;
  },
): Promise<{ paymentId: string; released: boolean } | null> {
  const [alert] = await ctx.tx<
    { id: string; paymentId: string | null; status: string; holding: boolean }[]
  >`
    select id, payment_id, status, holding from bank.alerts
    where owner = ${ctx.owner} and id = ${alertId} for update`;
  if (!alert) throw new NotFoundError("That Alert is not in this bank.");
  if (alert.status !== "open" || !alert.holding || !alert.paymentId)
    return null;
  const [payment] = await ctx.tx<HeldPayment[]>`
    select p.id, p.from_account_id, coalesce(y.name, p.counterparty) as payee_name,
           p.amount, p.fee, p.reference, p.hold_id, a.customer_id, p.status
    from bank.payments p
    join bank.accounts a on a.id = p.from_account_id
    left join bank.payees y on y.id = p.payee_id
    where p.owner = ${ctx.owner} and p.id = ${alert.paymentId}`;
  if (!payment || payment.status !== "held") return null;
  await lock(ctx.tx, ctx.owner, [payment.fromAccountId]);
  await ctx.tx`
    update bank.alerts set status = ${outcome.status}, decided_by = ${outcome.decidedBy},
           decision_note = ${outcome.note}, decided_at = now()
    where id = ${alert.id}`;
  if (outcome.release) {
    const settlesOn = settlementDate(ctx.book, new Date(ctx.now));
    const entryId = await postToClearing(
      ctx,
      { id: payment.fromAccountId },
      payment.payeeName,
      payment.amount,
      payment.fee,
      payment.reference,
      payment.holdId,
    );
    await ctx.tx`
      update bank.payments set status = 'clearing', status_reason = 'Released after review',
             settles_on = ${settlesOn}, entry_id = ${entryId}
      where id = ${payment.id}`;
    await enqueue(ctx.tx, ctx.owner, "payment.clear", {
      paymentId: payment.id,
    });
    await notify(ctx.tx, ctx.owner, {
      customerId: payment.customerId,
      kind: "payment",
      title: "Your payment is on its way",
      body: `Your payment of ${formatMoney(payment.amount)} to ${payment.payeeName} passed our review and settles on ${formatDate(settlesOn)}.`,
    });
  } else {
    await endHold(ctx.tx, ctx.owner, payment.holdId, "released");
    await ctx.tx`
      update bank.payments set status = 'rejected', status_reason = ${outcome.note.slice(0, 200)}
      where id = ${payment.id}`;
    await notify(ctx.tx, ctx.owner, {
      customerId: payment.customerId,
      kind: "payment",
      title: "A payment was stopped",
      body: `Your payment of ${formatMoney(payment.amount)} to ${payment.payeeName} was not sent. The money is back in your available balance.`,
    });
  }
  return { paymentId: payment.id, released: outcome.release };
}

async function transferParties(ctx: Ctx, fromId: string, toNumber: string) {
  const from = await accountById(ctx.tx, ctx.owner, fromId);
  assertSource(from);
  const to = await accountByNumber(ctx.tx, ctx.owner, toNumber);
  if (!to || !["current", "savings"].includes(to.kind)) {
    throw new NotFoundError(
      `There is no Tidewater account ${formatAccountNumber(toNumber)} to pay into.`,
    );
  }
  if (to.id === from.id)
    throw new InvalidError("Choose two different accounts.");
  if (to.status === "closed")
    throw new StateError("The receiving account is closed.");
  return { from, to };
}

export const transfer: WriteHandler<CommandInput<"transfer">> = {
  async gate(ctx, input) {
    const { from } = await transferParties(
      ctx,
      input.fromAccountId,
      input.toAccountNumber,
    );
    const decision = await paymentDecision(
      ctx,
      from,
      "internal",
      input.amount,
      null,
      false,
    );
    if (decision.refusal) throw new RuleRefusedError(decision.refusal);
    return decision.approval
      ? { reason: decision.approval.message, amount: input.amount }
      : null;
  },
  async describe(ctx, input) {
    const { from, to } = await transferParties(
      ctx,
      input.fromAccountId,
      input.toAccountNumber,
    );
    return `Transfer ${formatMoney(input.amount)} from ${formatAccountNumber(from.number)} (${from.customerName}) to ${formatAccountNumber(to.number)} (${to.customerName})`;
  },
  async run(ctx, input) {
    // Both accounts are locked, in id order, before anything is read.
    const target = await accountByNumber(
      ctx.tx,
      ctx.owner,
      input.toAccountNumber,
    );
    await lock(
      ctx.tx,
      ctx.owner,
      target ? [input.fromAccountId, target.id] : [input.fromAccountId],
    );
    const { from, to } = await transferParties(
      ctx,
      input.fromAccountId,
      input.toAccountNumber,
    );
    return sendPayment(ctx, {
      from,
      kind: "internal",
      to,
      payee: null,
      amount: input.amount,
      reference: input.reference ?? "",
    });
  },
};

async function payeeParties(ctx: Ctx, fromId: string, payeeId: string) {
  const from = await accountById(ctx.tx, ctx.owner, fromId);
  assertSource(from);
  const payee = await payeeRow(ctx, payeeId);
  if (payee.customerId !== from.customerId) {
    throw new InvalidError("That payee belongs to a different customer.");
  }
  return {
    from,
    payee,
    kind: (payee.kind === "biller" ? "bill" : "external") as PaymentKind,
  };
}

export const payPayee: WriteHandler<CommandInput<"pay_payee">> = {
  async gate(ctx, input) {
    const { from, payee, kind } = await payeeParties(
      ctx,
      input.fromAccountId,
      input.payeeId,
    );
    const decision = await paymentDecision(
      ctx,
      from,
      kind,
      input.amount,
      payee,
      false,
    );
    if (decision.refusal) throw new RuleRefusedError(decision.refusal);
    return decision.approval
      ? { reason: decision.approval.message, amount: input.amount }
      : null;
  },
  async describe(ctx, input) {
    const { from, payee } = await payeeParties(
      ctx,
      input.fromAccountId,
      input.payeeId,
    );
    return `Pay ${formatMoney(input.amount)} from ${formatAccountNumber(from.number)} (${from.customerName}) to ${payee.name} at ${payee.bankCode} ${payee.accountNumber}`;
  },
  async run(ctx, input) {
    await lock(ctx.tx, ctx.owner, [input.fromAccountId]);
    const { from, payee, kind } = await payeeParties(
      ctx,
      input.fromAccountId,
      input.payeeId,
    );
    return sendPayment(ctx, {
      from,
      kind,
      to: null,
      payee,
      amount: input.amount,
      reference: input.reference ?? "",
    });
  },
};

export const addPayee: WriteHandler<CommandInput<"add_payee">> = {
  async run(ctx, input) {
    const [customer] = await ctx.tx<{ name: string; payees: number }[]>`
      select c.name, (select count(*)::int from bank.payees p
        where p.customer_id = c.id and p.removed_at is null) as payees
      from bank.customers c where c.owner = ${ctx.owner} and c.id = ${input.customerId}`;
    if (!customer)
      throw new NotFoundError("That customer is not in this bank.");
    if (customer.payees >= LIMITS.payeesPerCustomer) {
      throw new LimitError(
        `A customer keeps at most ${LIMITS.payeesPerCustomer} payees.`,
      );
    }
    const [row] = await ctx.tx<{ id: string }[]>`
      insert into bank.payees (owner, customer_id, name, kind, bank_code, account_number, reference, created_on)
      values (${ctx.owner}, ${input.customerId}, ${input.name}, ${input.kind},
              ${input.bankCode}, ${input.accountNumber}, ${input.reference ?? ""}, ${ctx.today})
      returning id`;
    if (!row) throw new Error("The payee was not saved");
    await auditIn(
      ctx.tx,
      { actor: ctx.actor },
      {
        action: "add_payee",
        summary: `Added payee ${input.name} for ${customer.name}`,
        target: { kind: "payee", id: row.id },
        detail: { bankCode: input.bankCode, kind: input.kind },
      },
    );
    return {
      message: `Added ${input.name} (${input.bankCode} ${input.accountNumber}) as a payee for ${customer.name}.`,
      result: { payeeId: row.id },
    };
  },
};

export const removePayee: WriteHandler<CommandInput<"remove_payee">> = {
  async run(ctx, input) {
    const payee = await payeeRow(ctx, input.payeeId);
    await ctx.tx`
      update bank.payees set removed_at = now() where owner = ${ctx.owner} and id = ${payee.id}`;
    const orders = await ctx.tx`
      update bank.standing_orders set status = 'cancelled'
      where owner = ${ctx.owner} and payee_id = ${payee.id} and status = 'active'`;
    await auditIn(
      ctx.tx,
      { actor: ctx.actor },
      {
        action: "remove_payee",
        summary: `Removed payee ${payee.name}`,
        target: { kind: "payee", id: payee.id },
        detail: { standingOrdersCancelled: orders.count },
      },
    );
    return {
      message: `Removed ${payee.name}${orders.count ? ` and cancelled ${orders.count} scheduled payment(s) to them` : ""}.`,
      result: { payeeId: payee.id },
    };
  },
};

export const createStandingOrder: WriteHandler<
  CommandInput<"create_standing_order">
> = {
  async describe(ctx, input) {
    const from = await accountById(ctx.tx, ctx.owner, input.fromAccountId);
    const to = input.payeeId
      ? (await payeeRow(ctx, input.payeeId)).name
      : formatAccountNumber(input.toAccountNumber ?? "");
    return `Schedule ${formatMoney(input.amount)} ${input.frequency} from ${formatAccountNumber(from.number)} to ${to}, starting ${formatDate(input.startOn)}`;
  },
  async run(ctx, input) {
    const from = await accountById(ctx.tx, ctx.owner, input.fromAccountId);
    assertSource(from);
    if (input.startOn < ctx.today)
      throw new InvalidError("The first payment cannot be in the past.");
    if (input.endsOn && input.endsOn < input.startOn) {
      throw new InvalidError("The last date cannot be before the first.");
    }
    let toId: string | null = null;
    let label: string;
    if (input.payeeId) {
      const payee = await payeeRow(ctx, input.payeeId);
      if (payee.customerId !== from.customerId) {
        throw new InvalidError("That payee belongs to a different customer.");
      }
      label = payee.name;
    } else {
      const to = (
        await transferParties(ctx, from.id, input.toAccountNumber ?? "")
      ).to;
      toId = to.id;
      label = `${to.customerName} ${formatAccountNumber(to.number)}`;
    }
    const [count] = await ctx.tx<{ count: number }[]>`
      select count(*)::int as count from bank.standing_orders s
      join bank.accounts a on a.id = s.from_account_id
      where s.owner = ${ctx.owner} and a.customer_id = ${from.customerId} and s.status = 'active'`;
    if ((count?.count ?? 0) >= LIMITS.standingOrdersPerCustomer) {
      throw new LimitError(
        `A customer keeps at most ${LIMITS.standingOrdersPerCustomer} scheduled payments.`,
      );
    }
    const perPayment = num(ctx.book, "limits.payments", "perPayment");
    if (input.amount > perPayment) {
      throw new InvalidError(
        `One payment may not exceed ${formatMoney(perPayment)}.`,
      );
    }
    const [row] = await ctx.tx<{ id: string }[]>`
      insert into bank.standing_orders (
        owner, from_account_id, to_account_id, payee_id, amount, frequency,
        next_run_on, ends_on, reference
      ) values (
        ${ctx.owner}, ${from.id}, ${toId}, ${input.payeeId ?? null}, ${input.amount},
        ${input.frequency}, ${input.startOn}, ${input.endsOn ?? null}, ${input.reference ?? ""}
      ) returning id`;
    if (!row) throw new Error("The scheduled payment was not saved");
    await auditIn(
      ctx.tx,
      { actor: ctx.actor },
      {
        action: "create_standing_order",
        summary: `Scheduled ${formatMoney(input.amount)} ${input.frequency} from ${from.number} to ${label}`,
        target: { kind: "standing_order", id: row.id },
        detail: {
          amount: input.amount,
          frequency: input.frequency,
          startOn: input.startOn,
        },
      },
    );
    return {
      message: `Scheduled ${formatMoney(input.amount)} ${input.frequency === "once" ? "once" : input.frequency} to ${label}, first on ${formatDate(input.startOn)}. End-of-day runs it.`,
      result: { standingOrderId: row.id, nextRunOn: input.startOn },
    };
  },
};

export const cancelStandingOrder: WriteHandler<
  CommandInput<"cancel_standing_order">
> = {
  async run(ctx, input) {
    const rows = await ctx.tx<{ id: string }[]>`
      update bank.standing_orders set status = 'cancelled'
      where owner = ${ctx.owner} and id = ${input.standingOrderId} and status = 'active'
      returning id`;
    if (rows.length === 0)
      throw new StateError("That scheduled payment is not active.");
    await auditIn(
      ctx.tx,
      { actor: ctx.actor },
      {
        action: "cancel_standing_order",
        summary: "Cancelled a scheduled payment",
        target: { kind: "standing_order", id: input.standingOrderId },
      },
    );
    return {
      message: "Cancelled the scheduled payment.",
      result: { standingOrderId: input.standingOrderId, status: "cancelled" },
    };
  },
};

export const receiveCredit: WriteHandler<CommandInput<"receive_credit">> = {
  async run(ctx, input) {
    await lock(ctx.tx, ctx.owner, [input.accountId]);
    const account = await accountById(ctx.tx, ctx.owner, input.accountId);
    if (!["current", "savings"].includes(account.kind)) {
      throw new InvalidError("Credits arrive in a current or savings account.");
    }
    if (account.status === "closed")
      throw new StateError("That account is closed.");
    const entryId = await post(
      ctx.tx,
      ctx.owner,
      ctx.actor,
      "incoming",
      input.reference
        ? `${input.from}: ${input.reference}`
        : `From ${input.from}`,
      [
        {
          account: await gl(ctx.tx, ctx.owner, GL.cash),
          dir: "D",
          amount: input.amount,
        },
        { account: account.id, dir: "C", amount: input.amount },
      ],
    );
    const [payment] = await ctx.tx<{ id: string }[]>`
      insert into bank.payments (
        owner, kind, to_account_id, counterparty, amount, reference, status,
        submitted_on, settled_on, entry_id, staff_id, via, bank_time
      ) values (
        ${ctx.owner}, 'incoming', ${account.id}, ${input.from}, ${input.amount},
        ${input.reference ?? ""}, 'settled', ${ctx.today}, ${ctx.today},
        ${entryId}, ${staffIdOf(ctx.actor)}, ${ctx.actor.via}, ${ctx.now}
      ) returning id`;
    if (!payment) throw new Error("The credit was not saved");
    const recent = await ctx.tx<{ at: string; amount: number }[]>`
      select bank_time as at, amount from bank.payments
      where owner = ${ctx.owner} and to_account_id = ${account.id} and kind = 'incoming'
        and id <> ${payment.id}
        and bank_time > ${ctx.now}::timestamptz - make_interval(days => ${num(ctx.book, "aml.structuring", "days")})
      limit 200`;
    const findings = checkIncoming(ctx.book, {
      amount: input.amount,
      recentIncoming: recent,
      now: ctx.now,
    });
    let alertId: string | null = null;
    if (findings.length > 0) {
      alertId = await raiseAlert(ctx.tx, ctx.owner, {
        customerId: account.customerId,
        accountId: account.id,
        paymentId: payment.id,
        findings,
        holding: false,
      });
      await auditIn(
        ctx.tx,
        { owner: ctx.owner, system: "AML monitoring" },
        {
          action: "alert.raised",
          summary: findings.map((item) => item.message).join(" "),
          target: { kind: "alert", id: alertId },
          detail: {
            paymentId: payment.id,
            rules: findings.map((item) => item.ruleId),
          },
        },
      );
    }
    await auditIn(
      ctx.tx,
      { actor: ctx.actor },
      {
        action: "receive_credit",
        summary: `${formatMoney(input.amount)} from ${input.from} credited to ${account.number}`,
        target: { kind: "payment", id: payment.id },
        detail: { amount: input.amount, entryId, alertId },
      },
    );
    await notify(ctx.tx, ctx.owner, {
      customerId: account.customerId,
      kind: "credit",
      title: `You received ${formatMoney(input.amount)}`,
      body: `From ${input.from}${input.reference ? `: ${input.reference}` : ""}.`,
    });
    return {
      message: `Credited ${formatMoney(input.amount)} from ${input.from} to ${formatAccountNumber(account.number)}.${alertId ? " An AML Alert was raised for the record." : ""}`,
      result: { paymentId: payment.id, entryId, alertId },
    };
  },
};

export const reversePayment: WriteHandler<CommandInput<"reverse_payment">> = {
  async gate(ctx, input) {
    const payment = await reversible(ctx, input.paymentId);
    return bool(ctx.book, "approval.threshold", "reversals")
      ? {
          reason: "Every reversal needs a second supervisor.",
          amount: payment.amount,
        }
      : null;
  },
  async describe(ctx, input) {
    const payment = await reversible(ctx, input.paymentId);
    return `Reverse the ${payment.kind} payment of ${formatMoney(payment.amount)} (${payment.counterparty}): ${input.reason}`;
  },
  async run(ctx, input) {
    const payment = await reversible(ctx, input.paymentId);
    const cash = await gl(ctx.tx, ctx.owner, GL.cash);
    // The mirror of the original entry. Bank-initiated, so it may take the
    // receiving account below zero rather than fail.
    const debit = payment.toAccountId as string;
    const credit =
      payment.kind === "internal" ? (payment.fromAccountId as string) : cash;
    const entryId = await post(
      ctx.tx,
      ctx.owner,
      ctx.actor,
      "reversal",
      `Reversal: ${input.reason}`.slice(0, 200),
      [
        { account: debit, dir: "D", amount: payment.amount },
        { account: credit, dir: "C", amount: payment.amount },
      ],
      {
        force: true,
        allowFrozen: true,
        reverses: payment.entryId as number,
        ref: { paymentId: payment.id },
      },
    );
    await ctx.tx`
      update bank.payments set status = 'reversed', status_reason = ${input.reason.slice(0, 200)}
      where owner = ${ctx.owner} and id = ${payment.id}`;
    await auditIn(
      ctx.tx,
      { actor: ctx.actor },
      {
        action: "reverse_payment",
        summary: `Reversed ${formatMoney(payment.amount)} (${payment.counterparty}): ${input.reason}`,
        target: { kind: "payment", id: payment.id },
        detail: { amount: payment.amount, entryId, reverses: payment.entryId },
      },
    );
    return {
      message: `Reversed the payment of ${formatMoney(payment.amount)} with a mirror entry.`,
      result: { paymentId: payment.id, status: "reversed", entryId },
    };
  },
};

async function reversible(ctx: Ctx, paymentId: string): Promise<PaymentView> {
  const payment = await paymentById(ctx.tx, ctx.owner, paymentId);
  if (!["internal", "incoming"].includes(payment.kind)) {
    throw new InvalidError(
      "Only an internal transfer or an incoming credit can be reversed; a payment to another bank is returned by the rail.",
    );
  }
  if (
    payment.status !== "settled" ||
    !payment.entryId ||
    !payment.toAccountId
  ) {
    throw new StateError(
      `That payment is ${payment.status}; only a settled one can be reversed.`,
    );
  }
  return payment;
}

const DISPUTE_REASON: Record<string, string> = {
  not_recognised: "Not recognised",
  duplicate: "Charged twice",
  wrong_amount: "Wrong amount",
  not_received: "Goods or service not received",
  other: "Other",
};

export const openDispute: WriteHandler<CommandInput<"open_dispute">> = {
  async run(ctx, input) {
    const account = await accountById(ctx.tx, ctx.owner, input.accountId);
    if (!account.customerId)
      throw new InvalidError("Only a customer's transaction can be disputed.");
    const [posting] = await ctx.tx<{ amount: number; description: string }[]>`
      select p.amount, e.description from bank.postings p
      join bank.journal_entries e on e.id = p.entry_id
      where p.owner = ${ctx.owner} and p.entry_id = ${input.entryId}
        and p.account_id = ${account.id} and p.direction = 'D'
      order by p.id limit 1`;
    if (!posting) {
      throw new NotFoundError(
        "That entry did not take money out of this account.",
      );
    }
    const [existing] = await ctx.tx`
      select 1 from bank.disputes
      where owner = ${ctx.owner} and entry_id = ${input.entryId} and account_id = ${account.id}`;
    if (existing) throw new StateError("That transaction is already disputed.");
    const [row] = await ctx.tx<{ id: string }[]>`
      insert into bank.disputes (owner, customer_id, account_id, entry_id, amount, reason, detail, opened_on)
      values (${ctx.owner}, ${account.customerId}, ${account.id}, ${input.entryId},
              ${posting.amount}, ${DISPUTE_REASON[input.reason] ?? input.reason},
              ${input.detail ?? ""}, ${ctx.today})
      returning id`;
    if (!row) throw new Error("The dispute was not opened");
    await auditIn(
      ctx.tx,
      { actor: ctx.actor },
      {
        action: "open_dispute",
        summary: `Dispute opened on entry ${input.entryId} (${formatMoney(posting.amount)}): ${DISPUTE_REASON[input.reason]}`,
        target: { kind: "dispute", id: row.id },
        detail: {
          entryId: input.entryId,
          amount: posting.amount,
          reason: input.reason,
        },
      },
    );
    await notify(ctx.tx, ctx.owner, {
      customerId: account.customerId,
      kind: "dispute",
      title: "We have your dispute",
      body: `We are looking into "${posting.description}" (${formatMoney(posting.amount)}).`,
    });
    return {
      message: `Opened a dispute on "${posting.description}" for ${formatMoney(posting.amount)}. A supervisor or compliance will resolve it.`,
      result: { disputeId: row.id, amount: posting.amount },
    };
  },
};

export const resolveDispute: WriteHandler<CommandInput<"resolve_dispute">> = {
  async describe(ctx, input) {
    const [dispute] = await ctx.tx<{ amount: number; name: string }[]>`
      select d.amount, c.name from bank.disputes d join bank.customers c on c.id = d.customer_id
      where d.owner = ${ctx.owner} and d.id = ${input.disputeId}`;
    if (!dispute) throw new NotFoundError("That dispute is not in this bank.");
    return input.outcome === "upheld"
      ? `Uphold ${dispute.name}'s dispute and refund ${formatMoney(dispute.amount)} from the bank's losses`
      : `Reject ${dispute.name}'s dispute of ${formatMoney(dispute.amount)}`;
  },
  async run(ctx, input) {
    const [dispute] = await ctx.tx<
      {
        id: string;
        accountId: string;
        customerId: string;
        amount: number;
        status: string;
        entryId: number;
      }[]
    >`
      select id, account_id, customer_id, amount, status, entry_id from bank.disputes
      where owner = ${ctx.owner} and id = ${input.disputeId} for update`;
    if (!dispute) throw new NotFoundError("That dispute is not in this bank.");
    if (dispute.status !== "open")
      throw new StateError(`That dispute is already ${dispute.status}.`);
    let entryId: number | null = null;
    if (input.outcome === "upheld") {
      entryId = await post(
        ctx.tx,
        ctx.owner,
        ctx.actor,
        "dispute_refund",
        `Dispute upheld: refund of entry ${dispute.entryId}`,
        [
          {
            account: await gl(ctx.tx, ctx.owner, GL.losses),
            dir: "D",
            amount: dispute.amount,
          },
          { account: dispute.accountId, dir: "C", amount: dispute.amount },
        ],
        { ref: { disputeId: dispute.id } },
      );
    }
    await ctx.tx`
      update bank.disputes set status = ${input.outcome}, resolution_note = ${input.note},
             resolution_entry_id = ${entryId}, resolved_on = ${ctx.today}
      where id = ${dispute.id}`;
    await auditIn(
      ctx.tx,
      { actor: ctx.actor },
      {
        action: "resolve_dispute",
        summary: `Dispute ${input.outcome}${entryId ? `, ${formatMoney(dispute.amount)} refunded` : ""}: ${input.note}`,
        target: { kind: "dispute", id: dispute.id },
        detail: { outcome: input.outcome, amount: dispute.amount, entryId },
      },
    );
    await notify(ctx.tx, ctx.owner, {
      customerId: dispute.customerId,
      kind: "dispute",
      title:
        input.outcome === "upheld"
          ? "Your dispute was upheld"
          : "Your dispute was not upheld",
      body:
        input.outcome === "upheld"
          ? `${formatMoney(dispute.amount)} is back in your account.`
          : input.note,
    });
    return {
      message:
        input.outcome === "upheld"
          ? `Upheld the dispute and refunded ${formatMoney(dispute.amount)}.`
          : "Rejected the dispute.",
      result: { disputeId: dispute.id, status: input.outcome, entryId },
    };
  },
};
