import "server-only";
import { getRun, start } from "workflow/api";
import { HookConflictError } from "workflow/errors";
import type { Owner } from "@/features/access/domain/owner";
import type { Topic } from "../core/ledger";
import type { BankDate } from "../domain/dates";
import { sql } from "./db";
import {
  bankClearPayment,
  bankDisburseLoan,
  bankEndOfDay,
  bankGenerateStatement,
  bankGrow,
  bankNotify,
  bankReviewAlert,
} from "./workflows";

/*
 * The transactional outbox, dispatched. A command writes its message in the
 * transaction of its ledger write (`enqueue` in core/ledger.ts). Here the
 * messages are claimed (SKIP LOCKED, so two dispatchers never take the same
 * one) and each starts one Workflow run.
 *
 * Exactly once: the start is keyed on the message id (a start Hook token).
 * If this function dies after `start()` and before it records the run, the
 * message is claimed again a minute later, the second `start()` is refused
 * with the first run's id, and that id is recorded. A committed write always
 * reaches its Workflow; it never reaches it twice.
 */

type Row = { id: number; topic: Topic; payload: Record<string, string> };

const token = (id: number) => `bank-outbox:${id}`;

async function launch(owner: Owner, row: Row) {
  const message = { owner, outboxId: row.id };
  const options = {
    experimental_hook: { token: token(row.id), experimental_minRetention: "30d" as const },
  };
  const p = row.payload;
  switch (row.topic) {
    case "payment.clear":
      return start(bankClearPayment, [message, String(p.paymentId)], options);
    case "alert.review":
      return start(bankReviewAlert, [message, String(p.alertId)], options);
    case "loan.disburse":
      return start(bankDisburseLoan, [message, String(p.loanId)], options);
    case "statement.generate":
      return start(
        bankGenerateStatement,
        [message, String(p.accountId), p.periodStart as BankDate, p.periodEnd as BankDate],
        options,
      );
    case "clock.advanced":
      return start(bankEndOfDay, [message, p.through as BankDate], options);
    case "notify":
      return start(bankNotify, [message, String(p.notificationId)], options);
    case "growth.triage":
      return start(bankGrow, [message, String(p.requestId)], options);
  }
}

/**
 * Starts a Workflow for each waiting message of an Owner. Returns how many
 * it started. Safe to call often and from several places at once.
 */
export async function dispatchOutbox(owner: Owner): Promise<number> {
  const db = sql();
  const rows = await db<Row[]>`
    select id, topic, payload from bank.claim_outbox(${owner}, 25)`;
  let started = 0;
  for (const row of rows) {
    try {
      let runId: string;
      try {
        runId = (await launch(owner, row)).runId;
      } catch (error) {
        if (!HookConflictError.is(error)) throw error;
        // Already started by an earlier attempt: record that run.
        runId = error.conflictingRunId ?? "";
      }
      await db`
        update bank.outbox set status = 'dispatched', run_id = ${runId}
        where id = ${row.id} and status = 'pending'`;
      started += 1;
    } catch (error) {
      console.error("[bank] outbox", row.topic, error);
      await db`
        update bank.outbox set last_error = ${error instanceof Error ? error.message.slice(0, 300) : "start failed"},
               status = case when attempts >= 8 then 'failed' else status end
        where id = ${row.id}`;
    }
  }
  return started;
}

/**
 * Wakes every sleeping run of an Owner, so each looks at the bank again
 * now: called after the clock is fast-forwarded and after a decision a run
 * is waiting for. Best effort: a run that is not woken still wakes itself.
 */
export async function wakeSleepers(owner: Owner): Promise<number> {
  const runs = await sql()<{ runId: string | null }[]>`
    select run_id from bank.workflow_runs
    where owner = ${owner} and status in ('sleeping', 'waiting') and run_id is not null`;
  let woken = 0;
  await Promise.all(
    runs.map(async (run) => {
      try {
        const { stoppedCount } = await getRun(run.runId as string).wakeUp();
        woken += stoppedCount;
      } catch {
        // Ended meanwhile, or not sleeping after all.
      }
    }),
  );
  return woken;
}

/**
 * Everything a committed write may have left to do: owe end-of-day for a
 * date that ended by itself (the real clock crossed midnight), then start
 * the waiting Workflows. Call it after a write, and when Operations is read.
 */
export async function kick(owner: Owner, options: { wake?: boolean } = {}): Promise<void> {
  try {
    await sql()`
      insert into bank.outbox (owner, topic, payload)
      select ${owner}, 'clock.advanced', jsonb_build_object('through', (bank.today(${owner}) - 1)::text)
      from bank.banks k
      where k.owner = ${owner} and k.eod_through < bank.today(${owner}) - 1
        and not exists (
          select 1 from bank.outbox o
          where o.owner = ${owner} and o.topic = 'clock.advanced'
            and o.status in ('pending', 'dispatched'))`;
    await dispatchOutbox(owner);
    if (options.wake) await wakeSleepers(owner);
  } catch (error) {
    // The write is committed and its message is in the outbox: it is picked
    // up by the next kick. Never fail the request that committed it.
    console.error("[bank] kick", error);
  }
}
