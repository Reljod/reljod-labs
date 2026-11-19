import { getWorkflowMetadata, sleep } from "workflow";
import type { Owner } from "@/features/access/domain/owner";
import {
  clearPayment,
  EOD_STEPS,
  eodDates,
  generateStatement,
  reviewDeadline,
  runEodStep,
} from "../core/day";
import { notify } from "../core/ledger";
import { disburseLoan } from "../core/write-cards-loans";
import type { BankDate } from "../domain/dates";
import { formatMoney } from "../domain/money";
import { sql } from "./db";
import { fileIssue, syncRequest, tellLive, triageRequest } from "./growth";
import { closeRun, noteRun, openRun } from "./run-log";

/*
 * The bank's Workflows: everything asynchronous. Each is started by the
 * outbox dispatcher for one outbox message (server/outbox.ts), exactly once,
 * and every step is safe to retry. A workflow function only orchestrates;
 * the work is in the steps.
 *
 * The names of these functions and their steps are replay keys
 * (docs/engineering/conventions.md): renaming or moving one orphans the runs
 * that are sleeping on it.
 */

type Message = { owner: Owner; outboxId: number };

/** A run sleeps at least this long between looks, and at most this long. */
const MIN_SLEEP_MS = 3_000;
const MAX_SLEEP_MS = 6 * 60 * 60_000;

function sleepUntil(wakeAt: string): Date {
  const wait = Math.min(
    Math.max(Date.parse(wakeAt) - Date.now(), MIN_SLEEP_MS),
    MAX_SLEEP_MS,
  );
  return new Date(Date.now() + wait);
}

async function begin(
  message: Message,
  kind: string,
  subject: string,
  runId: string,
) {
  "use step";
  return openRun({ ...message, kind, subject, runId });
}

async function note(owner: Owner, id: string, step: string, text: string) {
  "use step";
  await noteRun({ owner, id, step, note: text });
}

async function finish(
  message: Message,
  id: string,
  status: "completed" | "failed",
  detail: string,
) {
  "use step";
  await closeRun({
    owner: message.owner,
    id,
    outboxId: message.outboxId,
    status,
    detail,
  });
}

const message_ = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

// Clearing and settlement ---------------------------------------------------------

async function lookAtPayment(owner: Owner, id: string, paymentId: string) {
  "use step";
  const result = await clearPayment(sql(), owner, paymentId);
  await noteRun({
    owner,
    id,
    step: result.state === "waiting" ? "wait for settlement" : "settle",
    note:
      result.state === "waiting"
        ? `In clearing; settles on ${result.settlesOn}`
        : result.note,
    status: result.state === "waiting" ? "sleeping" : "running",
    wakeAt: result.state === "waiting" ? result.wakeAt : null,
  });
  return result;
}

/** A payment to another bank: sleeps until its settlement date, then settles or returns it. */
export async function bankClearPayment(message: Message, paymentId: string) {
  "use workflow";
  const { workflowRunId } = getWorkflowMetadata();
  const id = await begin(message, "payment.clear", paymentId, workflowRunId);
  try {
    for (let look = 0; look < 500; look += 1) {
      const result = await lookAtPayment(message.owner, id, paymentId);
      if (result.state !== "waiting") {
        await finish(message, id, "completed", result.note);
        return result;
      }
      // Durable sleep. Fast-forwarding the clock wakes it early.
      await sleep(sleepUntil(result.wakeAt));
    }
    await finish(message, id, "failed", "Still in clearing after 500 looks");
  } catch (error) {
    await finish(message, id, "failed", message_(error));
    throw error;
  }
}

// Fraud review deadline -------------------------------------------------------------

async function lookAtAlert(owner: Owner, id: string, alertId: string) {
  "use step";
  const result = await reviewDeadline(sql(), owner, alertId);
  await noteRun({
    owner,
    id,
    step: result.state === "waiting" ? "wait for a decision" : "conclude",
    note:
      result.state === "waiting"
        ? "Held for review; waiting for compliance or the deadline"
        : result.note,
    status: result.state === "waiting" ? "waiting" : "running",
    wakeAt: result.state === "waiting" ? result.wakeAt : null,
  });
  return result;
}

/** A held payment: waits for compliance to decide; at the deadline the Rule decides. */
export async function bankReviewAlert(message: Message, alertId: string) {
  "use workflow";
  const { workflowRunId } = getWorkflowMetadata();
  const id = await begin(message, "alert.review", alertId, workflowRunId);
  try {
    for (let look = 0; look < 500; look += 1) {
      const result = await lookAtAlert(message.owner, id, alertId);
      if (result.state !== "waiting") {
        await finish(message, id, "completed", result.note);
        return result;
      }
      await sleep(sleepUntil(result.wakeAt));
    }
    await finish(message, id, "failed", "Still open after 500 looks");
  } catch (error) {
    await finish(message, id, "failed", message_(error));
    throw error;
  }
}

// Loan disbursement -----------------------------------------------------------------

async function payOutLoan(owner: Owner, id: string, loanId: string) {
  "use step";
  const result = await sql().begin(async (tx) => {
    const [clock] = await tx<
      { today: BankDate }[]
    >`select bank.today(${owner}) as today`;
    const paid = await disburseLoan(
      tx as never,
      owner,
      loanId,
      clock?.today as BankDate,
    );
    await notify(tx as never, owner, {
      customerId: paid.customerId,
      kind: "loan",
      title: paid.disbursed
        ? "Your loan was paid out"
        : "Your loan could not be paid out",
      body: paid.disbursed
        ? `${formatMoney(paid.principal)} for loan ${paid.number} is in your account. Your repayment schedule is ready.`
        : `Loan ${paid.number}: ${paid.reason}.`,
      fanout: false,
    });
    return paid;
  });
  await noteRun({
    owner,
    id,
    step: "disburse",
    note: result.disbursed
      ? `Paid out ${formatMoney(result.principal)} and wrote the schedule`
      : `Not paid out: ${result.reason}`,
  });
  return result;
}

/** An accepted loan: paid into the customer's account, with its schedule. */
export async function bankDisburseLoan(message: Message, loanId: string) {
  "use workflow";
  const { workflowRunId } = getWorkflowMetadata();
  const id = await begin(message, "loan.disburse", loanId, workflowRunId);
  try {
    const result = await payOutLoan(message.owner, id, loanId);
    await finish(
      message,
      id,
      "completed",
      result.disbursed
        ? `Loan ${result.number} disbursed`
        : `Not disbursed: ${result.reason}`,
    );
    return result;
  } catch (error) {
    await finish(message, id, "failed", message_(error));
    throw error;
  }
}

// Statements ------------------------------------------------------------------------

async function buildStatement(
  owner: Owner,
  id: string,
  accountId: string,
  start: BankDate,
  end: BankDate,
) {
  "use step";
  const built = await generateStatement(sql(), owner, accountId, start, end);
  await noteRun({
    owner,
    id,
    step: "generate",
    note: `${built.lines} lines from the ledger, ${start} to ${end}`,
  });
  return built;
}

export async function bankGenerateStatement(
  message: Message,
  accountId: string,
  start: BankDate,
  end: BankDate,
) {
  "use workflow";
  const { workflowRunId } = getWorkflowMetadata();
  const id = await begin(
    message,
    "statement.generate",
    `${accountId} ${start}`,
    workflowRunId,
  );
  try {
    const built = await buildStatement(
      message.owner,
      id,
      accountId,
      start,
      end,
    );
    await finish(
      message,
      id,
      "completed",
      `Statement ready (${built.lines} lines)`,
    );
    return built;
  } catch (error) {
    await finish(message, id, "failed", message_(error));
    throw error;
  }
}

// End-of-day ------------------------------------------------------------------------

async function datesOwed(owner: Owner, through: BankDate) {
  "use step";
  return eodDates(sql(), owner, through);
}

async function endOfDay(owner: Owner, id: string, date: BankDate) {
  "use step";
  const lines: string[] = [];
  for (const step of EOD_STEPS)
    lines.push(await runEodStep(sql(), owner, date, step));
  await noteRun({
    owner,
    id,
    step: `end-of-day ${date}`,
    note: lines.filter((line) => !/^0 |Not a month/.test(line)).join("; "),
  });
  return lines;
}

/**
 * Runs end-of-day for every date the clock has crossed, one date per step:
 * card settlement, scheduled payments, loan collections, interest, term
 * maturities, month-end statements, then the books are proved and the day
 * closed.
 */
export async function bankEndOfDay(message: Message, through: BankDate) {
  "use workflow";
  const { workflowRunId } = getWorkflowMetadata();
  const id = await begin(
    message,
    "end-of-day",
    `through ${through}`,
    workflowRunId,
  );
  try {
    const dates = await datesOwed(message.owner, through);
    for (const date of dates) await endOfDay(message.owner, id, date);
    await finish(
      message,
      id,
      "completed",
      dates.length > 0
        ? `${dates.length} day(s) closed, through ${dates.at(-1)}`
        : "Nothing was owed",
    );
    return { days: dates.length };
  } catch (error) {
    await finish(message, id, "failed", message_(error));
    throw error;
  }
}

// Notification fan-out --------------------------------------------------------------

async function deliver(
  owner: Owner,
  notificationId: string,
  channel: "inbox" | "email" | "push",
) {
  "use step";
  // The email and push channels are simulated: delivery is recording it.
  await sql()`
    update bank.notifications
    set delivered = delivered || ${sql().json([channel])}::jsonb
    where owner = ${owner} and id = ${notificationId}
      and not delivered @> ${sql().json([channel])}::jsonb`;
  return channel;
}

/** One notification, delivered on every channel at once. */
export async function bankNotify(message: Message, notificationId: string) {
  "use workflow";
  const { workflowRunId } = getWorkflowMetadata();
  const id = await begin(message, "notify", notificationId, workflowRunId);
  try {
    const channels = await Promise.all([
      deliver(message.owner, notificationId, "inbox"),
      deliver(message.owner, notificationId, "email"),
      deliver(message.owner, notificationId, "push"),
    ]);
    await note(
      message.owner,
      id,
      "fan out",
      `Delivered on ${channels.join(", ")}`,
    );
    await finish(message, id, "completed", "Delivered on 3 channels");
  } catch (error) {
    await finish(message, id, "failed", message_(error));
    throw error;
  }
}

// Growth ----------------------------------------------------------------------------

async function triage(owner: Owner, id: string, requestId: string) {
  "use step";
  const result = await triageRequest(owner, requestId);
  await noteRun({ owner, id, step: "triage", note: result.note });
  return result;
}
triage.maxRetries = 2;

async function issue(owner: Owner, id: string, requestId: string) {
  "use step";
  const result = await fileIssue(owner, requestId);
  await noteRun({ owner, id, step: "file the issue", note: result.note });
  return result;
}
issue.maxRetries = 2;

async function watch(owner: Owner, id: string, requestId: string) {
  "use step";
  const result = await syncRequest(owner, requestId);
  await noteRun({
    owner,
    id,
    step: "watch GitHub",
    note: result.note,
    status: result.done ? "running" : "sleeping",
    wakeAt: result.done
      ? null
      : new Date(Date.now() + result.againInMs).toISOString(),
  });
  return result;
}

async function tell(owner: Owner, id: string, requestId: string) {
  "use step";
  const told = await tellLive(owner, requestId);
  await noteRun({ owner, id, step: "close the loop", note: told });
  return told;
}

/**
 * A Growth request, from the chat to the changelog: triaged (code and one
 * model call), filed as a GitHub issue, then watched while the routine
 * builds it and the PR pipeline merges it, and announced when it is live.
 */
export async function bankGrow(message: Message, requestId: string) {
  "use workflow";
  const { workflowRunId } = getWorkflowMetadata();
  const id = await begin(message, "growth", requestId, workflowRunId);
  try {
    const triaged = await triage(message.owner, id, requestId);
    if (!triaged.proceed) {
      await finish(message, id, "completed", triaged.note);
      return triaged;
    }
    let filed = await issue(message.owner, id, requestId);
    // No token yet, or the daily issue cap: try again once a day for a week.
    for (let day = 0; !filed.filed && filed.waiting && day < 7; day += 1) {
      await sleep(new Date(Date.now() + 86_400_000));
      filed = await issue(message.owner, id, requestId);
    }
    if (!filed.filed) {
      await finish(message, id, "completed", filed.note);
      return filed;
    }
    // About a week of looks: a few minutes apart at first, then backing off to an hour.
    for (let look = 0; look < 190; look += 1) {
      const state = await watch(message.owner, id, requestId);
      if (state.done) {
        const told = state.live
          ? await tell(message.owner, id, requestId)
          : state.note;
        await finish(message, id, "completed", told);
        return state;
      }
      const wait = Math.min(3_600_000, state.againInMs * Math.max(1, look - 8));
      await sleep(new Date(Date.now() + wait));
    }
    await finish(message, id, "completed", "Stopped watching after a week");
  } catch (error) {
    await finish(message, id, "failed", message_(error));
    throw error;
  }
}
