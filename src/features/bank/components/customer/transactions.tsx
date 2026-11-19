"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type FormEvent, useId, useState } from "react";
import { formatDate } from "../../domain/dates";
import { SEARCH_CHARS } from "../../domain/search";
import type { AccountView, TransactionView } from "../../domain/views";
import { Badge, Button, ErrorNote, inputClass } from "../ui";
import { useRead } from "../use-bank";
import { DisputeDialog } from "./account-controls";
import { Money } from "./shared";

/**
 * An account's transactions from the ledger, newest first, with the running
 * balance. "Load older" pages back by the posting id; an older page belongs
 * to the first page it was asked from, so when new postings arrive on top
 * the older pages are dropped rather than left with a gap. A search keeps
 * only the rows whose description contains the text, paged the same way.
 */

const PAGE = 25;

type Older = { accountId: string; top: number | undefined; cursors: number[] };

export function TransactionsTable({
  account,
  first,
  busy,
}: {
  account: AccountView;
  first: TransactionView[];
  busy: boolean;
}) {
  const [search, setSearch] = useState({ accountId: account.id, query: "" });
  const [draft, setDraft] = useState("");
  const inputId = useId();
  const query = search.accountId === account.id ? search.query : "";
  if (first.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-ink-muted">
        No transactions yet. A credit or a transfer in starts the ledger.
      </p>
    );
  }
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSearch({ accountId: account.id, query: draft.trim() });
  };
  return (
    <div>
      <form
        aria-label="Search this account's transactions"
        onSubmit={submit}
        className="flex items-center gap-2 px-3 pt-2 pb-3"
      >
        <label htmlFor={inputId} className="sr-only">
          Search descriptions
        </label>
        <input
          id={inputId}
          type="search"
          value={draft}
          maxLength={SEARCH_CHARS}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Search descriptions, e.g. Greenmarket"
          className={inputClass}
          data-testid="bank-transactions-search"
        />
        <Button size="sm" variant="secondary" type="submit">
          Search
        </Button>
        {query ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setDraft("");
              setSearch({ accountId: account.id, query: "" });
            }}
          >
            Clear
          </Button>
        ) : null}
      </form>
      {query ? (
        <SearchResults key={query} account={account} query={query} />
      ) : (
        <LedgerTable account={account} first={first} busy={busy} />
      )}
    </div>
  );
}

function LedgerTable({
  account,
  first,
  busy,
}: {
  account: AccountView;
  first: TransactionView[];
  busy: boolean;
}) {
  const top = first[0]?.id;
  const [older, setOlder] = useState<Older>({
    accountId: account.id,
    top,
    cursors: [],
  });
  const [disputing, setDisputing] = useState<TransactionView | null>(null);
  const cursors =
    older.accountId === account.id && older.top === top ? older.cursors : [];
  const lastCursor = cursors.at(-1);
  const last = useRead<{ transactions: TransactionView[] }>(
    "list_transactions",
    { accountId: account.id, beforeId: lastCursor, limit: PAGE },
    { enabled: lastCursor !== undefined },
  );
  const tail =
    lastCursor === undefined ? first : (last.data?.transactions ?? []);
  const hasMore =
    lastCursor === undefined
      ? first.length >= PAGE
      : (last.data?.transactions.length ?? 0) >= PAGE;
  const nextCursor = tail.at(-1)?.id;

  return (
    <div>
      <div className="relative overflow-x-auto" aria-busy={busy || undefined}>
        <table
          className="w-full min-w-[40rem] text-sm"
          data-testid="bank-transactions"
        >
          <TableHead />
          <Rows
            rows={first}
            account={account}
            onDispute={setDisputing}
            animate
          />
          {cursors.map((cursor) => (
            <OlderRows
              key={cursor}
              account={account}
              beforeId={cursor}
              onDispute={setDisputing}
            />
          ))}
        </table>
      </div>
      {lastCursor !== undefined && last.error ? (
        <ErrorNote className="m-3" onRetry={() => void last.refetch()}>
          {last.error.message}
        </ErrorNote>
      ) : null}
      <div className="flex items-center justify-between gap-2 border-ink/15 border-t px-3 py-2">
        <p className="text-xs text-ink-muted">
          Every row is a Posting on a balanced journal entry.
        </p>
        {hasMore && nextCursor !== undefined ? (
          <Button
            size="sm"
            variant="ghost"
            pending={lastCursor !== undefined && last.isFetching && !last.data}
            pendingLabel="Loading…"
            onClick={() =>
              setOlder({
                accountId: account.id,
                top,
                cursors: [...cursors, nextCursor],
              })
            }
            data-testid="bank-load-older"
          >
            Load older
          </Button>
        ) : (
          <span className="text-xs text-ink-muted">
            The start of this account.
          </span>
        )}
      </div>
      {disputing ? (
        <DisputeDialog
          account={account}
          transaction={disputing}
          onClose={() => setDisputing(null)}
        />
      ) : null}
    </div>
  );
}

/** The rows whose description contains `query`, newest first, paged like the ledger. */
function SearchResults({
  account,
  query,
}: {
  account: AccountView;
  query: string;
}) {
  const [cursors, setCursors] = useState<number[]>([]);
  const [disputing, setDisputing] = useState<TransactionView | null>(null);
  const lastCursor = cursors.at(-1);
  const last = useRead<{ transactions: TransactionView[] }>(
    "list_transactions",
    { accountId: account.id, query, beforeId: lastCursor, limit: PAGE },
  );
  const rows = last.data?.transactions;
  const nextCursor = rows?.at(-1)?.id;
  if (last.error) {
    return (
      <ErrorNote className="m-3" onRetry={() => void last.refetch()}>
        {last.error.message}
      </ErrorNote>
    );
  }
  if (cursors.length === 0 && rows?.length === 0) {
    return (
      <p
        className="px-4 py-6 text-sm text-ink-muted"
        data-testid="bank-transactions-no-match"
      >
        No transactions on this account mention “{query}”.
      </p>
    );
  }
  return (
    <div>
      <div className="relative overflow-x-auto">
        <table
          className="w-full min-w-[40rem] text-sm"
          data-testid="bank-transactions"
        >
          <TableHead />
          {[undefined, ...cursors].map((cursor) => (
            <OlderRows
              key={cursor ?? "first"}
              account={account}
              beforeId={cursor}
              query={query}
              onDispute={setDisputing}
            />
          ))}
        </table>
      </div>
      <div className="flex items-center justify-between gap-2 border-ink/15 border-t px-3 py-2">
        <p className="text-xs text-ink-muted">
          Only transactions whose description contains “{query}”.
        </p>
        {rows && rows.length >= PAGE && nextCursor !== undefined ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setCursors([...cursors, nextCursor])}
          >
            Load older matches
          </Button>
        ) : rows ? (
          <span className="text-xs text-ink-muted">No older matches.</span>
        ) : null}
      </div>
      {disputing ? (
        <DisputeDialog
          account={account}
          transaction={disputing}
          onClose={() => setDisputing(null)}
        />
      ) : null}
    </div>
  );
}

function TableHead() {
  return (
    <thead>
      <tr className="eyebrow border-ink border-b-2 text-left text-[0.6rem] text-ink-muted">
        <th className="px-3 py-2 font-bold">Date</th>
        <th className="px-3 py-2 font-bold">Description</th>
        <th className="px-3 py-2 font-bold">Kind</th>
        <th className="px-3 py-2 text-right font-bold">Money in</th>
        <th className="px-3 py-2 text-right font-bold">Money out</th>
        <th className="px-3 py-2 text-right font-bold">Balance</th>
        <th className="px-3 py-2">
          <span className="sr-only">Actions</span>
        </th>
      </tr>
    </thead>
  );
}

function OlderRows({
  account,
  beforeId,
  query,
  onDispute,
}: {
  account: AccountView;
  beforeId: number | undefined;
  query?: string;
  onDispute: (row: TransactionView) => void;
}) {
  const page = useRead<{ transactions: TransactionView[] }>(
    "list_transactions",
    {
      accountId: account.id,
      query,
      beforeId,
      limit: PAGE,
    },
  );
  if (!page.data) {
    return (
      <tbody aria-busy="true">
        <tr>
          <td colSpan={7} className="px-3 py-2">
            <span className="sr-only" aria-live="polite">
              Loading older transactions
            </span>
            <div className="hx-shimmer h-8 rounded-sm border-2 border-ink/20" />
          </td>
        </tr>
      </tbody>
    );
  }
  return (
    <Rows
      rows={page.data.transactions}
      account={account}
      onDispute={onDispute}
    />
  );
}

function Rows({
  rows,
  account,
  onDispute,
  animate = false,
}: {
  rows: TransactionView[];
  account: AccountView;
  onDispute: (row: TransactionView) => void;
  animate?: boolean;
}) {
  const reduce = useReducedMotion();
  return (
    <tbody className="divide-y divide-ink/10">
      <AnimatePresence initial={false}>
        {rows.map((row) => (
          <motion.tr
            key={row.id}
            initial={animate && !reduce ? { opacity: 0, y: -6 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="align-top"
          >
            <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
              {formatDate(row.date)}
            </td>
            <td className="px-3 py-2">
              <span className="block">{row.description}</span>
              {row.disputed ? (
                <Badge tone="amber" className="mt-1">
                  Disputed
                </Badge>
              ) : null}
            </td>
            <td className="px-3 py-2 font-mono text-[0.7rem] text-ink-muted whitespace-nowrap">
              {row.kind.replace(/_/g, " ")}
            </td>
            <td className="px-3 py-2 text-right text-ivy">
              {row.direction === "in" ? <Money minor={row.amount} /> : null}
            </td>
            <td className="px-3 py-2 text-right">
              {row.direction === "out" ? <Money minor={row.amount} /> : null}
            </td>
            <td className="px-3 py-2 text-right">
              <Money
                minor={row.balanceAfter}
                className={row.balanceAfter < 0 ? "text-seal-red" : ""}
              />
            </td>
            <td className="px-3 py-1.5 text-right">
              {row.direction === "out" &&
              !row.disputed &&
              account.kind !== "term" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onDispute(row)}
                  data-testid="bank-transaction-dispute"
                >
                  Dispute
                </Button>
              ) : null}
            </td>
          </motion.tr>
        ))}
      </AnimatePresence>
    </tbody>
  );
}
