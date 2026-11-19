"use client";

import { useState } from "react";
import type { OverviewView } from "../../domain/views";
import { Approvals } from "../operations/approvals";
import { liveWhile } from "../operations/figures";
import { Ledger } from "../operations/ledger";
import { Queues } from "../operations/queues";
import { Review } from "../operations/review";
import { TrialBalance } from "../operations/trial-balance";
import { Badge, type TabItem, Tabs } from "../ui";
import { useBank, useRead } from "../use-bank";

type Section = "queues" | "review" | "approvals" | "ledger" | "trial";

const REFRESH_MS = 3_000;

const count = (value: number | undefined, tone: "red" | "amber") =>
  value ? (
    <Badge tone={tone} className="ml-1">
      {value}
    </Badge>
  ) : undefined;

/**
 * The bank's own side: its queues and Workflows, the review queue,
 * maker-checker Approvals, the journal and the trial balance. Everything
 * here is read live while the tab is visible and stops when it is not.
 */
export function OperationsTab() {
  const { tab } = useBank();
  const visible = tab === "operations";
  const live = liveWhile(visible, REFRESH_MS);
  const overview = useRead<OverviewView>("get_overview", {}, live);
  const [section, setSection] = useState<Section>("queues");
  const data = overview.data;

  const sections: TabItem<Section>[] = [
    {
      id: "queues",
      label: "Queues",
      badge: data?.activeWorkflows ? (
        <Badge tone="blue" dot className="ml-1">
          {data.activeWorkflows}
        </Badge>
      ) : undefined,
    },
    { id: "review", label: "Review", badge: count(data?.openAlerts, "red") },
    {
      id: "approvals",
      label: "Approvals",
      badge: count(data?.pendingApprovals, "amber"),
    },
    { id: "ledger", label: "Ledger" },
    { id: "trial", label: "Trial balance" },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-ink border-b-2 bg-paper px-3 py-2 sm:px-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1 basis-60">
            <h2 className="font-mono text-sm font-bold tracking-[0.04em] uppercase">
              Operations
            </h2>
            <p className="text-xs text-ink-muted">
              The bank's own side. Fast-forward the clock and watch end-of-day
              run here.
            </p>
          </div>
          <div className="max-w-full py-1">
            <Tabs
              tabs={sections}
              value={section}
              onChange={setSection}
              label="Operations"
              idPrefix="bank-ops"
              size="sm"
            />
          </div>
        </div>
      </div>
      <div
        role="tabpanel"
        aria-labelledby={`bank-ops-${section}`}
        className="tb-scroll min-h-0 flex-1 p-3 sm:p-4"
        data-testid={`bank-ops-${section}-panel`}
      >
        {section === "queues" ? <Queues live={live} /> : null}
        {section === "review" ? <Review live={live} /> : null}
        {section === "approvals" ? <Approvals live={live} /> : null}
        {section === "ledger" ? <Ledger live={live} /> : null}
        {section === "trial" ? <TrialBalance live={live} /> : null}
      </div>
    </div>
  );
}
