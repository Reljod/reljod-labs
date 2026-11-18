"use client";

import { useId, useMemo, useState } from "react";
import {
  TERM_MONTHS,
  type TermMonths,
  termRate,
  termRefusal,
} from "../../domain/checks";
import { formatMinor, formatMoney } from "../../domain/money";
import { formatAccountNumber } from "../../domain/numbers";
import { DEFAULT_RULEBOOK, type Rulebook } from "../../domain/rules";
import type {
  AccountView,
  CustomerDetail,
  RulesView,
} from "../../domain/views";
import { Field, inputClass, segmentClass, segmentsClass } from "../ui";
import { useRead } from "../use-bank";
import { rate, spendable } from "./format";
import { amountOf, MoneyField, selectClass, useGate } from "./shared";
import { amountStepUp, WriteDialog } from "./write-dialog";

/** Opening accounts and money in: open an account, a term deposit, a credit; and the account select they share. */

/** The Rulebook as it stands for this bank, once `list_rules` has answered. */
export function useRulebook(): Rulebook | null {
  const rules = useRead<RulesView>("list_rules");
  return useMemo(
    () =>
      rules.data
        ? ({
            ...DEFAULT_RULEBOOK,
            ...Object.fromEntries(
              rules.data.rules.map((rule) => [rule.id, rule]),
            ),
          } as Rulebook)
        : null,
    [rules.data],
  );
}

const accountLabel = (account: AccountView) =>
  `${account.name} · ${formatAccountNumber(account.number)} · ${formatMoney(account.available)} available`;

export function AccountSelect({
  id,
  label,
  accounts,
  value,
  onChange,
}: {
  id: string;
  label: string;
  accounts: AccountView[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <Field label={label} htmlFor={id}>
      <select
        id={id}
        className={selectClass}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {accounts.length === 0 ? (
          <option value="">No open account</option>
        ) : null}
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {accountLabel(account)}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function OpenAccountDialog({
  customerId,
  onClose,
}: {
  customerId: string;
  onClose: () => void;
}) {
  const id = useId();
  const gate = useGate("account.manage");
  const [kind, setKind] = useState<"current" | "savings">("current");
  const [name, setName] = useState("");
  return (
    <WriteDialog
      title="Open an account"
      submit="Open the account"
      pendingLabel="Opening…"
      gate={gate}
      onClose={onClose}
      build={() => ({
        name: "open_account",
        input: { customerId, kind, name: name.trim() || undefined },
      })}
    >
      <fieldset className={segmentsClass} aria-label="Kind of account">
        {(["current", "savings"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={kind === option}
            className={segmentClass(kind === option)}
            onClick={() => setKind(option)}
          >
            {option === "current" ? "Current" : "Savings"}
          </button>
        ))}
      </fieldset>
      <p className="text-ink-muted">
        {kind === "current"
          ? "For everyday money: cards, transfers and payments."
          : "Earns interest by the savings Rule, accrued daily and paid at month end."}
      </p>
      <Field label="Name (optional)" htmlFor={id}>
        <input
          id={id}
          className={inputClass}
          maxLength={40}
          placeholder={kind === "current" ? "Everyday" : "Rainy day"}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
    </WriteDialog>
  );
}

export function TermDepositDialog({
  customerId,
  accounts,
  onClose,
}: {
  customerId: string;
  accounts: AccountView[];
  onClose: () => void;
}) {
  const id = useId();
  const gate = useGate("account.manage");
  const book = useRulebook();
  const sources = spendable(accounts);
  const [from, setFrom] = useState(sources[0]?.id ?? "");
  const [amountText, setAmountText] = useState("");
  const [months, setMonths] = useState<TermMonths>(12);
  const amount = amountOf(amountText);
  const refusal = book && amount ? termRefusal(book, amount) : null;
  const source = sources.find((account) => account.id === from);
  return (
    <WriteDialog
      title="Open a term deposit"
      submit="Open the term deposit"
      pendingLabel="Opening…"
      gate={gate}
      onClose={onClose}
      build={() => {
        if (!source) return "Choose the account the money comes from.";
        if (!amount) return "Give the amount to put away.";
        if (refusal) return refusal;
        return {
          name: "open_term_deposit",
          input: {
            customerId,
            fromAccountId: from,
            amount,
            termMonths: months,
          },
        };
      }}
      stepUp={() =>
        amountStepUp(
          amount ?? 0,
          <>
            leaves {source?.name} ({formatAccountNumber(source?.number ?? "")})
            for a {months}-month term deposit
            {book ? ` at ${rate(termRate(book, months))} a year` : ""}.
            Principal and interest come back at maturity.
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
      <MoneyField
        id={`${id}-amount`}
        label="Amount"
        value={amountText}
        onChange={setAmountText}
        error={refusal}
        hint={book ? termRefusal(book, 0) : undefined}
      />
      <fieldset>
        <legend className="eyebrow mb-1 text-[0.65rem] font-bold text-ink-muted">
          Term
        </legend>
        <div className={segmentsClass}>
          {TERM_MONTHS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={months === option}
              className={segmentClass(months === option)}
              onClick={() => setMonths(option)}
            >
              {option} months{book ? ` · ${rate(termRate(book, option))}` : ""}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-ink-muted">
          Rates come from the bank's term deposit Rule.
        </p>
      </fieldset>
    </WriteDialog>
  );
}

const CREDIT_PRESETS = [
  {
    label: "Salary",
    from: "Meridia Port Authority payroll",
    reference: "Salary",
  },
  {
    label: "Refund",
    from: "Harbour Market",
    reference: "Refund",
    amount: 4_590,
  },
  {
    label: "Cash deposit",
    from: "Cash at the branch counter",
    reference: "Cash deposit",
    amount: 20_000,
  },
] as const;

export function ReceiveCreditDialog({
  account,
  customer,
  onClose,
}: {
  account: AccountView;
  customer: CustomerDetail["customer"];
  onClose: () => void;
}) {
  const id = useId();
  const gate = useGate("money.move");
  const [amountText, setAmountText] = useState("");
  const [from, setFrom] = useState("");
  const [reference, setReference] = useState("");
  const amount = amountOf(amountText);
  return (
    <WriteDialog
      title={`Receive a credit into ${account.name}`}
      submit="Receive the credit"
      pendingLabel="Crediting…"
      gate={gate}
      onClose={onClose}
      build={() => {
        if (!amount) return "Give the amount arriving.";
        if (from.trim().length < 2) return "Say who the money is from.";
        return {
          name: "receive_credit",
          input: {
            accountId: account.id,
            amount,
            from: from.trim(),
            reference: reference.trim() || undefined,
          },
        };
      }}
    >
      <p className="text-ink-muted">
        Simulates money arriving from outside the bank. The
        anti-money-laundering Rules see it.
      </p>
      <fieldset className={segmentsClass} aria-label="Presets">
        {CREDIT_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className={segmentClass(reference === preset.reference)}
            onClick={() => {
              const presetAmount =
                "amount" in preset
                  ? preset.amount
                  : customer.monthlyIncome > 0
                    ? customer.monthlyIncome
                    : 320_000;
              setAmountText(formatMinor(presetAmount));
              setFrom(preset.from);
              setReference(preset.reference);
            }}
          >
            {preset.label}
          </button>
        ))}
      </fieldset>
      <MoneyField
        id={`${id}-amount`}
        label="Amount"
        value={amountText}
        onChange={setAmountText}
        testId="bank-credit-amount"
      />
      <Field label="From" htmlFor={`${id}-from`}>
        <input
          id={`${id}-from`}
          className={inputClass}
          value={from}
          onChange={(event) => setFrom(event.target.value)}
        />
      </Field>
      <Field label="Reference (optional)" htmlFor={`${id}-reference`}>
        <input
          id={`${id}-reference`}
          className={inputClass}
          maxLength={60}
          value={reference}
          onChange={(event) => setReference(event.target.value)}
        />
      </Field>
    </WriteDialog>
  );
}
