"use client";

import { formatDate } from "../../domain/dates";
import { formatAccountNumber } from "../../domain/numbers";
import type { OperationsView } from "../../domain/views";
import { formatStamp } from "../shell/time";
import { Badge, Empty, Panel, type Tone } from "../ui";
import { useRead } from "../use-bank";
import {
  Amount,
  Figure,
  ListSkeleton,
  type Live,
  LiveNumber,
  ReadError,
} from "./figures";
import { WorkflowRuns } from "./workflow-runs";

const OUTBOX_TONE: Record<string, Tone> = {
  pending: "amber",
  dispatched: "blue",
  done: "green",
  failed: "red",
};

/**
 * The bank's engine room: the Outbox draining into Workflows, the runs and
 * their steps, money set aside by Holds, and Payments on the rail. This is
 * where a Fast-forward is watched: end-of-day runs land here as they start.
 */
export function Queues({ live }: { live: Live }) {
  const ops = useRead<OperationsView>("get_operations", {}, live);
  if (ops.isPending) return <ListSkeleton rows={6} label="Reading the queues…" />;
  if (!ops.data) return <ReadError error={ops.error} onRetry={() => void ops.refetch()} />;
  const { outbox, workflows, holds, clearing } = ops.data;
  const widest = Math.max(1, ...outbox.byTopic.map((row) => row.waiting + row.done));

  return (
    <div className="space-y-3" aria-busy={ops.isFetching || undefined}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Figure label="Pending" value={outbox.pending} tone="text-brass" testId="bank-ops-outbox-pending" />
        <Figure label="Dispatched" value={outbox.dispatched} tone="text-federal-blue" testId="bank-ops-outbox-dispatched" />
        <Figure label="Done" value={outbox.done} tone="text-ivy" testId="bank-ops-outbox-done" />
        <Figure
          label="Failed"
          value={outbox.failed}
          tone={outbox.failed > 0 ? "text-seal-red" : "text-ink-muted"}
          testId="bank-ops-outbox-failed"
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <Panel title="Outbox by topic" eyebrow="Written with the write, delivered once">
          {outbox.byTopic.length === 0 ? (
            <p className="text-sm text-ink-muted">Nothing has been written to the Outbox yet.</p>
          ) : (
            <ul className="space-y-2.5">
              {outbox.byTopic.map((row) => (
                <li key={row.topic}>
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="truncate font-mono font-bold">{row.topic}</span>
                    <span className="shrink-0 font-mono text-ink-muted tabular-nums">
                      <LiveNumber value={row.waiting} /> waiting · <LiveNumber value={row.done} /> done
                    </span>
                  </div>
                  <div className="mt-1 flex h-3 overflow-hidden rounded-sm border border-ink bg-marble">
                    <span
                      className="block h-full bg-ink"
                      style={{ width: `${(row.done / widest) * 100}%` }}
                    />
                    <span
                      className="block h-full border-ink border-l bg-brass"
                      style={{ width: `${(row.waiting / widest) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
          {outbox.recent.length > 0 ? (
            <>
              <p className="eyebrow mt-4 mb-1 text-[0.6rem] font-bold text-ink-muted">Latest messages</p>
              <ul className="divide-y divide-ink/10 text-xs">
                {outbox.recent.map((message) => (
                  <li key={message.id} className="flex items-center gap-2 py-1">
                    <span className="w-10 shrink-0 font-mono text-ink-muted tabular-nums">#{message.id}</span>
                    <span className="min-w-0 flex-1 truncate font-mono">{message.topic}</span>
                    {message.attempts > 1 ? (
                      <span className="font-mono text-[0.65rem] text-ink-muted">×{message.attempts}</span>
                    ) : null}
                    <Badge tone={OUTBOX_TONE[message.status] ?? "neutral"}>{message.status}</Badge>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </Panel>

        <Panel title="Workflow runs" eyebrow="Durable, one per Outbox message" bodyClassName="p-0">
          <WorkflowRuns runs={workflows} />
        </Panel>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Active Holds" eyebrow="Money set aside, not yet posted" bodyClassName="p-0">
          {holds.length === 0 ? (
            <Empty title="No active Holds" />
          ) : (
            <div className="tb-table-wrap">
              <table className="w-full min-w-[26rem] text-sm">
                <thead>
                  <tr className="eyebrow border-ink border-b-2 text-left text-[0.6rem] text-ink-muted">
                    <th className="px-3 py-1.5 font-bold">Account</th>
                    <th className="px-3 py-1.5 font-bold">Kind</th>
                    <th className="px-3 py-1.5 font-bold">Placed</th>
                    <th className="px-3 py-1.5 text-right font-bold">MRF</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink/10">
                  {holds.map((hold) => (
                    <tr key={hold.id}>
                      <td className="px-3 py-1.5 font-mono text-xs whitespace-nowrap">{formatAccountNumber(hold.accountNumber)}</td>
                      <td className="px-3 py-1.5">
                        <Badge tone={hold.kind === "review" ? "red" : hold.kind === "approval" ? "amber" : "neutral"}>{hold.kind}</Badge>
                      </td>
                      <td className="px-3 py-1.5 text-xs whitespace-nowrap text-ink-muted">{formatDate(hold.placedOn)}</td>
                      <td className="px-3 py-1.5 text-right"><Amount minor={hold.amount} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="On the rail" eyebrow="Payments clearing or held for review" bodyClassName="p-0">
          {clearing.length === 0 ? (
            <Empty title="Nothing clearing">Payments to other banks wait here for their settlement date.</Empty>
          ) : (
            <div className="tb-table-wrap">
              <table className="w-full min-w-[30rem] text-sm" data-testid="bank-ops-clearing">
                <thead>
                  <tr className="eyebrow border-ink border-b-2 text-left text-[0.6rem] text-ink-muted">
                    <th className="px-3 py-1.5 font-bold">To</th>
                    <th className="px-3 py-1.5 font-bold">Status</th>
                    <th className="px-3 py-1.5 font-bold">Settles</th>
                    <th className="px-3 py-1.5 text-right font-bold">MRF</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink/10">
                  {clearing.map((payment) => (
                    <tr key={payment.id}>
                      <td className="max-w-48 px-3 py-1.5">
                        <span className="block truncate">{payment.counterparty}</span>
                        <span className="block font-mono text-[0.65rem] text-ink-muted">
                          {payment.fromNumber ? formatAccountNumber(payment.fromNumber) : payment.kind} · {formatStamp(payment.createdAt)}
                        </span>
                      </td>
                      <td className="px-3 py-1.5">
                        <Badge tone={payment.status === "held" ? "red" : "blue"} dot={payment.status === "clearing"}>
                          {payment.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-1.5 text-xs whitespace-nowrap text-ink-muted">
                        {payment.settlesOn ? formatDate(payment.settlesOn) : "under review"}
                      </td>
                      <td className="px-3 py-1.5 text-right"><Amount minor={payment.amount} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
