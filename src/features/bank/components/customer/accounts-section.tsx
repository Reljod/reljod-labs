"use client";

import { useState } from "react";
import type { CustomerDetail } from "../../domain/views";
import { Button, Empty } from "../ui";
import { AccountCard } from "./account-card";
import { AccountDetailPanel } from "./account-detail";
import { OpenAccountDialog, TermDepositDialog } from "./account-dialogs";
import { GateLine, useGate } from "./shared";

/** Accounts: the Customer's deposit accounts as cards, and the one selected in detail. */
export function AccountsSection({
  detail,
  bankDate,
  live,
}: {
  detail: CustomerDetail;
  bankDate: string;
  live: boolean;
}) {
  const gate = useGate("account.manage");
  const [dialog, setDialog] = useState<"open" | "term" | null>(null);
  const [picked, setPicked] = useState<{
    customerId: string;
    accountId: string;
  } | null>(null);
  const deposits = detail.accounts
    .filter(
      (account) =>
        account.kind === "current" ||
        account.kind === "savings" ||
        account.kind === "term",
    )
    .sort(
      (a, b) => Number(a.status === "closed") - Number(b.status === "closed"),
    );
  const selectedId =
    picked?.customerId === detail.customer.id &&
    deposits.some((account) => account.id === picked.accountId)
      ? picked.accountId
      : deposits[0]?.id;
  const selected = deposits.find((account) => account.id === selectedId);

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="primary"
        disabled={Boolean(gate)}
        title={gate ?? undefined}
        onClick={() => setDialog("open")}
        data-testid="bank-account-open"
      >
        + Open an account
      </Button>
      <Button
        size="sm"
        disabled={
          Boolean(gate) ||
          deposits.every((account) => account.status !== "open")
        }
        title={gate ?? undefined}
        onClick={() => setDialog("term")}
        data-testid="bank-term-deposit-open"
      >
        Open a term deposit
      </Button>
      <GateLine reason={gate} />
    </div>
  );

  return (
    <div className="space-y-4">
      {toolbar}
      {deposits.length === 0 ? (
        <div className="outline-box rounded-sm bg-paper">
          <Empty
            title="No accounts yet"
            action={
              <Button
                variant="primary"
                disabled={Boolean(gate)}
                onClick={() => setDialog("open")}
              >
                Open an account
              </Button>
            }
          >
            Open a current account first: it takes cards, transfers and
            payments. Then receive a credit to fund it.
          </Empty>
        </div>
      ) : (
        <div
          className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3"
          data-testid="bank-accounts"
        >
          {deposits.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              selected={account.id === selectedId}
              onSelect={() =>
                setPicked({
                  customerId: detail.customer.id,
                  accountId: account.id,
                })
              }
            />
          ))}
        </div>
      )}
      {selected ? (
        <AccountDetailPanel
          key={selected.id}
          account={selected}
          customer={detail.customer}
          bankDate={bankDate}
          live={live}
        />
      ) : null}
      {dialog === "open" ? (
        <OpenAccountDialog
          customerId={detail.customer.id}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === "term" ? (
        <TermDepositDialog
          customerId={detail.customer.id}
          accounts={detail.accounts}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}
