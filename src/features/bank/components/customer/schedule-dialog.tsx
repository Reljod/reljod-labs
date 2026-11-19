"use client";

import { useId, useState } from "react";
import { formatDate, isBankDate } from "../../domain/dates";
import { formatMoney } from "../../domain/money";
import { formatAccountNumber } from "../../domain/numbers";
import type { CustomerDetail, StandingOrderView } from "../../domain/views";
import { cx, Field, inputClass, segmentClass, segmentsClass } from "../ui";
import { AccountSelect } from "./account-dialogs";
import {
  AccountNumberField,
  accountNumberProblem,
  digitsOf,
} from "./account-number-field";
import { spendable } from "./format";
import { ReferenceField, sourceName } from "./payment-dialogs";
import { amountOf, MoneyField, selectClass, useGate } from "./shared";
import { amountStepUp, WriteDialog } from "./write-dialog";

/** Scheduled payments: schedule one, cancel one. */

type Frequency = StandingOrderView["frequency"];

export function ScheduleDialog({
  detail,
  bankDate,
  onClose,
}: {
  detail: CustomerDetail;
  bankDate: string;
  onClose: () => void;
}) {
  const id = useId();
  const gate = useGate("money.move");
  const sources = spendable(detail.accounts);
  const [from, setFrom] = useState(sources[0]?.id ?? "");
  const [target, setTarget] = useState<"payee" | "account">(
    detail.payees.length > 0 ? "payee" : "account",
  );
  const [payee, setPayee] = useState(detail.payees[0]?.id ?? "");
  const [to, setTo] = useState("");
  const [amountText, setAmountText] = useState("");
  const [frequency, setFrequency] = useState<Frequency>("monthly");
  const [startOn, setStartOn] = useState(bankDate);
  const [endsOn, setEndsOn] = useState("");
  const [reference, setReference] = useState("");
  const amount = amountOf(amountText);
  const source = sources.find((account) => account.id === from);
  const payeeView = detail.payees.find((item) => item.id === payee);
  const early = isBankDate(startOn) && startOn < bankDate;
  const label =
    target === "payee"
      ? (payeeView?.name ?? "the payee")
      : `Tidewater account ${formatAccountNumber(digitsOf(to))}`;
  return (
    <WriteDialog
      title="Schedule a payment"
      submit="Schedule"
      pendingLabel="Scheduling…"
      gate={gate}
      onClose={onClose}
      build={() => {
        if (!source) return "Choose the account the money leaves.";
        if (target === "payee" && !payeeView)
          return "Choose a payee, or add one first.";
        if (target === "account") {
          const problem = accountNumberProblem(to);
          if (!to.trim() || problem)
            return problem ?? "Give the Tidewater account number.";
        }
        if (!amount) return "Give the amount.";
        if (!isBankDate(startOn)) return "Give the first date.";
        if (early)
          return `The first date cannot be before the bank date, ${formatDate(bankDate)}.`;
        if (
          endsOn &&
          frequency !== "once" &&
          (!isBankDate(endsOn) || endsOn < startOn)
        )
          return "The end date must be on or after the first date.";
        return {
          name: "create_standing_order",
          input: {
            fromAccountId: from,
            ...(target === "payee"
              ? { payeeId: payee }
              : { toAccountNumber: digitsOf(to) }),
            amount,
            frequency,
            startOn,
            endsOn: frequency !== "once" && endsOn ? endsOn : undefined,
            reference: reference.trim() || undefined,
          },
        };
      }}
      stepUp={() =>
        amountStepUp(
          amount ?? 0,
          <>
            leaves {sourceName(source)} for {label}{" "}
            {frequency === "once" ? "once" : frequency}, first on{" "}
            {formatDate(startOn)}
            {frequency !== "once" && endsOn
              ? `, until ${formatDate(endsOn)}`
              : ""}
            . End-of-day runs it on each due date.
          </>,
        )
      }
    >
      <AccountSelect
        id={`${id}-from`}
        label="From"
        accounts={sources}
        value={from}
        onChange={setFrom}
      />
      <fieldset className={segmentsClass} aria-label="Pay to">
        <button
          type="button"
          aria-pressed={target === "payee"}
          className={segmentClass(target === "payee")}
          onClick={() => setTarget("payee")}
        >
          A payee
        </button>
        <button
          type="button"
          aria-pressed={target === "account"}
          className={segmentClass(target === "account")}
          onClick={() => setTarget("account")}
        >
          A Tidewater account
        </button>
      </fieldset>
      {target === "payee" ? (
        <Field label="Payee" htmlFor={`${id}-payee`}>
          <select
            id={`${id}-payee`}
            className={selectClass}
            value={payee}
            onChange={(event) => setPayee(event.target.value)}
          >
            {detail.payees.length === 0 ? (
              <option value="">No payees yet</option>
            ) : null}
            {detail.payees.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.bankCode} {item.accountNumber}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <AccountNumberField
          id={`${id}-to`}
          label="To Tidewater account"
          value={to}
          onChange={setTo}
          chips={detail.accounts.filter(
            (account) =>
              account.id !== from &&
              account.status !== "closed" &&
              (account.kind === "current" || account.kind === "savings"),
          )}
        />
      )}
      <MoneyField
        id={`${id}-amount`}
        label="Amount"
        value={amountText}
        onChange={setAmountText}
      />
      <fieldset>
        <legend className="eyebrow mb-1 text-[0.65rem] font-bold text-ink-muted">
          How often
        </legend>
        <div className={segmentsClass}>
          {(["once", "weekly", "monthly"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={frequency === option}
              className={segmentClass(frequency === option)}
              onClick={() => setFrequency(option)}
            >
              {option}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label={frequency === "once" ? "On" : "First on"}
          htmlFor={`${id}-start`}
          error={early ? "Not before the bank date." : undefined}
          hint={`Bank date ${formatDate(bankDate)}.`}
        >
          <input
            id={`${id}-start`}
            type="date"
            min={bankDate}
            className={cx(inputClass, "font-mono")}
            value={startOn}
            aria-invalid={early || undefined}
            onChange={(event) => setStartOn(event.target.value)}
          />
        </Field>
        {frequency !== "once" ? (
          <Field label="Until (optional)" htmlFor={`${id}-end`}>
            <input
              id={`${id}-end`}
              type="date"
              min={startOn || bankDate}
              className={cx(inputClass, "font-mono")}
              value={endsOn}
              onChange={(event) => setEndsOn(event.target.value)}
            />
          </Field>
        ) : null}
      </div>
      <ReferenceField
        id={`${id}-reference`}
        value={reference}
        onChange={setReference}
      />
      {amount ? (
        <p className="text-xs text-ink-muted">
          {formatMoney(amount)} {frequency === "once" ? "once" : frequency} to{" "}
          {label}.
        </p>
      ) : null}
    </WriteDialog>
  );
}

export function CancelOrderDialog({
  order,
  onClose,
}: {
  order: StandingOrderView;
  onClose: () => void;
}) {
  const gate = useGate("money.move");
  return (
    <WriteDialog
      title="Cancel a scheduled payment"
      submit="Cancel the payment"
      pendingLabel="Cancelling…"
      danger
      gate={gate}
      onClose={onClose}
      build={() => ({
        name: "cancel_standing_order",
        input: { standingOrderId: order.id },
      })}
    >
      <p className="text-ink-muted">
        {formatMoney(order.amount)} {order.frequency} to {order.to} stops: it
        will not run on {formatDate(order.nextRunOn)} or after. Runs already
        made stay.
      </p>
    </WriteDialog>
  );
}
