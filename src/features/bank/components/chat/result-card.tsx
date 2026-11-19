"use client";

import { formatDate } from "../../domain/dates";
import { formatMinor, formatMoney } from "../../domain/money";
import { formatAccountNumber } from "../../domain/numbers";
import type {
  AccountView,
  ConfirmationView,
  InstalmentView,
  TransactionView,
} from "../../domain/views";
import { Badge, DoneNote } from "../ui";
import { useBank } from "../use-bank";
import { ConfirmationCard } from "./confirmation-card";

/*
 * What a tool's structured result looks like in the chat: an account card,
 * a transactions table, a schedule, a chart, or a write's outcome. `data` is
 * whatever the command returned, so every card narrows it defensively.
 */

type Rec = Record<string, unknown>;
const rec = (value: unknown): Rec | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Rec)
    : null;
const list = <T,>(value: unknown): T[] =>
  Array.isArray(value) ? (value as T[]) : [];

function AccountCard({ account }: { account: AccountView }) {
  return (
    <div className="outline-box min-w-52 rounded-sm bg-paper p-3">
      <p className="eyebrow">{account.name}</p>
      <p className="text-ink/70 text-xs tabular-nums">
        {formatAccountNumber(account.number)}
      </p>
      <p className="mt-1 font-bold text-lg tabular-nums">
        {formatMoney(account.balance)}
      </p>
      {account.kind !== "loan" && account.kind !== "term" ? (
        <p className="text-xs tabular-nums">
          {formatMoney(account.available)} available
          {account.held > 0 ? `, ${formatMoney(account.held)} held` : ""}
        </p>
      ) : null}
      {account.status !== "open" ? (
        <Badge tone="amber">{account.status}</Badge>
      ) : null}
    </div>
  );
}

function Transactions({ rows }: { rows: TransactionView[] }) {
  const shown = rows.slice(0, 12);
  return (
    <div className="outline-box tb-scroll-x overflow-x-auto rounded-sm bg-paper">
      <table className="w-full text-left text-xs">
        <thead className="border-ink border-b-2">
          <tr>
            <th className="px-2 py-1">Date</th>
            <th className="px-2 py-1">Description</th>
            <th className="px-2 py-1 text-right">In</th>
            <th className="px-2 py-1 text-right">Out</th>
            <th className="px-2 py-1 text-right">Balance</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => (
            <tr key={row.id} className="border-ink/15 border-b">
              <td className="whitespace-nowrap px-2 py-1">
                {formatDate(row.date)}
              </td>
              <td className="px-2 py-1">{row.description}</td>
              <td className="px-2 py-1 text-right tabular-nums">
                {row.direction === "in" ? formatMinor(row.amount) : ""}
              </td>
              <td className="px-2 py-1 text-right tabular-nums">
                {row.direction === "out" ? formatMinor(row.amount) : ""}
              </td>
              <td className="px-2 py-1 text-right tabular-nums">
                {formatMinor(row.balanceAfter)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > shown.length ? (
        <p className="px-2 py-1 text-ink/70 text-xs">
          and {rows.length - shown.length} more
        </p>
      ) : null}
    </div>
  );
}

function Schedule({ rows }: { rows: InstalmentView[] }) {
  return (
    <details className="outline-box rounded-sm bg-paper p-2 text-xs">
      <summary className="press cursor-pointer font-semibold">
        Repayment schedule ({rows.length} instalments)
      </summary>
      <table className="mt-2 w-full text-left">
        <thead>
          <tr>
            <th>#</th>
            <th>Due</th>
            <th className="text-right">Principal</th>
            <th className="text-right">Interest</th>
            <th className="text-right">Balance</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.n}
              className={
                row.status === "paid"
                  ? "text-ink/50"
                  : row.status === "missed"
                    ? "text-red-700"
                    : ""
              }
            >
              <td>{row.n}</td>
              <td>{formatDate(row.dueOn)}</td>
              <td className="text-right tabular-nums">
                {formatMinor(row.principal)}
              </td>
              <td className="text-right tabular-nums">
                {formatMinor(row.interest)}
              </td>
              <td className="text-right tabular-nums">
                {formatMinor(row.balanceAfter)}
              </td>
              <td className="pl-2">{row.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

type Chart = {
  type: string;
  title: string;
  unit?: string;
  labels: string[];
  series: { name: string; values: number[] }[];
};

/** A bar or line chart drawn from the Sandbox's `CHART:` line. */
export function ChartCard({ chart }: { chart: Chart }) {
  const width = 520;
  const height = 180;
  const pad = 28;
  const values = chart.series.flatMap((series) => series.values);
  const max = Math.max(1, ...values);
  const step = (width - pad * 2) / Math.max(1, chart.labels.length);
  const y = (value: number) =>
    height - pad - (Math.max(0, value) / max) * (height - pad * 2);
  const fills = ["#1b1a17", "#b45309", "#1d4ed8", "#15803d"];
  return (
    <figure
      className="outline-box rounded-sm bg-paper p-3"
      data-testid="bank-chat-chart"
    >
      <figcaption className="eyebrow">
        {chart.title} {chart.unit ? `(${chart.unit})` : ""}
      </figcaption>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="mt-2 w-full"
        role="img"
        aria-label={chart.title}
      >
        <line
          x1={pad}
          y1={height - pad}
          x2={width - pad}
          y2={height - pad}
          stroke="#1b1a17"
          strokeWidth="2"
        />
        {chart.series.map((series, index) =>
          chart.type === "line" ? (
            <polyline
              key={series.name}
              fill="none"
              stroke={fills[index % fills.length]}
              strokeWidth="2.5"
              points={series.values
                .map((value, at) => `${pad + step * (at + 0.5)},${y(value)}`)
                .join(" ")}
            />
          ) : (
            series.values.map((value, at) => {
              const bar = (step * 0.7) / chart.series.length;
              return (
                <rect
                  // biome-ignore lint/suspicious/noArrayIndexKey: bars are positional.
                  key={`${series.name}-${at}`}
                  x={pad + step * at + step * 0.15 + bar * index}
                  y={y(value)}
                  width={bar}
                  height={height - pad - y(value)}
                  fill={fills[index % fills.length]}
                />
              );
            })
          ),
        )}
        {chart.labels.map((label, at) => (
          <text
            key={label}
            x={pad + step * (at + 0.5)}
            y={height - 8}
            textAnchor="middle"
            fontSize="10"
          >
            {label}
          </text>
        ))}
        <text x={pad} y={14} fontSize="10">
          {max.toLocaleString("en", { maximumFractionDigits: 0 })}
        </text>
      </svg>
      <p className="mt-1 flex flex-wrap gap-3 text-xs">
        {chart.series.map((series, index) => (
          <span key={series.name} className="flex items-center gap-1">
            <span
              className="inline-block size-2.5"
              style={{ background: fills[index % fills.length] }}
            />
            {series.name}
          </span>
        ))}
      </p>
    </figure>
  );
}

/** The card for one tool result, or nothing when its summary line is enough. */
export function ResultCard({
  name,
  data,
  confirmations,
  onDecided,
}: {
  name: string;
  data: unknown;
  confirmations: ConfirmationView[];
  onDecided: () => void;
}) {
  const { openTab } = useBank();
  const value = rec(data);
  if (!value) return null;

  // A write's outcome.
  if (typeof value.status === "string" && typeof value.message === "string") {
    if (
      value.status === "needs_confirmation" &&
      typeof value.confirmationId === "string"
    ) {
      const live = confirmations.find(
        (item) => item.id === value.confirmationId,
      );
      return live ? (
        <ConfirmationCard confirmation={live} onDecided={onDecided} />
      ) : (
        <p className="text-ink/70 text-xs">
          Waiting for your confirmation: {String(value.summary ?? "")}
        </p>
      );
    }
    if (value.status === "needs_approval") {
      return (
        <div className="outline-box rounded-sm bg-paper p-3 text-sm">
          <p className="eyebrow">Waiting for a supervisor</p>
          <p className="mt-1 font-semibold">{String(value.summary ?? "")}</p>
          <p className="text-xs">{String(value.reason ?? "")}</p>
          <button
            type="button"
            className="press mt-2 font-semibold text-xs underline"
            onClick={() => openTab("operations")}
          >
            Open Operations
          </button>
        </div>
      );
    }
    return value.status === "done" ? (
      <DoneNote>{value.message}</DoneNote>
    ) : null;
  }

  if (name === "run_code") {
    const chart = rec(value.chart) as Chart | null;
    return (
      <div className="flex flex-col gap-2">
        {chart ? <ChartCard chart={chart} /> : null}
        <details className="outline-box rounded-sm bg-paper p-2 text-xs">
          <summary className="press cursor-pointer font-semibold">
            Code and output ({String(value.ms ?? "?")} ms, exit{" "}
            {String(value.exitCode ?? "?")})
          </summary>
          <pre className="tb-scroll-x mt-2 overflow-x-auto whitespace-pre">
            {String(value.code ?? "")}
          </pre>
          <pre className="mt-2 whitespace-pre-wrap border-ink/20 border-t pt-2">
            {String(value.stdout ?? "")}
          </pre>
          {value.stderr ? (
            <pre className="whitespace-pre-wrap text-red-700">
              {String(value.stderr)}
            </pre>
          ) : null}
        </details>
      </div>
    );
  }

  const account = rec(value.account) as AccountView | null;
  const accounts = account ? [account] : list<AccountView>(value.accounts);
  const transactions = list<TransactionView>(value.transactions);
  const schedule = list<InstalmentView>(value.schedule);
  if (
    accounts.length === 0 &&
    transactions.length === 0 &&
    schedule.length === 0
  )
    return null;
  return (
    <div className="flex flex-col gap-2">
      {accounts.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {accounts.slice(0, 6).map((item) => (
            <AccountCard key={item.id} account={item} />
          ))}
        </div>
      ) : null}
      {transactions.length > 0 ? <Transactions rows={transactions} /> : null}
      {schedule.length > 0 ? <Schedule rows={schedule} /> : null}
    </div>
  );
}
