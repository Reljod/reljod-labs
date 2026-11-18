"use client";

import type { CustomerSummary } from "../../domain/views";
import { CustomerPicker, CustomerRail } from "../customer/customer-rail";
import { CustomerView } from "../customer/customer-view";
import { Empty } from "../ui";
import { useBank, useRead } from "../use-bank";

/**
 * The Bank tab: the bank as a branch teller sees one Customer. The
 * Customers sit in a rail on the left (a picker on a phone); the open one
 * fills the rest with Accounts, Payments, Cards, Loans and Inbox. The active
 * Staff member performs every action.
 */
export function BankTab() {
  const { customerId, setCustomerId, tab } = useBank();
  const customers = useRead<{ customers: CustomerSummary[] }>(
    "list_customers",
    {},
    { refetchMs: tab === "bank" ? 15_000 : false },
  );
  const list = customers.data?.customers ?? [];
  const openId = customerId ?? list[0]?.id ?? null;

  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col lg:flex-row"
      data-testid="bank-tab-bank"
    >
      <CustomerRail
        customers={list}
        loading={!customers.data && !customers.error}
        error={customers.error?.message ?? null}
        onRetry={() => void customers.refetch()}
        openId={openId}
        onOpen={setCustomerId}
        busy={customers.isFetching}
      />
      <CustomerPicker customers={list} openId={openId} onOpen={setCustomerId} />
      <div className="hx-scroll min-h-0 min-w-0 flex-1 bg-marble/40">
        {openId ? (
          <CustomerView customerId={openId} />
        ) : customers.data ? (
          <Empty title="No customers yet" className="py-20">
            Open the first customer with "+ Open a customer".
          </Empty>
        ) : null}
      </div>
    </div>
  );
}
