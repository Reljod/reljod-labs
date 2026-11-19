"use client";

import { useId, useState } from "react";
import { formatAccountNumber, isBankCode } from "../../domain/numbers";
import type {
  AccountView,
  CustomerDetail,
  PayeeView,
} from "../../domain/views";
import { cx, Field, inputClass, segmentClass, segmentsClass } from "../ui";
import { AccountSelect } from "./account-dialogs";
import {
  AccountNumberField,
  accountNumberProblem,
  digitsOf,
} from "./account-number-field";
import { spendable } from "./format";
import { amountOf, MoneyField, selectClass, useGate } from "./shared";
import { amountStepUp, WriteDialog } from "./write-dialog";

/** The forms of Payments: transfer, payees, pay a payee, scheduled payments. */

export function ReferenceField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label="Reference (optional)" htmlFor={id}>
      <input
        id={id}
        className={inputClass}
        maxLength={60}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

export const sourceName = (account: AccountView | undefined) =>
  account
    ? `${account.name} (${formatAccountNumber(account.number)})`
    : "the account";

export function TransferDialog({
  detail,
  onClose,
}: {
  detail: CustomerDetail;
  onClose: () => void;
}) {
  const id = useId();
  const gate = useGate("money.move");
  const sources = spendable(detail.accounts);
  const [from, setFrom] = useState(sources[0]?.id ?? "");
  const [to, setTo] = useState("");
  const [amountText, setAmountText] = useState("");
  const [reference, setReference] = useState("");
  const amount = amountOf(amountText);
  const source = sources.find((account) => account.id === from);
  const chips = detail.accounts.filter(
    (account) =>
      account.id !== from &&
      account.status !== "closed" &&
      (account.kind === "current" || account.kind === "savings"),
  );
  return (
    <WriteDialog
      title="Transfer"
      submit="Transfer"
      pendingLabel="Transferring…"
      gate={gate}
      onClose={onClose}
      build={() => {
        if (!source) return "Choose the account the money leaves.";
        const problem = accountNumberProblem(to);
        if (!to.trim() || problem)
          return problem ?? "Give the Tidewater account number it goes to.";
        if (digitsOf(to) === source.number)
          return "The money cannot go to the account it leaves.";
        if (!amount) return "Give the amount.";
        return {
          name: "transfer",
          input: {
            fromAccountId: from,
            toAccountNumber: digitsOf(to),
            amount,
            reference: reference.trim() || undefined,
          },
        };
      }}
      stepUp={() =>
        amountStepUp(
          amount ?? 0,
          <>
            leaves {sourceName(source)} for Tidewater account{" "}
            {formatAccountNumber(digitsOf(to))}. It posts at once.
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
      <AccountNumberField
        id={`${id}-to`}
        label="To Tidewater account"
        value={to}
        onChange={setTo}
        chips={chips}
      />
      <MoneyField
        id={`${id}-amount`}
        label="Amount"
        value={amountText}
        onChange={setAmountText}
        testId="bank-transfer-amount"
      />
      <ReferenceField
        id={`${id}-reference`}
        value={reference}
        onChange={setReference}
      />
    </WriteDialog>
  );
}

export function AddPayeeDialog({
  customerId,
  onClose,
}: {
  customerId: string;
  onClose: () => void;
}) {
  const id = useId();
  const gate = useGate("money.move");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"person" | "biller">("person");
  const [bankCode, setBankCode] = useState("");
  const [number, setNumber] = useState("");
  const [reference, setReference] = useState("");
  const code = bankCode.trim().toUpperCase();
  const codeProblem =
    code && !isBankCode(code) ? "Four letters, like MRDB." : null;
  const numberProblem =
    number.trim() && !/^\d{6,12}$/.test(number.trim())
      ? "6 to 12 digits."
      : null;
  return (
    <WriteDialog
      title="Add a payee"
      submit="Add the payee"
      pendingLabel="Adding…"
      gate={gate}
      onClose={onClose}
      build={() => {
        if (name.trim().length < 2) return "Give the payee's name.";
        if (!isBankCode(code)) return "Give their bank's four-letter code.";
        if (!/^\d{6,12}$/.test(number.trim()))
          return "Give their account number: 6 to 12 digits.";
        return {
          name: "add_payee",
          input: {
            customerId,
            name: name.trim(),
            kind,
            bankCode: code,
            accountNumber: number.trim(),
            reference: reference.trim() || undefined,
          },
        };
      }}
    >
      <fieldset className={segmentsClass} aria-label="Kind of payee">
        {(["person", "biller"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={kind === option}
            className={segmentClass(kind === option)}
            onClick={() => setKind(option)}
          >
            {option === "person" ? "A person" : "A biller"}
          </button>
        ))}
      </fieldset>
      <Field label="Name" htmlFor={`${id}-name`}>
        <input
          id={`${id}-name`}
          className={inputClass}
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
        <Field
          label="Bank code"
          htmlFor={`${id}-code`}
          error={codeProblem ?? undefined}
        >
          <input
            id={`${id}-code`}
            className={cx(inputClass, "font-mono uppercase")}
            maxLength={4}
            value={bankCode}
            aria-invalid={Boolean(codeProblem) || undefined}
            onChange={(event) => setBankCode(event.target.value)}
          />
        </Field>
        <Field
          label="Account number"
          htmlFor={`${id}-number`}
          error={numberProblem ?? undefined}
        >
          <input
            id={`${id}-number`}
            inputMode="numeric"
            className={cx(inputClass, "font-mono")}
            maxLength={12}
            value={number}
            aria-invalid={Boolean(numberProblem) || undefined}
            onChange={(event) => setNumber(event.target.value)}
          />
        </Field>
      </div>
      <ReferenceField
        id={`${id}-reference`}
        value={reference}
        onChange={setReference}
      />
      <p className="text-xs text-ink-muted">
        The simulated rail returns a payment to an account number ending 0000
        (account closed) or 9999 (no such account).
      </p>
    </WriteDialog>
  );
}

export function RemovePayeeDialog({
  payee,
  onClose,
}: {
  payee: PayeeView;
  onClose: () => void;
}) {
  const gate = useGate("money.move");
  return (
    <WriteDialog
      title={`Remove ${payee.name}`}
      submit="Remove the payee"
      pendingLabel="Removing…"
      danger
      gate={gate}
      onClose={onClose}
      build={() => ({ name: "remove_payee", input: { payeeId: payee.id } })}
    >
      <p className="text-ink-muted">
        {payee.name} ({payee.bankCode} {payee.accountNumber}) is removed.
        Payments already sent are kept; scheduled payments to them are
        cancelled.
      </p>
    </WriteDialog>
  );
}

export function PayPayeeDialog({
  detail,
  payeeId,
  onClose,
}: {
  detail: CustomerDetail;
  payeeId?: string;
  onClose: () => void;
}) {
  const id = useId();
  const gate = useGate("money.move");
  const sources = spendable(detail.accounts);
  const [from, setFrom] = useState(sources[0]?.id ?? "");
  const [payee, setPayee] = useState(payeeId ?? detail.payees[0]?.id ?? "");
  const [amountText, setAmountText] = useState("");
  const [reference, setReference] = useState("");
  const amount = amountOf(amountText);
  const source = sources.find((account) => account.id === from);
  const target = detail.payees.find((item) => item.id === payee);
  return (
    <WriteDialog
      title="Pay a payee"
      submit="Pay"
      pendingLabel="Paying…"
      gate={gate}
      onClose={onClose}
      build={() => {
        if (!source) return "Choose the account the money leaves.";
        if (!target) return "Choose a payee, or add one first.";
        if (!amount) return "Give the amount.";
        return {
          name: "pay_payee",
          input: {
            fromAccountId: from,
            payeeId: payee,
            amount,
            reference: reference.trim() || undefined,
          },
        };
      }}
      stepUp={() =>
        amountStepUp(
          amount ?? 0,
          <>
            leaves {sourceName(source)} for {target?.name} ({target?.bankCode}{" "}
            {target?.accountNumber}) over the clearing rail. A fee may apply;
            the Rules may hold it for review or ask for an Approval.
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
      <MoneyField
        id={`${id}-amount`}
        label="Amount"
        value={amountText}
        onChange={setAmountText}
        testId="bank-pay-amount"
      />
      <ReferenceField
        id={`${id}-reference`}
        value={reference}
        onChange={setReference}
      />
    </WriteDialog>
  );
}
