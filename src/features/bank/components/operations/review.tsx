"use client";

import { useId, useState } from "react";
import { formatMoney } from "../../domain/money";
import { formatAccountNumber } from "../../domain/numbers";
import { can } from "../../domain/permissions";
import type { AlertView, Finding } from "../../domain/views";
import { CommandDialog, OutcomeNote } from "../shell/command-dialog";
import { formatStamp, relativeTime, useNow } from "../shell/time";
import { Badge, Button, cx, Empty, inputClass, type Tone } from "../ui";
import { useBank, useCommand, useRead } from "../use-bank";
import { ListSkeleton, type Live, ReadError } from "./figures";

const SEVERITY: Record<AlertView["severity"], Tone> = {
  low: "neutral",
  medium: "amber",
  high: "red",
};

const STATUS: Record<AlertView["status"], { tone: Tone; label: string }> = {
  open: { tone: "red", label: "Open" },
  released: { tone: "green", label: "Released" },
  rejected: { tone: "ink", label: "Rejected" },
  timed_out: { tone: "amber", label: "Timed out" },
  noted: { tone: "neutral", label: "Noted" },
};

const waiting = (alert: AlertView) => alert.status === "open" && alert.holding;

/**
 * The review queue: Alerts raised by the fraud and AML Checks. A holding
 * Alert keeps its Payment here until compliance releases or rejects it, or
 * its review deadline passes. Alerts raised only for the record follow,
 * quieter. One list, so a decided Alert keeps its outcome as it moves down.
 */
export function Review({ live }: { live: Live }) {
  const read = useRead<{ alerts: AlertView[] }>("list_alerts", {}, live);
  if (read.isPending)
    return (
      <ListSkeleton rows={3} height="h-32" label="Reading the review queue…" />
    );
  if (!read.data)
    return <ReadError error={read.error} onRetry={() => void read.refetch()} />;
  const alerts = [...read.data.alerts].sort(
    (a, b) => Number(waiting(b)) - Number(waiting(a)),
  );
  const firstQuiet = alerts.findIndex((alert) => !waiting(alert));
  if (alerts.length === 0) {
    return (
      <Empty title="The review queue is empty">
        A payment that trips a fraud or AML Rule is held here for compliance.
      </Empty>
    );
  }
  return (
    <ul
      className="space-y-3"
      aria-busy={read.isFetching || undefined}
      data-testid="bank-ops-alerts"
    >
      {alerts.map((alert, index) => (
        <AlertItem
          key={alert.id}
          alert={alert}
          divider={index === firstQuiet && index > 0}
        />
      ))}
    </ul>
  );
}

function AlertItem({ alert, divider }: { alert: AlertView; divider: boolean }) {
  const { activeStaff } = useBank();
  const now = useNow();
  const decide = useCommand();
  const [asking, setAsking] = useState<"release" | "reject" | null>(null);
  const [note, setNote] = useState("");
  const noteId = useId();
  const open = waiting(alert);
  const allowed = can(activeStaff, "alert.decide");
  const status = STATUS[alert.status];

  return (
    <li>
      {divider ? (
        <p className="eyebrow mt-5 mb-2 text-[0.65rem] font-bold text-ink-muted">
          Decided and noted
        </p>
      ) : null}
      <article
        className={cx(
          "outline-box rounded-sm bg-paper",
          open ? "shadow-hard-md" : "border-ink/40 bg-paper/70 text-ink-muted",
        )}
        data-testid={`bank-alert-${alert.id}`}
      >
        <header className="flex flex-wrap items-center gap-2 border-ink/20 border-b px-3 py-2">
          <Badge tone={SEVERITY[alert.severity]}>{alert.severity}</Badge>
          <Badge tone={status.tone} dot={open}>
            {status.label}
          </Badge>
          {alert.holding ? <Badge tone="ink">Holding</Badge> : null}
          <p className="min-w-0 flex-1 text-sm font-semibold text-ink">
            {alert.summary}
          </p>
          <span className="font-mono text-[0.65rem] text-ink-muted tabular-nums">
            {formatStamp(alert.raisedAt)}
          </span>
        </header>
        <div className="grid gap-3 px-3 py-2 md:grid-cols-[minmax(0,1fr)_16rem]">
          <ul className="space-y-1.5">
            {alert.findings.map((finding, index) => (
              <FindingLine
                // biome-ignore lint/suspicious/noArrayIndexKey: a Finding has no id; the list is fixed once raised.
                key={index}
                finding={finding}
              />
            ))}
          </ul>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
            {alert.payment ? (
              <>
                <dt className="text-ink-muted">Payment</dt>
                <dd className="text-right font-mono font-bold text-ink tabular-nums">
                  {formatMoney(alert.payment.amount)}
                </dd>
                <dt className="text-ink-muted">To</dt>
                <dd className="truncate text-right">
                  {alert.payment.counterparty}
                </dd>
                <dt className="text-ink-muted">Status</dt>
                <dd className="text-right">{alert.payment.status}</dd>
              </>
            ) : null}
            {alert.customerName ? (
              <>
                <dt className="text-ink-muted">Customer</dt>
                <dd className="truncate text-right">{alert.customerName}</dd>
              </>
            ) : null}
            {alert.accountNumber ? (
              <>
                <dt className="text-ink-muted">Account</dt>
                <dd className="text-right font-mono">
                  {formatAccountNumber(alert.accountNumber)}
                </dd>
              </>
            ) : null}
            {open && alert.reviewBy ? (
              <>
                <dt className="text-ink-muted">Review by</dt>
                <dd className="text-right font-semibold text-seal-red">
                  {relativeTime(alert.reviewBy, now)}
                </dd>
              </>
            ) : null}
            {alert.decidedByName ? (
              <>
                <dt className="text-ink-muted">Decided by</dt>
                <dd className="truncate text-right">{alert.decidedByName}</dd>
              </>
            ) : null}
          </dl>
        </div>
        {alert.decisionNote ? (
          <p className="border-ink/10 border-t px-3 py-1.5 text-xs">
            <span className="text-ink-muted">Note: </span>“{alert.decisionNote}”
          </p>
        ) : null}
        {open ? (
          <footer className="flex flex-wrap items-center gap-2 border-ink/20 border-t bg-marble/50 px-3 py-2">
            <Button
              size="sm"
              variant="primary"
              disabled={!allowed || decide.pending}
              onClick={() => {
                decide.reset();
                setNote("");
                setAsking("release");
              }}
              data-testid="bank-alert-release"
            >
              Release
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={!allowed || decide.pending}
              onClick={() => {
                decide.reset();
                setNote("");
                setAsking("reject");
              }}
              data-testid="bank-alert-reject"
            >
              Reject
            </Button>
            {!allowed ? (
              <span className="text-xs text-ink-muted">
                Needs a compliance officer. Switch Staff.
              </span>
            ) : null}
          </footer>
        ) : null}
        <OutcomeNote command={decide} className="m-3 mt-0" />
      </article>
      {asking ? (
        <CommandDialog
          title={
            asking === "release"
              ? "Release the held payment"
              : "Reject the held payment"
          }
          confirm={asking === "release" ? "Release it" : "Reject it"}
          pendingLabel={asking === "release" ? "Releasing…" : "Rejecting…"}
          danger={asking === "reject"}
          command={decide}
          canConfirm={note.trim().length >= 3}
          onClose={() => setAsking(null)}
          testId="bank-alert-confirm"
          onConfirm={() =>
            decide.run("decide_alert", {
              alertId: alert.id,
              decision: asking,
              note: note.trim(),
            })
          }
        >
          <p className="text-ink-muted">
            {asking === "release"
              ? `The payment${alert.payment ? ` of ${formatMoney(alert.payment.amount)} to ${alert.payment.counterparty}` : ""} goes to the rail.`
              : `The payment${alert.payment ? ` of ${formatMoney(alert.payment.amount)}` : ""} is rejected and the money returns to the account.`}{" "}
            This is recorded in the Audit trail with your note.
          </p>
          <label
            htmlFor={noteId}
            className="eyebrow block text-[0.65rem] font-bold text-ink-muted"
          >
            Your note (at least 3 characters)
          </label>
          <textarea
            id={noteId}
            value={note}
            maxLength={300}
            rows={3}
            onChange={(event) => setNote(event.target.value)}
            className={inputClass}
            data-testid="bank-alert-note"
          />
        </CommandDialog>
      ) : null}
    </li>
  );
}

/** One Finding: the Rule that decided, its Version, and what it said. */
export function FindingLine({ finding }: { finding: Finding }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
      <span className="font-mono text-[0.7rem] font-bold text-ink">
        {finding.ruleId}
      </span>
      <span className="font-mono text-[0.65rem] text-ink-muted">
        {finding.version === 0 ? "Default" : `Version ${finding.version}`}
      </span>
      <span className="min-w-0 basis-full text-ink sm:basis-auto sm:flex-1">
        {finding.message}
      </span>
    </li>
  );
}
