"use client";

import { useState } from "react";
import { formatDate } from "../../domain/dates";
import { formatMoney } from "../../domain/money";
import { formatAccountNumber } from "../../domain/numbers";
import type {
  AccountDetail,
  AccountView,
  CustomerDetail,
  HoldView,
} from "../../domain/views";
import { Badge, Button, ErrorNote, Loading, Panel } from "../ui";
import { useRead } from "../use-bank";
import {
  CloseAccountDialog,
  FreezeDialog,
  OverdraftDialog,
} from "./account-controls";
import { ReceiveCreditDialog } from "./account-dialogs";
import { GateLine, Money, useGate } from "./shared";
import { StatementsPanel } from "./statements";
import { TransactionsTable } from "./transactions";

/** The selected account: what it can do, its Holds, its ledger and its Statements. */

const HOLD_LABEL: Record<HoldView["kind"], string> = {
  card: "Card purchase waiting to settle",
  review: "Payment held for review",
  approval: "Waiting for an Approval",
};

type DialogName = "credit" | "freeze" | "overdraft" | "close";

export function AccountDetailPanel({
  account,
  customer,
  bankDate,
  live,
}: {
  account: AccountView;
  customer: CustomerDetail["customer"];
  bankDate: string;
  /** Read again every few seconds while the Customer view is on screen. */
  live: boolean;
}) {
  const detail = useRead<AccountDetail>(
    "get_account",
    { accountId: account.id },
    { refetchMs: live ? 6_000 : false },
  );
  const [dialog, setDialog] = useState<DialogName | null>(null);
  const moveGate = useGate("money.move");
  const restrictGate = useGate("account.restrict");
  const manageGate = useGate("account.manage");
  const closed = account.status === "closed";
  const view = detail.data?.account.id === account.id ? detail.data : null;

  return (
    <Panel
      eyebrow={`${formatAccountNumber(account.number)} · opened ${formatDate(account.openedOn)}`}
      title={account.name}
      bodyClassName=""
      actions={
        <>
          <Button
            size="sm"
            variant="primary"
            disabled={closed || Boolean(moveGate)}
            title={moveGate ?? undefined}
            onClick={() => setDialog("credit")}
            data-testid="bank-receive-credit-open"
          >
            Receive a credit
          </Button>
          <Button
            size="sm"
            disabled={closed || Boolean(restrictGate)}
            title={restrictGate ?? undefined}
            onClick={() => setDialog("freeze")}
            data-testid="bank-account-freeze"
          >
            {account.status === "frozen" ? "Unfreeze" : "Freeze"}
          </Button>
          {account.kind === "current" ? (
            <Button
              size="sm"
              disabled={closed || Boolean(restrictGate)}
              title={restrictGate ?? undefined}
              onClick={() => setDialog("overdraft")}
            >
              Set overdraft
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            disabled={closed || Boolean(manageGate)}
            title={manageGate ?? undefined}
            onClick={() => setDialog("close")}
            data-testid="bank-account-close"
          >
            Close account
          </Button>
        </>
      }
    >
      {restrictGate && !closed ? (
        <GateLine
          className="border-ink/15 border-b px-4 py-2"
          reason={`Freeze and overdraft: ${restrictGate}`}
        />
      ) : null}
      {detail.error ? (
        <ErrorNote className="m-4" onRetry={() => void detail.refetch()}>
          {detail.error.message}
        </ErrorNote>
      ) : null}
      {!view ? (
        detail.error ? null : (
          <div className="p-4">
            <span className="sr-only" aria-live="polite">
              Loading the account
            </span>
            <Loading rows={5} />
          </div>
        )
      ) : (
        <>
          {view.holds.length > 0 ? (
            <section
              className="border-ink/15 border-b px-4 py-3"
              aria-label="Active holds"
            >
              <h4 className="eyebrow text-[0.65rem] font-bold text-ink-muted">
                Holds · {formatMoney(view.account.held)} set aside
              </h4>
              <ul className="mt-2 space-y-1" data-testid="bank-account-holds">
                {view.holds.map((hold) => (
                  <li
                    key={hold.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
                  >
                    <Badge tone={hold.kind === "card" ? "blue" : "amber"}>
                      {hold.kind}
                    </Badge>
                    <span className="min-w-0 flex-1">
                      {HOLD_LABEL[hold.kind]}
                      <span className="ml-2 font-mono text-xs text-ink-muted">
                        since {formatDate(hold.placedOn)}
                      </span>
                      {hold.expiresOn ? (
                        <span className="ml-2 font-mono text-xs text-ink-muted">
                          expires {formatDate(hold.expiresOn)}
                        </span>
                      ) : null}
                    </span>
                    <Money minor={hold.amount} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <section aria-label="Transactions" className="border-ink/15 border-b">
            <h4 className="eyebrow px-4 pt-3 text-[0.65rem] font-bold text-ink-muted">
              Transactions
            </h4>
            <TransactionsTable
              key={view.account.id}
              account={view.account}
              first={view.transactions}
              busy={detail.isFetching}
            />
          </section>
          <StatementsPanel account={view.account} bankDate={bankDate} />
        </>
      )}
      {dialog === "credit" ? (
        <ReceiveCreditDialog
          account={account}
          customer={customer}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === "freeze" ? (
        <FreezeDialog account={account} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "overdraft" ? (
        <OverdraftDialog account={account} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "close" ? (
        <CloseAccountDialog account={account} onClose={() => setDialog(null)} />
      ) : null}
    </Panel>
  );
}
