import { createHash } from "node:crypto";
import {
  type CommandDef,
  type CommandInput,
  type CommandName,
  commandDef,
  isSensitive,
  type Via,
  type WriteOutcome,
} from "../domain/commands";
import { LIMITS } from "../domain/limits";
import { approvalRefusal, can } from "../domain/permissions";
import { ROLE_LABEL, type Staff } from "../domain/staff";
import type { Actor } from "./actor";
import { auditIn } from "./audit";
import type { Pool, Tx } from "./db";
import {
  ForbiddenError,
  fromDatabase,
  InvalidError,
  isSafeError,
  NotFoundError,
  StateError,
} from "./errors";
import type { Ctx, WriteHandler } from "./ledger";
import { READS } from "./reads";
import { bankClock, loadRulebook } from "./rulebook";
import {
  acceptLoan,
  applyForLoan,
  cardPurchase,
  issueCard,
  repayLoan,
  reverseCardPurchase,
  setCardLimits,
  setCardStatus,
  settleCardPurchase,
} from "./write-cards-loans";
import {
  closeAccount,
  decideKyc,
  openAccount,
  openCustomer,
  openTermDeposit,
  setAccountStatus,
  setOverdraft,
  updateCustomer,
} from "./write-customers";
import {
  addPayee,
  cancelStandingOrder,
  createStandingOrder,
  openDispute,
  payPayee,
  receiveCredit,
  removePayee,
  resolveDispute,
  reversePayment,
  transfer,
} from "./write-money";
import {
  advanceClock,
  decideAlert,
  editRule,
  markNotificationsRead,
  raiseRequest,
  requestStatement,
  restoreRule,
} from "./write-ops";

/**
 * The command engine: the one path every command takes, whoever asks (the
 * app, the Teller, an outside MCP client). In order:
 *
 *   1. the input is validated against the command's zod schema;
 *   2. the Staff member's Role must allow it (`can`);
 *   3. a write runs in ONE transaction that begins by claiming the
 *      idempotency key: the same key returns the first result and never
 *      runs twice;
 *   4. a sensitive write asked for by an agent is parked as a pending
 *      confirmation for the person to click, and is not run;
 *   5. a write over a Rule's threshold is parked as a pending Approval for a
 *      different supervisor (maker-checker), and is not run;
 *   6. otherwise the handler runs: it locks the accounts, applies the Rules,
 *      posts through `bank.post_entry`, writes its Audit event and any
 *      outbox message, all in that same transaction.
 */

// biome-ignore lint/suspicious/noExplicitAny: each handler is typed against its own command's input where it is defined.
const HANDLERS: Partial<Record<CommandName, WriteHandler<any>>> = {
  open_customer: openCustomer,
  update_customer: updateCustomer,
  decide_kyc: decideKyc,
  open_account: openAccount,
  open_term_deposit: openTermDeposit,
  set_account_status: setAccountStatus,
  close_account: closeAccount,
  set_overdraft: setOverdraft,
  transfer,
  add_payee: addPayee,
  remove_payee: removePayee,
  pay_payee: payPayee,
  create_standing_order: createStandingOrder,
  cancel_standing_order: cancelStandingOrder,
  receive_credit: receiveCredit,
  reverse_payment: reversePayment,
  open_dispute: openDispute,
  resolve_dispute: resolveDispute,
  issue_card: issueCard,
  set_card_status: setCardStatus,
  set_card_limits: setCardLimits,
  card_purchase: cardPurchase,
  settle_card_purchase: settleCardPurchase,
  reverse_card_purchase: reverseCardPurchase,
  apply_for_loan: applyForLoan,
  accept_loan: acceptLoan,
  repay_loan: repayLoan,
  decide_alert: decideAlert,
  edit_rule: editRule,
  restore_rule: restoreRule,
  advance_clock: advanceClock,
  request_statement: requestStatement,
  mark_notifications_read: markNotificationsRead,
  raise_request: raiseRequest,
};

/** Write commands the engine runs itself, because they run other commands. */
const ENGINE_COMMANDS: CommandName[] = ["decide_approval", "confirm_request"];

/** Every write command has a handler: checked by commands.test.ts. */
export function hasHandler(name: CommandName): boolean {
  return name in HANDLERS || ENGINE_COMMANDS.includes(name) || name in READS;
}

function defOf(name: string): CommandDef {
  const def = commandDef(name);
  if (!def) throw new NotFoundError(`There is no command "${name}".`);
  return def;
}

function assertAllowed(def: CommandDef, actor: Actor) {
  if (def.humanOnly && actor.via !== "app") {
    throw new ForbiddenError(
      `"${def.title}" is for a person in the app. No tool can do it.`,
    );
  }
  if (!can(actor.staff, def.action)) {
    throw new ForbiddenError(
      `${actor.staff.name} is a ${ROLE_LABEL[actor.staff.role].toLowerCase()} and may not do that ("${def.title}"). Switch Staff to try it.`,
    );
  }
}

/** Runs a read command for an actor. The handler scopes everything to the Owner. */
export async function runRead(
  pool: Pool,
  actor: Actor,
  name: string,
  raw: unknown,
): Promise<unknown> {
  const def = defOf(name);
  if (def.kind !== "read") throw new InvalidError(`"${name}" is not a read.`);
  assertAllowed(def, actor);
  const input = def.input.parse(raw ?? {});
  const handler = READS[def.name as CommandName];
  if (!handler) throw new NotFoundError(`"${name}" cannot be read here.`);
  return handler(pool, actor.owner, input as never);
}

const fingerprint = (def: CommandDef, input: unknown, actor: Actor) =>
  createHash("sha256")
    .update(
      `${def.name}\n${actor.staff.id}\n${actor.via}\n${JSON.stringify(input)}`,
    )
    .digest("hex");

async function contextFor(
  tx: Tx,
  actor: Actor,
  approved = false,
): Promise<Ctx> {
  const [book, clock] = [
    await loadRulebook(tx, actor.owner),
    await bankClock(tx, actor.owner),
  ];
  return {
    tx,
    owner: actor.owner,
    actor,
    book,
    now: clock.now,
    today: clock.today,
    approved,
  };
}

/** Runs the handler, or parks the command for an Approval when its gate asks for one. */
async function execute(
  ctx: Ctx,
  def: CommandDef,
  input: unknown,
): Promise<WriteOutcome> {
  const handler = HANDLERS[def.name as CommandName];
  if (!handler) throw new NotFoundError(`"${def.name}" cannot be run here.`);
  if (!ctx.approved && handler.gate) {
    const gate = await handler.gate(ctx, input);
    if (gate) {
      const summary = (await handler.describe?.(ctx, input)) ?? def.title;
      const [row] = await ctx.tx<{ id: string }[]>`
        insert into bank.approvals (
          owner, command, input, summary, reason, amount, requested_by,
          requested_via, session_id
        ) values (
          ${ctx.owner}, ${def.name}, ${ctx.tx.json(input as never)}, ${summary},
          ${gate.reason}, ${gate.amount ?? null}, ${ctx.actor.staff.id},
          ${ctx.actor.via}, ${ctx.actor.sessionId ?? null}
        ) returning id`;
      if (!row) throw new Error("The Approval was not requested");
      await auditIn(
        ctx.tx,
        { actor: ctx.actor },
        {
          action: "approval.requested",
          summary: `Waiting for a supervisor: ${summary}`,
          target: { kind: "approval", id: row.id },
          detail: {
            command: def.name,
            reason: gate.reason,
            amount: gate.amount ?? null,
          },
        },
      );
      return {
        status: "needs_approval",
        approvalId: row.id,
        summary,
        reason: gate.reason,
        message: `${gate.reason} It is waiting in Operations for a supervisor other than ${ctx.actor.staff.name}. Nothing has moved yet.`,
      };
    }
  }
  const done = await handler.run(ctx, input);
  return { status: "done", message: done.message, result: done.result };
}

/** Parks a sensitive write an agent asked for, for the person to confirm in the app. */
async function park(
  ctx: Ctx,
  def: CommandDef,
  input: unknown,
): Promise<WriteOutcome> {
  const handler = HANDLERS[def.name as CommandName];
  if (!handler) throw new NotFoundError(`"${def.name}" cannot be run here.`);
  // The gate throws when the Rules would refuse the call anyway, so the
  // person is never asked to confirm something that cannot happen.
  if (handler.gate) await handler.gate(ctx, input);
  const summary = (await handler.describe?.(ctx, input)) ?? def.title;
  const [row] = await ctx.tx<{ id: string; expiresAt: string }[]>`
    insert into bank.confirmations (
      owner, command, input, summary, requested_via, staff_id, session_id, expires_at
    ) values (
      ${ctx.owner}, ${def.name}, ${ctx.tx.json(input as never)}, ${summary},
      ${ctx.actor.via}, ${ctx.actor.staff.id}, ${ctx.actor.sessionId ?? null},
      now() + make_interval(mins => ${LIMITS.confirmationMinutes})
    ) returning id, expires_at`;
  if (!row) throw new Error("The confirmation was not requested");
  await auditIn(
    ctx.tx,
    { actor: ctx.actor },
    {
      action: "confirmation.requested",
      summary: `Asked the person to confirm: ${summary}`,
      target: { kind: "confirmation", id: row.id },
      detail: { command: def.name },
    },
  );
  return {
    status: "needs_confirmation",
    confirmationId: row.id,
    summary,
    expiresAt: row.expiresAt,
    message: `Not done yet. This needs the person's own confirmation: a card is waiting in the app ("${summary}"). Tell them to confirm or decline it there; you cannot confirm it yourself.`,
  };
}

type Parked = {
  id: string;
  command: string;
  input: unknown;
  status: string;
  staffId: string;
  via: Via;
  sessionId: string | null;
  expired?: boolean;
};

/** The Staff member a parked command was made by, as they are now. */
async function makerOf(
  tx: Tx,
  owner: Actor["owner"],
  staffId: string,
): Promise<Staff> {
  const [staff] = await tx<Staff[]>`
    select id, key, name, title, role, initials from bank.staff
    where owner = ${owner} and id = ${staffId}`;
  if (!staff)
    throw new NotFoundError(
      "The Staff member who asked is no longer in this bank.",
    );
  return staff;
}

/**
 * Runs a parked command as the Staff member who asked for it, inside a
 * savepoint: if it is refused now (the money has gone, a Rule changed), the
 * decision still stands and the parked row says why.
 */
async function runParked(
  ctx: Ctx,
  parked: Parked,
  approved: boolean,
): Promise<{ outcome: WriteOutcome | null; error: string | null }> {
  const def = defOf(parked.command);
  const maker: Actor = {
    owner: ctx.owner,
    staff: await makerOf(ctx.tx, ctx.owner, parked.staffId),
    via: parked.via,
    sessionId: parked.sessionId,
  };
  if (!can(maker.staff, def.action)) {
    return {
      outcome: null,
      error: `${maker.staff.name}'s Role may no longer do that.`,
    };
  }
  const input = def.input.parse(parked.input);
  try {
    const outcome = await ctx.tx.savepoint(async (inner) =>
      execute(
        { ...ctx, tx: inner as unknown as Tx, actor: maker, approved },
        def,
        input,
      ),
    );
    return { outcome, error: null };
  } catch (thrown) {
    const error = fromDatabase(thrown);
    if (!isSafeError(error)) throw error;
    return { outcome: null, error: error.message };
  }
}

async function decideApproval(
  ctx: Ctx,
  input: CommandInput<"decide_approval">,
): Promise<WriteOutcome> {
  const [approval] = await ctx.tx<
    (Parked & { requestedBy: string; requestedVia: Via; summary: string })[]
  >`
    select id, command, input, status, requested_by, requested_by as staff_id,
           requested_via, requested_via as via, session_id, summary
    from bank.approvals where owner = ${ctx.owner} and id = ${input.approvalId}
    for update`;
  if (!approval) throw new NotFoundError("That Approval is not in this bank.");
  if (approval.status !== "pending") {
    throw new StateError(`That Approval was already ${approval.status}.`);
  }
  const refusal = approvalRefusal(ctx.actor.staff, {
    requestedBy: approval.requestedBy,
  });
  if (refusal) throw new ForbiddenError(refusal);
  const note = input.note ?? "";
  if (input.decision === "reject") {
    await ctx.tx`
      update bank.approvals set status = 'rejected', decided_by = ${ctx.actor.staff.id},
             decision_note = ${note}, decided_at = now()
      where id = ${approval.id}`;
    await auditIn(
      ctx.tx,
      { actor: ctx.actor },
      {
        action: "approval.rejected",
        summary: `Rejected: ${approval.summary}`,
        target: { kind: "approval", id: approval.id },
        detail: { command: approval.command, note },
      },
    );
    return {
      status: "done",
      message: "Rejected. Nothing moved.",
      result: { approvalId: approval.id, status: "rejected" },
    };
  }
  const { outcome, error } = await runParked(ctx, approval, true);
  await ctx.tx`
    update bank.approvals set status = ${error ? "failed" : "approved"},
           decided_by = ${ctx.actor.staff.id},
           decision_note = ${error ?? note}, decided_at = now(),
           result = ${ctx.tx.json((outcome ?? { error }) as never)}
    where id = ${approval.id}`;
  await auditIn(
    ctx.tx,
    { actor: ctx.actor },
    {
      action: error ? "approval.failed" : "approval.approved",
      summary: error
        ? `Approved, but it could not run: ${error}`
        : `Approved: ${approval.summary}`,
      target: { kind: "approval", id: approval.id },
      detail: { command: approval.command, note, error },
    },
  );
  return {
    status: "done",
    message: error
      ? `Approved, but it could not run: ${error}`
      : `Approved. ${outcome?.message ?? ""}`.trim(),
    result: {
      approvalId: approval.id,
      status: error ? "failed" : "approved",
      outcome,
    },
  };
}

async function confirmRequest(
  ctx: Ctx,
  input: CommandInput<"confirm_request">,
): Promise<WriteOutcome> {
  const [confirmation] = await ctx.tx<(Parked & { summary: string })[]>`
    select id, command, input, status, staff_id, requested_via as via,
           session_id, summary, expires_at <= now() as expired
    from bank.confirmations where owner = ${ctx.owner} and id = ${input.confirmationId}
    for update`;
  if (!confirmation)
    throw new NotFoundError("That request is not in this bank.");
  if (confirmation.status !== "pending") {
    throw new StateError(`That request was already ${confirmation.status}.`);
  }
  if (confirmation.expired) {
    await ctx.tx`
      update bank.confirmations set status = 'expired', decided_at = now()
      where id = ${confirmation.id}`;
    return {
      status: "done",
      message: "That request ran out of time. Ask the Teller again.",
      result: { confirmationId: confirmation.id, status: "expired" },
    };
  }
  if (input.decision === "decline") {
    await ctx.tx`
      update bank.confirmations set status = 'declined', decided_at = now()
      where id = ${confirmation.id}`;
    await auditIn(
      ctx.tx,
      { actor: ctx.actor },
      {
        action: "confirmation.declined",
        summary: `Declined: ${confirmation.summary}`,
        target: { kind: "confirmation", id: confirmation.id },
        detail: { command: confirmation.command },
      },
    );
    return {
      status: "done",
      message: "Declined. Nothing was done.",
      result: { confirmationId: confirmation.id, status: "declined" },
    };
  }
  const { outcome, error } = await runParked(ctx, confirmation, false);
  await ctx.tx`
    update bank.confirmations set status = ${error ? "failed" : "confirmed"},
           decided_at = now(),
           result = ${ctx.tx.json((outcome ?? { message: error }) as never)}
    where id = ${confirmation.id}`;
  await auditIn(
    ctx.tx,
    { actor: ctx.actor },
    {
      action: error ? "confirmation.failed" : "confirmation.confirmed",
      summary: error
        ? `Confirmed, but it could not run: ${error}`
        : `Confirmed by ${ctx.actor.staff.name}: ${confirmation.summary}`,
      target: { kind: "confirmation", id: confirmation.id },
      detail: { command: confirmation.command, error },
    },
  );
  return {
    status: "done",
    message: error
      ? `It could not run: ${error}`
      : (outcome?.message ?? "Done."),
    result: {
      confirmationId: confirmation.id,
      status: error ? "failed" : "confirmed",
      sessionId: confirmation.sessionId,
      outcome,
    },
  };
}

export type WriteOptions = {
  /**
   * Unique per Owner. The same key with the same request returns the first
   * result; with a different request it is refused. Without one the command
   * is not protected against a retry.
   */
  idempotencyKey?: string | null;
};

/** Runs a write command for an actor, in one transaction. Throws typed errors. */
export async function runWrite(
  pool: Pool,
  actor: Actor,
  name: string,
  raw: unknown,
  options: WriteOptions = {},
): Promise<WriteOutcome> {
  const def = defOf(name);
  if (def.kind !== "write") throw new InvalidError(`"${name}" is not a write.`);
  assertAllowed(def, actor);
  const input = def.input.parse(raw ?? {});
  const key = options.idempotencyKey?.trim() || null;
  if (key && (key.length < 8 || key.length > 120)) {
    throw new InvalidError("An idempotency key is 8 to 120 characters.");
  }
  try {
    return (await pool.begin(async (tx) => {
      if (key) {
        const [prior] = await tx<{ result: WriteOutcome | null }[]>`
          select bank.begin_command(
            ${actor.owner}, ${key}, ${def.name}, ${fingerprint(def, input, actor)}
          ) as result`;
        if (prior?.result) return prior.result;
      }
      const ctx = await contextFor(tx as unknown as Tx, actor);
      let outcome: WriteOutcome;
      if (def.name === "decide_approval") {
        outcome = await decideApproval(
          ctx,
          input as CommandInput<"decide_approval">,
        );
      } else if (def.name === "confirm_request") {
        outcome = await confirmRequest(
          ctx,
          input as CommandInput<"confirm_request">,
        );
      } else if (actor.via !== "app" && isSensitive(def, input)) {
        outcome = await park(ctx, def, input);
      } else {
        outcome = await execute(ctx, def, input);
      }
      if (key) {
        await tx`select bank.finish_command(${actor.owner}, ${key}, ${tx.json(outcome as never)})`;
      }
      return outcome;
    })) as WriteOutcome;
  } catch (error) {
    throw fromDatabase(error);
  }
}
