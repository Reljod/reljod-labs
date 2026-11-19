"use client";

import { motion, useReducedMotion } from "motion/react";
import type { NotificationView } from "../../domain/views";
import { Button, cx, ErrorNote, Loading, Panel } from "../ui";
import { useCommand } from "../use-bank";
import { formatBankTime } from "./format";
import { OutcomeNote } from "./shared";

/** The Customer's notifications, newest first, with the channels each went out on. */

const CHANNEL_LABEL: Record<string, string> = {
  inbox: "Inbox",
  email: "Email",
  push: "Push",
};

function ChannelMark({ channel }: { channel: string }) {
  return (
    <span
      className="inline-flex h-5 items-center gap-1 rounded-sm border border-ink/40 px-1.5 font-mono text-[0.6rem] tracking-[0.06em] text-ink-muted uppercase"
      title={`Delivered by ${CHANNEL_LABEL[channel] ?? channel}`}
    >
      <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden="true">
        {channel === "email" ? (
          <path
            d="M1 2h8v6H1zM1 2l4 3 4-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
          />
        ) : channel === "push" ? (
          <path
            d="M3 1h4v8H3zM4.5 7.5h1"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
          />
        ) : (
          <path
            d="M1 3h8v5H1zM1 6h2.5l1 1h1l1-1H9"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
          />
        )}
      </svg>
      {CHANNEL_LABEL[channel] ?? channel}
    </span>
  );
}

export function InboxSection({
  customerId,
  list,
}: {
  customerId: string;
  list: {
    data: { notifications: NotificationView[] } | undefined;
    error: Error | null;
    isFetching: boolean;
    refetch: () => unknown;
  };
}) {
  const mark = useCommand();
  const reduce = useReducedMotion();
  const notifications = list.data?.notifications ?? [];
  const unread = notifications.filter((item) => !item.readAt).length;

  return (
    <Panel
      title="Inbox"
      eyebrow={unread > 0 ? `${unread} unread` : "All read"}
      bodyClassName=""
      actions={
        <Button
          size="sm"
          disabled={unread === 0}
          pending={mark.pending}
          pendingLabel="Marking…"
          onClick={() =>
            void mark.run("mark_notifications_read", { customerId })
          }
          data-testid="bank-inbox-mark-read"
        >
          Mark all read
        </Button>
      }
    >
      {mark.error ? (
        <OutcomeNote className="m-4" outcome={null} error={mark.error} />
      ) : null}
      {list.error ? (
        <ErrorNote className="m-4" onRetry={() => void list.refetch()}>
          {list.error.message}
        </ErrorNote>
      ) : null}
      {!list.data && !list.error ? (
        <div className="p-4">
          <span className="sr-only" aria-live="polite">
            Loading notifications
          </span>
          <Loading rows={4} />
        </div>
      ) : list.data && notifications.length === 0 ? (
        <p className="px-4 py-6 text-sm text-ink-muted">
          Nothing yet. The bank writes here when money moves or a decision is
          made.
        </p>
      ) : (
        <ul
          className="divide-y divide-ink/10"
          aria-busy={list.isFetching || undefined}
          data-testid="bank-inbox"
        >
          {notifications.map((item) => (
            <motion.li
              key={item.id}
              initial={reduce ? false : { opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              className={cx(
                "flex gap-3 px-4 py-3",
                !item.readAt && "bg-morning-haze/40",
              )}
            >
              <span
                aria-hidden="true"
                className={cx(
                  "mt-1.5 size-2 shrink-0 rounded-full",
                  item.readAt ? "bg-transparent" : "bg-federal-blue",
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className={cx("font-bold", item.readAt && "font-normal")}>
                    {item.title}
                    {item.readAt ? null : (
                      <span className="sr-only"> (unread)</span>
                    )}
                  </p>
                  <p className="font-mono text-[0.7rem] text-ink-muted">
                    {formatBankTime(item.bankTime)}
                  </p>
                </div>
                <p className="mt-0.5 text-sm text-ink-muted">{item.body}</p>
                {item.delivered.length > 0 ? (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {item.delivered.map((channel) => (
                      <ChannelMark key={channel} channel={channel} />
                    ))}
                  </div>
                ) : null}
              </div>
            </motion.li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
