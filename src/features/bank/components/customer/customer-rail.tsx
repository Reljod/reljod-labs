"use client";

import { useId, useMemo, useState } from "react";
import { formatMoney } from "../../domain/money";
import type { CustomerSummary } from "../../domain/views";
import { Badge, Button, cx, ErrorNote, inputClass } from "../ui";
import { OpenCustomerDialog } from "./customer-forms";
import { KYC_LABEL, KYC_TONE } from "./format";
import { Money, selectClass } from "./shared";

/**
 * The Customers: a rail beside the open Customer at desktop width, a picker
 * above it on a phone. Search filters the list already on screen.
 */

const matches = (customer: CustomerSummary, query: string) => {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    customer.name.toLowerCase().includes(needle) ||
    customer.number.toLowerCase().includes(needle) ||
    customer.email.toLowerCase().includes(needle)
  );
};

export function CustomerRail({
  customers,
  loading,
  error,
  onRetry,
  openId,
  onOpen,
  busy,
}: {
  customers: CustomerSummary[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  openId: string | null;
  onOpen: (id: string) => void;
  busy: boolean;
}) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [opening, setOpening] = useState(false);
  const shown = useMemo(() => customers.filter((customer) => matches(customer, query)), [customers, query]);

  return (
    <aside
      aria-label="Customers"
      data-testid="bank-customer-rail"
      className="hidden min-h-0 w-72 shrink-0 flex-col border-ink border-r-2 bg-marble lg:flex xl:w-80"
    >
      <div className="space-y-2 border-ink border-b-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="eyebrow text-[0.65rem] font-bold text-ink-muted">Customers · {customers.length}</p>
          <Button size="sm" variant="primary" onClick={() => setOpening(true)} data-testid="bank-customer-open">
            + Open a customer
          </Button>
        </div>
        <label htmlFor={searchId} className="sr-only">
          Search customers
        </label>
        <input
          id={searchId}
          type="search"
          placeholder="Search name or number"
          className={inputClass}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          data-testid="bank-customer-search"
        />
      </div>
      <div className="hx-scroll min-h-0 flex-1" aria-busy={busy || undefined}>
        {error ? (
          <ErrorNote className="m-3" onRetry={onRetry}>
            {error}
          </ErrorNote>
        ) : null}
        {loading ? (
          <div aria-busy="true" className="space-y-2 p-3">
            <span className="sr-only" aria-live="polite">
              Loading customers
            </span>
            {["a", "b", "c", "d"].map((key) => (
              <div key={key} className="hx-shimmer h-16 rounded-sm border-2 border-ink/20" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <p className="p-4 text-sm text-ink-muted">
            {customers.length === 0 ? "No customers yet. Open the first one." : `No customer matches "${query}".`}
          </p>
        ) : (
          <ul className="divide-y divide-ink/15">
            {shown.map((customer) => {
              const selected = customer.id === openId;
              return (
                <li key={customer.id}>
                  <button
                    type="button"
                    aria-current={selected || undefined}
                    onClick={() => onOpen(customer.id)}
                    data-testid="bank-customer-row"
                    data-customer-number={customer.number}
                    className={cx(
                      "flex w-full flex-col gap-1 px-3 py-2.5 text-left transition-colors",
                      selected ? "bg-paper shadow-[inset_4px_0_0_var(--color-ink)]" : "hover:bg-paper/70",
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate font-bold">{customer.name}</span>
                      <Money minor={customer.deposits} className="text-xs" />
                    </span>
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[0.7rem] text-ink-muted">
                        {customer.number} · {customer.accounts} acct
                      </span>
                      <Badge tone={KYC_TONE[customer.kycStatus]}>{customer.kycStatus}</Badge>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {opening ? <OpenCustomerDialog onClose={() => setOpening(false)} onOpened={onOpen} /> : null}
    </aside>
  );
}

/** The phone's way to choose a Customer: a select and the open button. */
export function CustomerPicker({
  customers,
  openId,
  onOpen,
}: {
  customers: CustomerSummary[];
  openId: string | null;
  onOpen: (id: string) => void;
}) {
  const id = useId();
  const [opening, setOpening] = useState(false);
  return (
    <div className="flex items-end gap-2 border-ink border-b-2 bg-marble p-3 lg:hidden">
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="eyebrow text-[0.65rem] font-bold text-ink-muted">
          Customer
        </label>
        <select
          id={id}
          className={cx(selectClass, "mt-1")}
          value={openId ?? ""}
          onChange={(event) => onOpen(event.target.value)}
          data-testid="bank-customer-picker"
        >
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.name} · {customer.number} · {KYC_LABEL[customer.kycStatus]} · {formatMoney(customer.deposits)}
            </option>
          ))}
        </select>
      </div>
      <Button variant="primary" onClick={() => setOpening(true)} aria-label="Open a customer">
        + Open
      </Button>
      {opening ? <OpenCustomerDialog onClose={() => setOpening(false)} onOpened={onOpen} /> : null}
    </div>
  );
}
