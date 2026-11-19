"use client";

import { useEffect, useId, useState } from "react";
import { addMonths, formatDate } from "../../domain/dates";
import {
  statementCsv,
  statementFileName,
  statementPdf,
} from "../../domain/statement-files";
import type {
  AccountView,
  StatementSummary,
  StatementView,
} from "../../domain/views";
import { Button, cx, ErrorNote, Spinner } from "../ui";
import { useCommand, useRead } from "../use-bank";
import {
  GateLine,
  Money,
  OutcomeNote,
  saveFile,
  selectClass,
  useGate,
} from "./shared";

/**
 * An account's Statements. Generating one is a Workflow, so after the write
 * the list is read every 2 seconds, for up to 20, until it appears. Each
 * Statement downloads as PDF or CSV, built here in the browser.
 */

const POLL_MS = 2_000;
const POLL_FOR_MS = 20_000;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function monthChoices(bankDate: string): { value: string; label: string }[] {
  return Array.from({ length: 12 }, (_, back) => {
    const date = addMonths(`${bankDate.slice(0, 7)}-01`, -back);
    const value = date.slice(0, 7);
    const label = `${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}${back === 0 ? " (so far)" : ""}`;
    return { value, label };
  });
}

export function StatementsPanel({
  account,
  bankDate,
}: {
  account: AccountView;
  bankDate: string;
}) {
  const id = useId();
  const gate = useGate("account.manage");
  const choices = monthChoices(bankDate);
  const [month, setMonth] = useState(
    choices[1]?.value ?? choices[0]?.value ?? "",
  );
  const [waiting, setWaiting] = useState<{
    accountId: string;
    count: number;
  } | null>(null);
  const generating = waiting?.accountId === account.id;
  const list = useRead<{ statements: StatementSummary[] }>(
    "list_statements",
    { accountId: account.id },
    { refetchMs: generating ? POLL_MS : false },
  );
  const generate = useCommand();
  const statements = list.data?.statements ?? [];

  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => setWaiting(null), POLL_FOR_MS);
    return () => clearTimeout(timer);
  }, [waiting]);
  useEffect(() => {
    if (waiting && list.data && list.data.statements.length > waiting.count)
      setWaiting(null);
  }, [waiting, list.data]);

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-3 p-4">
      <div className="flex flex-wrap items-end gap-2">
        <h4
          id={`${id}-title`}
          className="eyebrow mr-auto text-[0.65rem] font-bold text-ink-muted"
        >
          Statements
        </h4>
        <label htmlFor={`${id}-month`} className="sr-only">
          Month
        </label>
        <select
          id={`${id}-month`}
          className={cx(selectClass, "w-auto")}
          value={month}
          onChange={(event) => setMonth(event.target.value)}
        >
          {choices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          variant="primary"
          disabled={Boolean(gate) || generating}
          pending={generate.pending}
          pendingLabel="Asking…"
          title={gate ?? undefined}
          data-testid="bank-statement-generate"
          onClick={async () => {
            const outcome = await generate.run("request_statement", {
              accountId: account.id,
              month,
            });
            if (outcome?.status === "done")
              setWaiting({ accountId: account.id, count: statements.length });
          }}
        >
          Generate
        </Button>
      </div>
      <GateLine reason={gate} />
      {generating ? (
        <p
          className="flex items-center gap-2 text-sm text-ink-muted"
          aria-live="polite"
        >
          <Spinner /> Generating… a Workflow is building it from the ledger.
        </p>
      ) : (
        <OutcomeNote outcome={generate.outcome} error={generate.error} />
      )}
      {list.error ? (
        <ErrorNote onRetry={() => void list.refetch()}>
          {list.error.message}
        </ErrorNote>
      ) : null}
      {!list.data && !list.error ? (
        <div
          aria-busy="true"
          className="hx-shimmer h-10 rounded-sm border-2 border-ink/20"
        >
          <span className="sr-only" aria-live="polite">
            Loading statements
          </span>
        </div>
      ) : statements.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No statements yet. End-of-day makes one at each month end, or generate
          one.
        </p>
      ) : (
        <ul
          className="divide-y divide-ink/10 border-ink/15 border-y"
          data-testid="bank-statements"
        >
          {statements.map((statement) => (
            <StatementRow key={statement.id} statement={statement} />
          ))}
        </ul>
      )}
    </section>
  );
}

function StatementRow({ statement }: { statement: StatementSummary }) {
  const [want, setWant] = useState<"pdf" | "csv" | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const full = useRead<StatementView>(
    "get_statement",
    { statementId: statement.id },
    { enabled: want !== null },
  );

  useEffect(() => {
    if (want && full.error) {
      setFailed(full.error.message);
      setWant(null);
    }
  }, [want, full.error]);
  useEffect(() => {
    if (!want || !full.data) return;
    setFailed(null);
    const body = full.data.body;
    if (want === "pdf")
      saveFile(
        statementPdf(body) as BlobPart,
        statementFileName(body, "pdf"),
        "application/pdf",
      );
    else
      saveFile(
        statementCsv(body),
        statementFileName(body, "csv"),
        "text/csv;charset=utf-8",
      );
    setWant(null);
  }, [want, full.data]);

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2">
      <span className="min-w-0 flex-1 text-sm">
        {formatDate(statement.periodStart)} to {formatDate(statement.periodEnd)}
      </span>
      <span className="text-sm">
        <span className="eyebrow mr-2 text-[0.55rem] font-bold text-ink-muted">
          Closing
        </span>
        <Money minor={statement.closingBalance} />
      </span>
      <span className="flex gap-2">
        <Button
          size="sm"
          pending={want === "pdf"}
          pendingLabel="Building…"
          onClick={() => setWant("pdf")}
          data-testid="bank-statement-pdf"
        >
          Download PDF
        </Button>
        <Button
          size="sm"
          pending={want === "csv"}
          pendingLabel="Building…"
          onClick={() => setWant("csv")}
          data-testid="bank-statement-csv"
        >
          Download CSV
        </Button>
      </span>
      {failed ? <ErrorNote className="w-full">{failed}</ErrorNote> : null}
    </li>
  );
}
