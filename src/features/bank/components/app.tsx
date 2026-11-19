"use client";

import dynamic from "next/dynamic";
import { type ComponentType, useEffect, useState } from "react";
import { DemoBar } from "@/components/demo/demo-bar";
import { TABS, type Tab } from "../domain/api";
import type { OverviewView } from "../domain/views";
import { BankClock } from "./shell/bank-clock";
import { NoticeStrip } from "./shell/notice-strip";
import { StaffSwitcher } from "./shell/staff-switcher";
import { tabLabel } from "./shell/tab-label";
import { TabLoading } from "./shell/tab-loading";
import { BankTab } from "./tabs/bank-tab";
import { cx } from "./ui";
import { useBank, useRead } from "./use-bank";

/** Ties each bar tab to its panel: `bank-tab-<tab>` and `bank-panel-<tab>`. */
const PANELS_ID = "bank";

/*
 * The Bank tab is the first view, so it ships with the shell. Every other tab
 * is its own chunk, loaded the first time it opens and fetched ahead when its
 * tab is hovered or focused, or when the browser is idle. Each `import()`
 * sits inside its `dynamic()` call, as Next needs.
 */
const loading = () => <TabLoading />;
const TAB_VIEW: Record<Tab, ComponentType> = {
  bank: BankTab,
  chat: dynamic(() => import("./tabs/chat-tab").then((m) => m.ChatTab), {
    loading,
  }),
  operations: dynamic(
    () => import("./tabs/operations-tab").then((m) => m.OperationsTab),
    { loading },
  ),
  growth: dynamic(() => import("./tabs/growth-tab").then((m) => m.GrowthTab), {
    loading,
  }),
  rules: dynamic(() => import("./tabs/rules-tab").then((m) => m.RulesTab), {
    loading,
  }),
  audit: dynamic(() => import("./tabs/audit-tab").then((m) => m.AuditTab), {
    loading,
  }),
  hood: dynamic(() => import("./tabs/hood-tab").then((m) => m.HoodTab), {
    loading,
  }),
  connect: dynamic(
    () => import("./tabs/connect-tab").then((m) => m.ConnectTab),
    { loading },
  ),
};

/** The same chunks as `TAB_VIEW`'s, to fetch ahead of a click. */
const TAB_CHUNK: Record<Tab, () => Promise<unknown>> = {
  bank: () => Promise.resolve(),
  chat: () => import("./tabs/chat-tab"),
  operations: () => import("./tabs/operations-tab"),
  growth: () => import("./tabs/growth-tab"),
  rules: () => import("./tabs/rules-tab"),
  audit: () => import("./tabs/audit-tab"),
  hood: () => import("./tabs/hood-tab"),
  connect: () => import("./tabs/connect-tab"),
};

/** Loads a tab's code ahead of time. A failure is left for the tab's own load to show. */
const preloadTab = (tab: Tab) =>
  TAB_CHUNK[tab]().then(
    () => undefined,
    () => undefined,
  );

/**
 * Tidewater Bank's shell: the shared demo bar (its eight places, then the
 * bank's clock with Fast-forward and who is signed in), the play-money strip
 * with what waits on someone, and the tabs. A tab mounts the first time it is
 * opened and then stays mounted, hidden, so going back is instant and a
 * Teller answer or a Workflow being watched carries on.
 */
export function BankApp() {
  const { tab, openTab } = useBank();
  const overview = useRead<OverviewView>(
    "get_overview",
    {},
    { refetchMs: 5_000 },
  );
  const [visited, setVisited] = useState<Tab[]>(() => [tab]);
  // A tab opened from anywhere (a link in another tab, a counter) is visited.
  if (!visited.includes(tab)) setVisited([...visited, tab]);

  // Once the first view is up and the browser is idle, fetch the other tabs'
  // code, so a first click on one rarely waits for it.
  useEffect(() => {
    const load = () => {
      for (const item of TABS) void preloadTab(item);
    };
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(load, { timeout: 4_000 });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = setTimeout(load, 2_000);
    return () => clearTimeout(timer);
  }, []);

  const data = overview.data;
  const badgeOf = (item: Tab): number | undefined => {
    if (!data) return undefined;
    const count =
      item === "operations"
        ? data.openAlerts + data.pendingApprovals
        : item === "chat"
          ? data.pendingConfirmations
          : 0;
    return count > 0 ? count : undefined;
  };

  return (
    <div className="tb-root flex h-dvh flex-col overflow-clip bg-marble text-ink">
      <DemoBar
        slug="tidewater-bank"
        name="Tidewater Bank"
        titleAs="h1"
        rowFrom="xl"
        current={tab}
        panelsId={PANELS_ID}
        tabs={TABS.map((item) => ({
          id: item,
          label: tabLabel(item),
          badge: badgeOf(item),
          testId: `bank-tab-${item}`,
          onSelect: () => openTab(item),
          onIntent: () => void preloadTab(item),
        }))}
      >
        <BankClock overview={data} />
        <StaffSwitcher />
      </DemoBar>

      <NoticeStrip overview={data} />

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-clip">
        {TABS.filter((item) => visited.includes(item)).map((item) => {
          const View = TAB_VIEW[item];
          return (
            <div
              key={item}
              role="tabpanel"
              id={`${PANELS_ID}-panel-${item}`}
              aria-labelledby={`${PANELS_ID}-tab-${item}`}
              data-testid={`bank-panel-${item}`}
              className={cx(
                "min-h-0 flex-1 flex-col",
                tab === item ? "flex" : "hidden",
              )}
            >
              <View />
            </div>
          );
        })}
      </main>
    </div>
  );
}
