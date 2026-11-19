"use client";

import { useState } from "react";
import { formatDate } from "../../domain/dates";
import type {
  CustomerDetail,
  PayeeView,
  StandingOrderView,
} from "../../domain/views";
import { Badge, Button, Panel } from "../ui";
import { DisputesList } from "./disputes";
import { ORDER_TONE, spendable } from "./format";
import {
  AddPayeeDialog,
  PayPayeeDialog,
  RemovePayeeDialog,
  TransferDialog,
} from "./payment-dialogs";
import { PaymentsList } from "./payments-list";
import { CancelOrderDialog, ScheduleDialog } from "./schedule-dialog";
import { GateLine, Money, useGate } from "./shared";

/** Payments: move money, the Payees, scheduled payments, the Payments list and Disputes. */

type Dialog =
  | { name: "transfer" }
  | { name: "add-payee" }
  | { name: "pay"; payeeId?: string }
  | { name: "schedule" }
  | { name: "remove-payee"; payee: PayeeView }
  | { name: "cancel-order"; order: StandingOrderView };

export function PaymentsSection({
  detail,
  bankDate,
  live,
}: {
  detail: CustomerDetail;
  bankDate: string;
  live: boolean;
}) {
  const gate = useGate("money.move");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const close = () => setDialog(null);
  const noSource = spendable(detail.accounts).length === 0;
  const disabled = Boolean(gate) || noSource;
  const title =
    gate ?? (noSource ? "Open a current or savings account first." : undefined);
  const orders = detail.standingOrders;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          disabled={disabled}
          title={title}
          onClick={() => setDialog({ name: "transfer" })}
          data-testid="bank-transfer-open"
        >
          Transfer
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={disabled || detail.payees.length === 0}
          title={
            title ??
            (detail.payees.length === 0 ? "Add a payee first." : undefined)
          }
          onClick={() => setDialog({ name: "pay" })}
          data-testid="bank-pay-payee-open"
        >
          Pay a payee
        </Button>
        <Button
          size="sm"
          disabled={disabled}
          title={title}
          onClick={() => setDialog({ name: "schedule" })}
          data-testid="bank-schedule-open"
        >
          Schedule a payment
        </Button>
        <Button
          size="sm"
          disabled={Boolean(gate)}
          title={gate ?? undefined}
          onClick={() => setDialog({ name: "add-payee" })}
          data-testid="bank-payee-add"
        >
          + Add a payee
        </Button>
        <GateLine
          reason={
            gate ??
            (noSource
              ? "Open a current or savings account to send money."
              : null)
          }
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel
          title="Payees"
          eyebrow={`${detail.payees.length} saved`}
          bodyClassName=""
        >
          {detail.payees.length === 0 ? (
            <p className="px-4 py-6 text-sm text-ink-muted">
              No payees yet. Add one to pay someone at another bank.
            </p>
          ) : (
            <ul className="divide-y divide-ink/10" data-testid="bank-payees">
              {detail.payees.map((payee) => (
                <li
                  key={payee.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2">
                      <span className="truncate font-bold">{payee.name}</span>
                      <Badge>{payee.kind}</Badge>
                    </p>
                    <p className="font-mono text-xs text-ink-muted">
                      {payee.bankCode} {payee.accountNumber}
                      {payee.reference ? ` · ${payee.reference}` : ""}
                      {payee.firstPaidOn
                        ? ` · first paid ${formatDate(payee.firstPaidOn)}`
                        : " · never paid"}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    disabled={disabled}
                    title={title}
                    onClick={() =>
                      setDialog({ name: "pay", payeeId: payee.id })
                    }
                  >
                    Pay
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={Boolean(gate)}
                    title={gate ?? undefined}
                    onClick={() => setDialog({ name: "remove-payee", payee })}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <p className="border-ink/15 border-t px-4 py-2 text-xs text-ink-muted">
            The simulated rail returns a payment to an account number ending
            0000 (account closed) or 9999 (no such account).
          </p>
        </Panel>

        <Panel
          title="Scheduled payments"
          eyebrow="End-of-day runs them"
          bodyClassName=""
        >
          {orders.length === 0 ? (
            <p className="px-4 py-6 text-sm text-ink-muted">
              Nothing scheduled. A rent or a savings habit goes here.
            </p>
          ) : (
            <ul
              className="divide-y divide-ink/10"
              data-testid="bank-standing-orders"
            >
              {orders.map((order) => (
                <li
                  key={order.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <Badge tone={ORDER_TONE[order.status]}>
                        {order.status}
                      </Badge>
                      <span className="truncate font-bold">{order.to}</span>
                      <Money minor={order.amount} className="text-sm" />
                    </p>
                    <p className="text-xs text-ink-muted">
                      {order.frequency} from{" "}
                      <span className="font-mono">{order.fromNumber}</span>
                      {order.status === "active"
                        ? ` · next ${formatDate(order.nextRunOn)}`
                        : ""}
                      {order.endsOn
                        ? ` · until ${formatDate(order.endsOn)}`
                        : ""}{" "}
                      · {order.runs} run
                      {order.runs === 1 ? "" : "s"}
                    </p>
                    {order.lastResult ? (
                      <p className="text-xs">Last: {order.lastResult}</p>
                    ) : null}
                  </div>
                  {order.status === "active" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={Boolean(gate)}
                      title={gate ?? undefined}
                      onClick={() => setDialog({ name: "cancel-order", order })}
                    >
                      Cancel
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <PaymentsList customerId={detail.customer.id} live={live} />
      <DisputesList customerId={detail.customer.id} live={live} />

      {dialog?.name === "transfer" ? (
        <TransferDialog detail={detail} onClose={close} />
      ) : null}
      {dialog?.name === "add-payee" ? (
        <AddPayeeDialog customerId={detail.customer.id} onClose={close} />
      ) : null}
      {dialog?.name === "pay" ? (
        <PayPayeeDialog
          detail={detail}
          payeeId={dialog.payeeId}
          onClose={close}
        />
      ) : null}
      {dialog?.name === "schedule" ? (
        <ScheduleDialog detail={detail} bankDate={bankDate} onClose={close} />
      ) : null}
      {dialog?.name === "remove-payee" ? (
        <RemovePayeeDialog payee={dialog.payee} onClose={close} />
      ) : null}
      {dialog?.name === "cancel-order" ? (
        <CancelOrderDialog order={dialog.order} onClose={close} />
      ) : null}
    </div>
  );
}
