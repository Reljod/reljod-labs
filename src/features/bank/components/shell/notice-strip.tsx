"use client";

import { AnimatePresence, motion } from "motion/react";
import type { Tab } from "../../domain/api";
import type { OverviewView } from "../../domain/views";
import { cx } from "../ui";
import { useBank } from "../use-bank";

type Counter = {
  key: string;
  count: number;
  one: string;
  many: string;
  tab: Tab;
  tone: string;
};

/**
 * The thin strip under the bar: the play-money notice, always, and live
 * counts of what waits on someone, each a way to where it waits. A count of
 * zero is not shown.
 */
export function NoticeStrip({
  overview,
}: {
  overview: OverviewView | undefined;
}) {
  const { openTab } = useBank();
  const counters: Counter[] = overview
    ? [
        {
          key: "alerts",
          count: overview.openAlerts,
          one: "open Alert",
          many: "open Alerts",
          tab: "operations",
          tone: "bg-seal-red/10 text-seal-red",
        },
        {
          key: "approvals",
          count: overview.pendingApprovals,
          one: "Approval waiting",
          many: "Approvals waiting",
          tab: "operations",
          tone: "bg-brass/35 text-ink",
        },
        {
          key: "confirmations",
          count: overview.pendingConfirmations,
          one: "Confirmation waiting",
          many: "Confirmations waiting",
          tab: "chat",
          tone: "bg-morning-haze text-federal-blue",
        },
        {
          key: "workflows",
          count: overview.activeWorkflows,
          one: "Workflow running",
          many: "Workflows running",
          tab: "operations",
          tone: "bg-paper text-ink",
        },
      ]
    : [];
  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-ink border-b-2 bg-limestone/60 px-3 py-1 sm:px-4"
      data-testid="bank-notice"
    >
      <p className="min-w-0 flex-1 basis-full text-[0.7rem] text-ink-muted sm:basis-0">
        <span className="eyebrow mr-1.5 text-[0.6rem] font-bold text-ink">
          Play money
        </span>
        Tidewater Bank and the Meridian florin are fictional.
      </p>
      <ul className="flex flex-wrap items-center gap-1.5">
        <AnimatePresence initial={false}>
          {counters
            .filter((counter) => counter.count > 0)
            .map((counter) => (
              <motion.li
                key={counter.key}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.18 }}
              >
                <button
                  type="button"
                  onClick={() => openTab(counter.tab)}
                  data-testid={`bank-notice-${counter.key}`}
                  className={cx(
                    "inline-flex h-6 items-center gap-1 rounded-sm border border-ink px-1.5 font-mono text-[0.65rem] font-bold tracking-[0.04em] uppercase hover:-translate-y-px hover:shadow-hard-sm",
                    counter.tone,
                  )}
                >
                  <span className="tabular-nums">{counter.count}</span>
                  {counter.count === 1 ? counter.one : counter.many}
                  <span aria-hidden="true">→</span>
                </button>
              </motion.li>
            ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}
