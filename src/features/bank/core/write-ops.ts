import { checkGrowthRequest } from "../domain/checks";
import type { CommandInput } from "../domain/commands";
import { addDays, formatDate, monthEnd } from "../domain/dates";
import { LIMITS } from "../domain/limits";
import { formatAccountNumber } from "../domain/numbers";
import { type RuleDef, ruleDef, validateParams } from "../domain/rules";
import { auditIn } from "./audit";
import {
  InvalidError,
  LimitError,
  NotFoundError,
  RuleEditRefusedError,
  RuleRefusedError,
  StateError,
} from "./errors";
import { type Ctx, enqueue, type WriteHandler } from "./ledger";
import { accountById } from "./reads";
import { concludeReview } from "./write-money";

export const decideAlert: WriteHandler<CommandInput<"decide_alert">> = {
  async describe(ctx, input) {
    const [alert] = await ctx.tx<{ summary: string }[]>`
      select summary from bank.alerts where owner = ${ctx.owner} and id = ${input.alertId}`;
    if (!alert) throw new NotFoundError("That Alert is not in this bank.");
    return `${input.decision === "release" ? "Release" : "Reject"} the held payment (${alert.summary.slice(0, 120)})`;
  },
  async run(ctx, input) {
    const done = await concludeReview(ctx, input.alertId, {
      release: input.decision === "release",
      status: input.decision === "release" ? "released" : "rejected",
      note: input.note,
      decidedBy: ctx.actor.staff.id,
    });
    if (!done)
      throw new StateError("That Alert is not waiting for a decision.");
    await auditIn(
      ctx.tx,
      { actor: ctx.actor },
      {
        action: "decide_alert",
        summary: `Held payment ${input.decision === "release" ? "released to the rail" : "rejected"}: ${input.note}`,
        target: { kind: "alert", id: input.alertId },
        detail: { decision: input.decision, paymentId: done.paymentId },
      },
    );
    return {
      message:
        input.decision === "release"
          ? "Released. The payment is now in clearing."
          : "Rejected. The money is back in the customer's available balance.",
      result: {
        alertId: input.alertId,
        paymentId: done.paymentId,
        decision: input.decision,
      },
    };
  },
};

async function saveRuleVersion(
  ctx: Ctx,
  def: RuleDef,
  params: Record<string, unknown>,
  enabled: boolean,
  note: string,
) {
  const checked = validateParams(def, params);
  if ("errors" in checked) throw new RuleEditRefusedError(checked.errors);
  if (def.required && !enabled) {
    throw new InvalidError(
      `"${def.title}" cannot be switched off: the bank does not run without it.`,
    );
  }
  // One writer at a time per Rule, so two edits never take the same Version.
  await ctx.tx`select pg_advisory_xact_lock(hashtextextended(${`${ctx.owner}:rule:${def.id}`}, 0))`;
  const [latest] = await ctx.tx<{ version: number }[]>`
    select coalesce(max(version), 0)::int as version from bank.rule_versions
    where owner = ${ctx.owner} and rule_id = ${def.id}`;
  const version = (latest?.version ?? 0) + 1;
  await ctx.tx`
    insert into bank.rule_versions (owner, rule_id, version, enabled, params, note, staff_id, staff_name)
    values (${ctx.owner}, ${def.id}, ${version}, ${enabled},
            ${ctx.tx.json(checked.params as never)}, ${note}, ${ctx.actor.staff.id},
            ${ctx.actor.staff.name})`;
  return {
    version,
    params: checked.params,
    sentence: def.sentence(checked.params),
  };
}

export const editRule: WriteHandler<CommandInput<"edit_rule">> = {
  async describe(_ctx, input) {
    const def = ruleDef(input.ruleId);
    if (!def) throw new NotFoundError("There is no such Rule.");
    const checked = validateParams(def, input.params);
    if ("errors" in checked) throw new RuleEditRefusedError(checked.errors);
    return `Change the Rule "${def.title}" to: ${def.sentence(checked.params)}${input.enabled === false ? " (switched off)" : ""}`;
  },
  async run(ctx, input) {
    const def = ruleDef(input.ruleId);
    if (!def) throw new NotFoundError("There is no such Rule.");
    const current = ctx.book[def.id as keyof typeof ctx.book];
    const saved = await saveRuleVersion(
      ctx,
      def,
      { ...current.params, ...input.params },
      input.enabled ?? current.enabled,
      input.note ?? "",
    );
    await auditIn(
      ctx.tx,
      { actor: ctx.actor },
      {
        action: "edit_rule",
        summary: `Rule "${def.title}" saved as Version ${saved.version}`,
        target: { kind: "rule", id: def.id },
        detail: {
          version: saved.version,
          params: saved.params,
          enabled: input.enabled ?? current.enabled,
          was: current.params,
        },
      },
    );
    return {
      message: `Saved Version ${saved.version} of "${def.title}": ${saved.sentence}`,
      result: {
        ruleId: def.id,
        version: saved.version,
        sentence: saved.sentence,
      },
    };
  },
};

export const restoreRule: WriteHandler<CommandInput<"restore_rule">> = {
  async describe(_ctx, input) {
    const def = ruleDef(input.ruleId);
    if (!def) throw new NotFoundError("There is no such Rule.");
    return `Restore the Rule "${def.title}" to its Default: ${def.sentence(def.defaults)}`;
  },
  async run(ctx, input) {
    const def = ruleDef(input.ruleId);
    if (!def) throw new NotFoundError("There is no such Rule.");
    const saved = await saveRuleVersion(
      ctx,
      def,
      def.defaults,
      true,
      "Restored the Default",
    );
    await auditIn(
      ctx.tx,
      { actor: ctx.actor },
      {
        action: "restore_rule",
        summary: `Rule "${def.title}" restored to its Default as Version ${saved.version}`,
        target: { kind: "rule", id: def.id },
        detail: { version: saved.version },
      },
    );
    return {
      message: `Restored "${def.title}" to its Default (Version ${saved.version}).`,
      result: {
        ruleId: def.id,
        version: saved.version,
        sentence: saved.sentence,
      },
    };
  },
};

export const advanceClock: WriteHandler<CommandInput<"advance_clock">> = {
  async run(ctx, input) {
    const [bank] = await ctx.tx<{ clockOffsetSeconds: number }[]>`
      select clock_offset_seconds from bank.banks where owner = ${ctx.owner} for update`;
    if (!bank) throw new NotFoundError("This bank has not been opened yet.");
    const offset = bank.clockOffsetSeconds + input.days * 86_400;
    if (offset > LIMITS.clockDaysAhead * 86_400) {
      throw new LimitError(
        `The clock may run at most ${LIMITS.clockDaysAhead} days ahead.`,
      );
    }
    await ctx.tx`
      update bank.banks set clock_offset_seconds = ${offset} where owner = ${ctx.owner}`;
    const to = addDays(ctx.today, input.days);
    // End-of-day runs for every date that has now ended.
    await enqueue(ctx.tx, ctx.owner, "clock.advanced", {
      through: addDays(to, -1),
    });
    await auditIn(
      ctx.tx,
      { actor: ctx.actor },
      {
        action: "advance_clock",
        summary: `Clock moved ${input.days} day(s) forward, from ${ctx.today} to ${to}`,
        target: { kind: "bank", id: ctx.owner },
        detail: { days: input.days, from: ctx.today, to },
      },
    );
    return {
      message: `The bank's date is now ${formatDate(to)}. End-of-day is running for the ${input.days} day(s) crossed, and payments due are settling.`,
      result: { from: ctx.today, to, days: input.days },
    };
  },
};

export const requestStatement: WriteHandler<CommandInput<"request_statement">> =
  {
    async run(ctx, input) {
      const account = await accountById(ctx.tx, ctx.owner, input.accountId);
      if (!["current", "savings", "term"].includes(account.kind)) {
        throw new InvalidError("Statements are for customer accounts.");
      }
      const periodStart = `${input.month}-01`;
      if (periodStart > ctx.today)
        throw new InvalidError("That month has not started yet.");
      const end = monthEnd(periodStart);
      const periodEnd = end > ctx.today ? ctx.today : end;
      await enqueue(ctx.tx, ctx.owner, "statement.generate", {
        accountId: account.id,
        periodStart,
        periodEnd,
      });
      await auditIn(
        ctx.tx,
        { actor: ctx.actor },
        {
          action: "request_statement",
          summary: `Statement of ${account.number} for ${input.month} requested`,
          target: { kind: "account", id: account.id },
          detail: { periodStart, periodEnd },
        },
      );
      return {
        message: `Generating the ${input.month} statement of ${formatAccountNumber(account.number)}. It appears under Statements in a moment.`,
        result: { accountId: account.id, periodStart, periodEnd },
      };
    },
  };

export const markNotificationsRead: WriteHandler<
  CommandInput<"mark_notifications_read">
> = {
  async run(ctx, input) {
    const rows = await ctx.tx`
      update bank.notifications set read_at = now()
      where owner = ${ctx.owner} and read_at is null
        ${input.notificationId ? ctx.tx`and id = ${input.notificationId}` : ctx.tx``}
        ${input.customerId ? ctx.tx`and customer_id = ${input.customerId}` : ctx.tx``}`;
    return {
      message: `Marked ${rows.count} notification(s) read.`,
      result: { marked: rows.count },
    };
  },
};

export const raiseRequest: WriteHandler<CommandInput<"raise_request">> = {
  async run(ctx, input) {
    const [counts] = await ctx.tx<{ today: number; open: number }[]>`
      select count(*) filter (where created_at > now() - interval '1 day')::int as today,
             count(*) filter (where status in ('requested', 'triaged', 'issue', 'pr'))::int as open
      from bank.growth_requests where owner = ${ctx.owner}`;
    if ((counts?.today ?? 0) >= LIMITS.growthPerDay) {
      throw new LimitError(
        `That's ${LIMITS.growthPerDay} Growth requests today. Try again tomorrow.`,
      );
    }
    if ((counts?.open ?? 0) >= LIMITS.growthOpenPerOwner) {
      throw new LimitError(
        `${LIMITS.growthOpenPerOwner} Growth requests are still open. Wait for one to finish.`,
      );
    }
    // The cheap half of triage runs here, so a blocked request never queues.
    const [refusal] = checkGrowthRequest(ctx.book, {
      kind: input.kind,
      title: input.title,
      want: input.want,
      evidence: input.evidence ?? "",
    });
    if (refusal) throw new RuleRefusedError(refusal);
    const [row] = await ctx.tx<{ id: string }[]>`
      insert into bank.growth_requests (owner, kind, title, want, evidence, session_id, staff_id, via)
      values (${ctx.owner}, ${input.kind}, ${input.title}, ${input.want},
              ${input.evidence ?? ""}, ${ctx.actor.sessionId ?? null},
              ${ctx.actor.staff.id}, ${ctx.actor.via})
      returning id`;
    if (!row) throw new Error("The request was not saved");
    await enqueue(ctx.tx, ctx.owner, "growth.triage", { requestId: row.id });
    await auditIn(
      ctx.tx,
      { actor: ctx.actor },
      {
        action: "raise_request",
        summary: `Growth request raised (${input.kind}): ${input.title}`,
        target: { kind: "growth_request", id: row.id },
        detail: {
          kind: input.kind,
          title: input.title,
          wantChars: input.want.length,
        },
      },
    );
    return {
      message: `Raised as a Growth request: "${input.title}". It is being triaged; if it is in scope it becomes a GitHub issue, an agent builds it, and the pull request is reviewed and merged. Follow it in the Growth tab.`,
      result: { requestId: row.id, status: "requested" },
    };
  },
};
