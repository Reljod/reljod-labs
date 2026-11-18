"use client";

import { motion, useReducedMotion } from "motion/react";
import { formatMinor } from "../../domain/money";
import { formatAccountNumber } from "../../domain/numbers";
import type { TrialBalanceRow, TrialBalanceView } from "../../domain/views";
import { Badge, cx } from "../ui";
import { useRead } from "../use-bank";
import {
  Amount,
  ListSkeleton,
  type Live,
  LiveNumber,
  ReadError,
} from "./figures";

const SECTIONS = ["asset", "liability", "equity", "income", "expense"] as const;

const SECTION_LABEL: Record<string, string> = {
  asset: "Assets",
  liability: "Liabilities",
  equity: "Equity",
  income: "Income",
  expense: "Expenses",
};

/**
 * The proof screen. Every Account's debit and credit totals, grouped by
 * section; the hero is the difference between all debits and all credits,
 * which is always zero, and the reconciliation that the balances the bank
 * keeps equal the sum of the Postings.
 */
export function TrialBalance({ live }: { live: Live }) {
  const read = useRead<TrialBalanceView>("get_trial_balance", {}, live);
  if (read.isPending)
    return (
      <ListSkeleton rows={6} height="h-10" label="Reading the trial balance…" />
    );
  if (!read.data)
    return <ReadError error={read.error} onRetry={() => void read.refetch()} />;
  const view = read.data;
  const difference = view.totalDebits - view.totalCredits;
  const reconciled = view.reconciliation.length === 0;
  const sections = [
    ...SECTIONS.filter((section) =>
      view.rows.some((row) => row.section === section),
    ),
    ...[...new Set(view.rows.map((row) => row.section))].filter(
      (section) => !(SECTIONS as readonly string[]).includes(section),
    ),
  ];

  return (
    <div className="space-y-3" aria-busy={read.isFetching || undefined}>
      <Seal view={view} difference={difference} reconciled={reconciled} />

      {!reconciled ? (
        <section
          className="outline-box rounded-sm border-seal-red bg-paper p-3"
          role="alert"
        >
          <h3 className="eyebrow text-[0.65rem] font-bold text-seal-red">
            Reconciliation mismatches
          </h3>
          <ul className="mt-2 space-y-1 text-sm text-seal-red">
            {view.reconciliation.map((item) => (
              <li
                key={`${item.number}-${item.problem}`}
                className="flex flex-wrap gap-x-3"
              >
                <span className="font-mono">
                  {formatAccountNumber(item.number)}
                </span>
                <span className="flex-1">{item.problem}</span>
                <span className="font-mono tabular-nums">
                  kept {formatMinor(item.materialised)} · postings{" "}
                  {formatMinor(item.ledger)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="outline-box tb-table-wrap rounded-sm bg-paper shadow-hard-sm">
        <table
          className="w-full min-w-[34rem] text-sm"
          data-testid="bank-ops-trial-table"
        >
          <thead>
            <tr className="eyebrow border-ink border-b-2 text-left text-[0.6rem] text-ink-muted">
              <th className="px-3 py-2 font-bold">Account</th>
              <th className="px-3 py-2 font-bold">Name</th>
              <th className="px-3 py-2 text-right font-bold">Debits MRF</th>
              <th className="px-3 py-2 text-right font-bold">Credits MRF</th>
              <th className="px-3 py-2 text-right font-bold">Balance</th>
            </tr>
          </thead>
          {sections.map((section) => (
            <Section
              key={section}
              section={section}
              rows={view.rows.filter((row) => row.section === section)}
            />
          ))}
          <tfoot>
            <tr className="border-ink border-t-2 bg-marble font-bold">
              <td className="px-3 py-2 eyebrow text-[0.65rem]" colSpan={2}>
                Total
              </td>
              <td className="px-3 py-2 text-right">
                <Amount minor={view.totalDebits} />
              </td>
              <td className="px-3 py-2 text-right">
                <Amount minor={view.totalCredits} />
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">
                {formatMinor(difference)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function Section({
  section,
  rows,
}: {
  section: string;
  rows: TrialBalanceRow[];
}) {
  const debits = rows.reduce((sum, row) => sum + row.debits, 0);
  const credits = rows.reduce((sum, row) => sum + row.credits, 0);
  return (
    <tbody className="border-ink/30 border-b">
      <tr className="bg-marble/60">
        <th
          scope="rowgroup"
          colSpan={2}
          className="eyebrow px-3 py-1.5 text-left text-[0.65rem] font-bold"
        >
          {SECTION_LABEL[section] ?? section}
        </th>
        <td className="px-3 py-1.5 text-right text-xs text-ink-muted">
          <Amount minor={debits} />
        </td>
        <td className="px-3 py-1.5 text-right text-xs text-ink-muted">
          <Amount minor={credits} />
        </td>
        <td />
      </tr>
      {rows.map((row) => (
        <tr key={row.accountId} className="border-ink/10 border-t">
          <td className="px-3 py-1 font-mono text-xs whitespace-nowrap text-ink-muted">
            {formatAccountNumber(row.number)}
          </td>
          <td className="max-w-64 truncate px-3 py-1">{row.name}</td>
          <td className="px-3 py-1 text-right">
            <Amount minor={row.debits} blankZero />
          </td>
          <td className="px-3 py-1 text-right">
            <Amount minor={row.credits} blankZero />
          </td>
          <td className="px-3 py-1 text-right text-xs">
            <Amount minor={row.balance} />
          </td>
        </tr>
      ))}
    </tbody>
  );
}

/** Debits = credits, difference 0.00: stamped like a seal. */
function Seal({
  view,
  difference,
  reconciled,
}: {
  view: TrialBalanceView;
  difference: number;
  reconciled: boolean;
}) {
  const reduce = useReducedMotion();
  const sound = view.balanced && difference === 0;
  return (
    <section
      className={cx(
        "outline-box grid gap-4 rounded-sm bg-paper p-4 shadow-hard-md sm:grid-cols-[minmax(0,1fr)_auto] sm:p-5",
        !sound && "border-seal-red",
      )}
      data-testid="bank-ops-trial-seal"
    >
      <div className="min-w-0 space-y-3">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-1 font-mono">
          <dt className="eyebrow text-[0.65rem] font-bold text-ink-muted">
            Total debits
          </dt>
          <dd
            className="text-right text-lg tabular-nums sm:text-xl"
            data-testid="bank-ops-trial-debits"
          >
            <LiveNumber value={formatMinor(view.totalDebits)} />
          </dd>
          <dt className="eyebrow text-[0.65rem] font-bold text-ink-muted">
            Total credits
          </dt>
          <dd
            className="text-right text-lg tabular-nums sm:text-xl"
            data-testid="bank-ops-trial-credits"
          >
            <LiveNumber value={formatMinor(view.totalCredits)} />
          </dd>
          <dt className="eyebrow border-ink border-t-2 pt-1 text-[0.65rem] font-bold">
            Difference
          </dt>
          <dd
            className={cx(
              "border-ink border-t-2 pt-1 text-right text-3xl font-bold tabular-nums sm:text-5xl",
              sound ? "text-ivy" : "text-seal-red",
            )}
            data-testid="bank-ops-trial-difference"
          >
            {formatMinor(difference)}
          </dd>
        </dl>
        <p
          className={cx(
            "flex flex-wrap items-center gap-2 text-sm",
            reconciled ? "text-ivy" : "text-seal-red",
          )}
        >
          <Badge tone={sound ? "green" : "red"}>
            {sound ? "Balanced" : "Unbalanced"}
          </Badge>
          {reconciled
            ? "Reconciled: materialised balances equal the postings."
            : `Not reconciled: ${view.reconciliation.length} account(s) differ from their postings.`}
        </p>
        <p className="font-mono text-xs text-ink-muted tabular-nums">
          {view.entries.toLocaleString("en-GB")} Entries ·{" "}
          {view.postings.toLocaleString("en-GB")} Postings
        </p>
      </div>
      <motion.div
        key={`${view.totalDebits}-${sound}`}
        initial={
          reduce ? { opacity: 0 } : { opacity: 0, scale: 1.6, rotate: -14 }
        }
        animate={{ opacity: 1, scale: 1, rotate: -8 }}
        transition={{ type: "spring", stiffness: 300, damping: 18 }}
        className="flex items-center justify-center self-center"
      >
        <span
          className={cx(
            "grid size-32 place-items-center rounded-full border-[3px] text-center font-mono text-sm font-bold tracking-[0.14em] uppercase sm:size-36",
            sound ? "border-ivy text-ivy" : "border-seal-red text-seal-red",
          )}
        >
          <span>
            {sound ? "Balanced" : "Out of balance"}
            <span className="mt-1 block text-[0.6rem] tracking-[0.08em]">
              D = C
            </span>
          </span>
        </span>
      </motion.div>
    </section>
  );
}
