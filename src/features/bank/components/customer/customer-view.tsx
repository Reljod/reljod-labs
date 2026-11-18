"use client";

import { useState } from "react";
import type {
  CustomerDetail,
  NotificationView,
  OverviewView,
} from "../../domain/views";
import { Badge, ErrorNote, Tabs } from "../ui";
import { useBank, useRead } from "../use-bank";
import { AccountsSection } from "./accounts-section";
import { CardsSection } from "./cards-section";
import { CustomerHeader } from "./customer-header";
import { InboxSection } from "./inbox-section";
import { LoansSection } from "./loans-section";
import { PaymentsSection } from "./payments-section";
import { CardsSkeleton } from "./shared";

/**
 * One Customer, as a branch teller sees them: the header and five sections.
 * Their file is read again every 6 seconds while the Bank tab is on screen,
 * so balances move when Workflows settle things.
 */

const SECTIONS = ["accounts", "payments", "cards", "loans", "inbox"] as const;
type Section = (typeof SECTIONS)[number];

const LABEL: Record<Section, string> = {
  accounts: "Accounts",
  payments: "Payments",
  cards: "Cards",
  loans: "Loans",
  inbox: "Inbox",
};

const REFRESH_MS = 6_000;

export function CustomerView({ customerId }: { customerId: string }) {
  const { tab } = useBank();
  const live = tab === "bank";
  const [section, setSection] = useState<Section>("accounts");
  const detail = useRead<CustomerDetail>(
    "get_customer",
    { customerId },
    { refetchMs: live ? REFRESH_MS : false },
  );
  const overview = useRead<OverviewView>("get_overview");
  const inbox = useRead<{ notifications: NotificationView[] }>(
    "list_notifications",
    { customerId },
    { refetchMs: live && section === "inbox" ? REFRESH_MS : false },
  );
  const bankDate =
    overview.data?.bankDate ?? new Date().toISOString().slice(0, 10);
  const unread =
    inbox.data?.notifications.filter((item) => !item.readAt).length ?? 0;
  // The previous Customer stays on screen while the next one loads, marked busy.
  const view = detail.data;
  const stale = Boolean(view && view.customer.id !== customerId);

  if (!view) {
    return (
      <div className="space-y-4 p-4 sm:p-6" aria-busy="true">
        {detail.error ? (
          <ErrorNote onRetry={() => void detail.refetch()}>
            {detail.error.message}
          </ErrorNote>
        ) : (
          <>
            <div className="hx-shimmer h-40 rounded-sm border-2 border-ink/20" />
            <div className="hx-shimmer h-9 w-2/3 rounded-sm border-2 border-ink/20" />
            <CardsSkeleton label="Loading the customer" />
          </>
        )}
      </div>
    );
  }

  return (
    <div
      className="space-y-4 p-4 transition-opacity sm:p-6"
      style={{ opacity: stale ? 0.6 : 1 }}
      inert={stale || undefined}
      aria-busy={detail.isFetching || undefined}
    >
      {detail.error ? (
        <ErrorNote onRetry={() => void detail.refetch()}>
          {detail.error.message}
        </ErrorNote>
      ) : null}
      <CustomerHeader customer={view.customer} />
      <div className="hx-scroll-x -mx-1 px-1 py-1">
        <Tabs
          tabs={SECTIONS.map((id) => ({
            id,
            label: LABEL[id],
            badge:
              id === "inbox" && unread > 0 ? (
                <Badge tone="blue" className="ml-1.5">
                  {unread}
                </Badge>
              ) : id === "cards" && view.cards.length > 0 ? (
                <span className="ml-1.5 font-mono text-[0.65rem] opacity-70">
                  {view.cards.length}
                </span>
              ) : id === "loans" && view.loans.length > 0 ? (
                <span className="ml-1.5 font-mono text-[0.65rem] opacity-70">
                  {view.loans.length}
                </span>
              ) : undefined,
          }))}
          value={section}
          onChange={setSection}
          label="Customer sections"
          idPrefix="bank-section"
          size="sm"
        />
      </div>
      <div
        role="tabpanel"
        id={`bank-section-panel-${section}`}
        aria-labelledby={`bank-section-${section}`}
        data-testid={`bank-customer-section-${section}`}
        tabIndex={-1}
      >
        {section === "accounts" ? (
          <AccountsSection detail={view} bankDate={bankDate} live={live} />
        ) : section === "payments" ? (
          <PaymentsSection detail={view} bankDate={bankDate} live={live} />
        ) : section === "cards" ? (
          <CardsSection detail={view} live={live} />
        ) : section === "loans" ? (
          <LoansSection detail={view} live={live} />
        ) : (
          <InboxSection customerId={customerId} list={inbox} />
        )}
      </div>
    </div>
  );
}
