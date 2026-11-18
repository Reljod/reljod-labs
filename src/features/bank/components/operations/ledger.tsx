"use client";

import { AnimatePresence, motion } from "motion/react";
import { formatDate } from "../../domain/dates";
import { formatAccountNumber } from "../../domain/numbers";
import type { LedgerEntryView } from "../../domain/views";
import { OlderPages, type Paged, useOlderPages } from "../shell/paged";
import { formatStamp } from "../shell/time";
import { Badge, Empty } from "../ui";
import { useRead } from "../use-bank";
import { Amount, ListSkeleton, type Live, ReadError } from "./figures";

type LedgerPage = { entries: LedgerEntryView[]; nextBeforeId: number | null };

const select = (view: LedgerPage): Paged<LedgerEntryView> => ({
  items: view.entries,
  next: view.nextBeforeId,
});

/** "card_settlement" → "card settlement". */
const kindLabel = (kind: string) => kind.replace(/[._]/g, " ");

/**
 * The journal, newest first: every Entry with its Postings as a small
 * debit/credit table. Each Entry balances; the Trial balance sums them.
 */
export function Ledger({ live }: { live: Live }) {
  const head = useRead<LedgerPage>("list_ledger", {}, live);
  const older = useOlderPages("ledger");
  if (head.isPending) return <ListSkeleton rows={4} height="h-28" label="Reading the journal…" />;
  if (!head.data) return <ReadError error={head.error} onRetry={() => void head.refetch()} />;
  if (head.data.entries.length === 0) {
    return <Empty title="No Entries yet">Every movement of money posts a balanced Entry here.</Empty>;
  }
  const render = (entries: LedgerEntryView[]) =>
    entries.map((entry) => <EntryCard key={entry.id} entry={entry} />);
  return (
    <ul className="space-y-2.5" aria-busy={head.isFetching || undefined} data-testid="bank-ops-ledger">
      <AnimatePresence initial={false}>
        {head.data.entries.map((entry) => (
          <motion.li
            key={entry.id}
            layout="position"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
          >
            <EntryBody entry={entry} />
          </motion.li>
        ))}
      </AnimatePresence>
      <OlderPages
        name="list_ledger"
        input={{}}
        select={select}
        render={render}
        head={select(head.data)}
        cursors={older.cursors}
        onMore={older.more}
        endLabel="The first Entry of this bank."
        testId="bank-ops-ledger-older"
      />
    </ul>
  );
}

function EntryCard({ entry }: { entry: LedgerEntryView }) {
  return (
    <li>
      <EntryBody entry={entry} />
    </li>
  );
}

function EntryBody({ entry }: { entry: LedgerEntryView }) {
  const debits = entry.postings.filter((posting) => posting.direction === "D");
  const credits = entry.postings.filter((posting) => posting.direction === "C");
  return (
    <article className="outline-box rounded-sm bg-paper shadow-hard-sm">
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-ink/20 border-b px-3 py-1.5">
        <span className="font-mono text-xs font-bold tabular-nums">#{entry.id}</span>
        <Badge tone={entry.reversesEntryId ? "amber" : "neutral"}>{kindLabel(entry.kind)}</Badge>
        {entry.reversesEntryId ? (
          <span className="font-mono text-[0.7rem] text-seal-red">reverses #{entry.reversesEntryId}</span>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-sm">{entry.description}</span>
        <span className="font-mono text-[0.65rem] text-ink-muted tabular-nums" title={formatStamp(entry.at)}>
          {formatDate(entry.date)} · via {entry.via}
        </span>
      </header>
      <div className="tb-table-wrap">
        <table className="w-full min-w-[22rem] text-xs">
          <thead className="sr-only">
            <tr>
              <th>Account</th>
              <th>Name</th>
              <th>Debit MRF</th>
              <th>Credit MRF</th>
            </tr>
          </thead>
          <tbody>
            {[...debits, ...credits].map((posting, index) => (
              <tr
                // biome-ignore lint/suspicious/noArrayIndexKey: an Entry's Postings never change; one account may appear twice.
                key={index}
                className="border-ink/10 border-b last:border-b-0"
              >
                <td className="w-40 px-3 py-1 font-mono whitespace-nowrap text-ink-muted">
                  {formatAccountNumber(posting.number)}
                </td>
                <td className={posting.direction === "C" ? "py-1 pl-6" : "py-1"}>
                  <span className="block max-w-56 truncate">{posting.name}</span>
                </td>
                <td className="w-28 px-3 py-1 text-right">
                  {posting.direction === "D" ? (
                    <>
                      <span className="mr-1 text-[0.6rem] text-ink-muted">D</span>
                      <Amount minor={posting.amount} />
                    </>
                  ) : null}
                </td>
                <td className="w-28 px-3 py-1 text-right">
                  {posting.direction === "C" ? (
                    <>
                      <span className="mr-1 text-[0.6rem] text-ink-muted">C</span>
                      <Amount minor={posting.amount} />
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}
