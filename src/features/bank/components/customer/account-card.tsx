"use client";

import { motion, useReducedMotion } from "motion/react";
import { formatDate } from "../../domain/dates";
import { formatDailyRate } from "../../domain/lending";
import { formatMoney } from "../../domain/money";
import { formatAccountNumber } from "../../domain/numbers";
import type { AccountView } from "../../domain/views";
import { Badge, cx } from "../ui";
import { ACCOUNT_KIND_LABEL, ACCOUNT_TONE, rate } from "./format";
import { Money } from "./shared";

/** One deposit account as a card: its balance first, then what limits it. */
export function AccountCard({
  account,
  selected,
  onSelect,
}: {
  account: AccountView;
  selected: boolean;
  onSelect: () => void;
}) {
  const reduce = useReducedMotion();
  const differs = account.available !== account.balance || account.held > 0;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      data-testid="bank-account-card"
      data-account-number={account.number}
      className={cx(
        "outline-box press flex min-w-0 flex-col gap-2 rounded-sm p-3 text-left shadow-hard-sm",
        selected ? "bg-morning-haze" : "bg-paper hover:bg-marble",
        account.status === "closed" && "opacity-60",
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="eyebrow text-[0.6rem] font-bold text-ink-muted">
          {ACCOUNT_KIND_LABEL[account.kind]}
        </span>
        <Badge tone={ACCOUNT_TONE[account.status]}>{account.status}</Badge>
      </span>
      <span className="min-w-0">
        <span className="block truncate font-bold">{account.name}</span>
        <span className="block font-mono text-xs text-ink-muted">
          {formatAccountNumber(account.number)}
        </span>
      </span>
      <span className="flex items-baseline justify-between gap-2">
        <span className="eyebrow text-[0.6rem] font-bold text-ink-muted">
          Balance
        </span>
        <motion.span
          key={account.balance}
          initial={reduce ? false : { opacity: 0.3, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="font-mono text-xl font-bold tabular-nums"
          data-testid="bank-account-balance"
        >
          {formatMoney(account.balance)}
        </motion.span>
      </span>
      {differs ? (
        <span className="grid grid-cols-2 gap-2 border-ink/15 border-t pt-2 text-xs">
          <span>
            <span className="eyebrow block text-[0.55rem] font-bold text-ink-muted">
              Available
            </span>
            <Money minor={account.available} />
          </span>
          <span
            className="text-right"
            title="Money set aside by a Hold: a card purchase waiting to settle or a payment under review. It counts in the balance but cannot be spent."
          >
            <span className="eyebrow block text-[0.55rem] font-bold text-ink-muted">
              Held
            </span>
            <Money minor={account.held} />
          </span>
        </span>
      ) : null}
      {account.held > 0 ? (
        <span className="text-[0.7rem] text-ink-muted">
          {formatMoney(account.held)} held until card purchases settle or a
          review ends.
        </span>
      ) : null}
      <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-[0.7rem] text-ink-muted">
        {account.overdraftLimit > 0 ? (
          <span>Overdraft {formatMoney(account.overdraftLimit)}</span>
        ) : null}
        {account.kind === "savings" ? (
          <span>
            {rate(account.rateBps)} a year · accrued{" "}
            {formatMoney(account.interestAccrued)}
          </span>
        ) : null}
        {account.kind === "term" ? (
          <span>
            {rate(account.rateBps)} for {account.termMonths} months
            {account.maturesOn
              ? ` · matures ${formatDate(account.maturesOn)}`
              : ""}
          </span>
        ) : null}
        {account.kind === "current" ||
        account.kind === "savings" ||
        account.kind === "term" ? (
          <span data-testid="bank-account-daily-rate">
            Daily rate {formatDailyRate(account.rateBps)}
          </span>
        ) : null}
        {account.closedOn ? (
          <span>Closed {formatDate(account.closedOn)}</span>
        ) : null}
      </span>
    </button>
  );
}
