"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useId, useState } from "react";
import { formatDate } from "../../domain/dates";
import { formatMoney } from "../../domain/money";
import { formatAccountNumber } from "../../domain/numbers";
import type { PaymentView } from "../../domain/views";
import {
  Badge,
  Button,
  ErrorNote,
  Field,
  inputClass,
  Loading,
  Panel,
} from "../ui";
import { useRead } from "../use-bank";
import { PAYMENT_KIND_LABEL, PAYMENT_TONE } from "./format";
import { GateLine, Money, useGate } from "./shared";
import { amountStepUp, WriteDialog } from "./write-dialog";

/**
 * Every Payment of the Customer with its clearing status. It is read again
 * every few seconds, so a Payment in clearing moves to settled or returned
 * when the clock is fast-forwarded; the badge animates when it changes.
 */
export function PaymentsList({
  customerId,
  live,
}: {
  customerId: string;
  live: boolean;
}) {
  const list = useRead<{ payments: PaymentView[] }>(
    "list_payments",
    { customerId },
    { refetchMs: live ? 6_000 : false },
  );
  const gate = useGate("money.reverse");
  const [reversing, setReversing] = useState<PaymentView | null>(null);
  const payments = list.data?.payments ?? [];
  const reduce = useReducedMotion();

  return (
    <Panel title="Payments" eyebrow="Newest first" bodyClassName="">
      {list.error ? (
        <ErrorNote className="m-4" onRetry={() => void list.refetch()}>
          {list.error.message}
        </ErrorNote>
      ) : null}
      {!list.data && !list.error ? (
        <div className="p-4">
          <span className="sr-only" aria-live="polite">
            Loading payments
          </span>
          <Loading rows={3} />
        </div>
      ) : list.data && payments.length === 0 ? (
        <p className="px-4 py-6 text-sm text-ink-muted">
          No payments yet. A transfer, a payment or a credit shows here.
        </p>
      ) : (
        <ul
          className="divide-y divide-ink/10"
          aria-busy={list.isFetching || undefined}
          data-testid="bank-payments-list"
        >
          <AnimatePresence initial={false}>
            {payments.map((payment) => {
              const reversible =
                payment.status === "settled" &&
                (payment.kind === "internal" || payment.kind === "incoming");
              return (
                <motion.li
                  key={payment.id}
                  layout={!reduce}
                  initial={reduce ? false : { opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="grid gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[1fr_auto]"
                  data-testid="bank-payment-row"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <motion.span
                        key={payment.status}
                        initial={reduce ? false : { opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.3 }}
                        className="inline-flex"
                      >
                        <Badge
                          tone={PAYMENT_TONE[payment.status]}
                          dot={payment.status === "clearing"}
                        >
                          <span data-testid="bank-payment-status">
                            {payment.status}
                          </span>
                        </Badge>
                      </motion.span>
                      <span className="eyebrow text-[0.6rem] font-bold text-ink-muted">
                        {PAYMENT_KIND_LABEL[payment.kind] ?? payment.kind}
                      </span>
                      <span className="truncate font-bold">
                        {payment.counterparty}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-ink-muted">
                      {payment.kind === "incoming" ? "Into" : "From"}{" "}
                      <span className="font-mono">
                        {formatAccountNumber(
                          (payment.kind === "incoming"
                            ? payment.toNumber
                            : payment.fromNumber) ?? "",
                        )}
                      </span>
                      {payment.reference ? ` · "${payment.reference}"` : ""} ·
                      submitted {formatDate(payment.submittedOn)}
                      {payment.settledOn
                        ? ` · settled ${formatDate(payment.settledOn)}`
                        : payment.settlesOn && payment.status === "clearing"
                          ? ` · settles ${formatDate(payment.settlesOn)}`
                          : ""}
                    </p>
                    {payment.statusReason ? (
                      <p className="mt-0.5 text-xs">{payment.statusReason}</p>
                    ) : null}
                  </div>
                  <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end sm:justify-start">
                    <span className="text-right">
                      <Money
                        minor={
                          payment.kind === "incoming"
                            ? payment.amount
                            : -payment.amount
                        }
                        sign
                        className={
                          payment.kind === "incoming"
                            ? "font-bold text-ivy"
                            : "font-bold"
                        }
                      />
                      {payment.fee ? (
                        <span className="block text-[0.7rem] text-ink-muted">
                          fee {formatMoney(payment.fee)}
                        </span>
                      ) : null}
                    </span>
                    {reversible ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={Boolean(gate)}
                        title={gate ?? undefined}
                        onClick={() => setReversing(payment)}
                        data-testid="bank-payment-reverse"
                      >
                        Reverse
                      </Button>
                    ) : null}
                  </div>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
      {gate && payments.some((payment) => payment.status === "settled") ? (
        <GateLine
          className="border-ink/15 border-t px-4 py-2"
          reason={`Reverse: ${gate}`}
        />
      ) : null}
      {reversing ? (
        <ReverseDialog payment={reversing} onClose={() => setReversing(null)} />
      ) : null}
    </Panel>
  );
}

function ReverseDialog({
  payment,
  onClose,
}: {
  payment: PaymentView;
  onClose: () => void;
}) {
  const id = useId();
  const gate = useGate("money.reverse");
  const [reason, setReason] = useState("");
  return (
    <WriteDialog
      title="Reverse a payment"
      submit="Reverse the payment"
      pendingLabel="Reversing…"
      danger
      gate={gate}
      onClose={onClose}
      build={() => {
        if (reason.trim().length < 3) return "Give the reason for the file.";
        return {
          name: "reverse_payment",
          input: { paymentId: payment.id, reason: reason.trim() },
        };
      }}
      stepUp={() =>
        amountStepUp(
          payment.amount,
          <>
            of {payment.counterparty} is undone with a mirror journal entry. The
            original entry stays in the ledger.
          </>,
        )
      }
    >
      <p className="text-ink-muted">
        {formatMoney(payment.amount)}{" "}
        {payment.kind === "incoming" ? "from" : "to"} {payment.counterparty},
        settled {payment.settledOn ? formatDate(payment.settledOn) : ""}.
      </p>
      <Field label="Reason" htmlFor={id}>
        <input
          id={id}
          className={inputClass}
          maxLength={200}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
    </WriteDialog>
  );
}
