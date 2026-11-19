"use client";

import { formatAccountNumber, isAccountNumber } from "../../domain/numbers";
import type { AccountView } from "../../domain/views";
import { cx, Field, inputClass, segmentClass, segmentsClass } from "../ui";

/** Digits only, spaces dropped. */
export const digitsOf = (text: string) => text.replace(/\s/g, "");

/** Why a typed Tidewater account number cannot be used yet, or null. */
export function accountNumberProblem(text: string): string | null {
  const digits = digitsOf(text);
  if (!digits) return null;
  if (!/^\d+$/.test(digits)) return "Only digits.";
  if (digits.length !== 10) return `Ten digits (${digits.length} so far).`;
  if (!isAccountNumber(digits))
    return "That number does not add up: check the digits. The last digit is a check digit.";
  return null;
}

/**
 * A Tidewater account number, typed or pasted, checked as it is typed, with
 * the open Customer's own other accounts as chips to fill it in.
 */
export function AccountNumberField({
  id,
  label,
  value,
  onChange,
  chips,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  chips: AccountView[];
}) {
  const problem = accountNumberProblem(value);
  const digits = digitsOf(value);
  const good = digits.length === 10 && !problem;
  return (
    <Field
      label={label}
      htmlFor={id}
      error={problem ?? undefined}
      hint={
        good
          ? `Tidewater account ${formatAccountNumber(digits)}.`
          : "Ten digits, as on the statement."
      }
    >
      <input
        id={id}
        inputMode="numeric"
        autoComplete="off"
        className={cx(inputClass, "font-mono tracking-wider")}
        placeholder="10 0000 0000"
        value={value}
        aria-invalid={Boolean(problem) || undefined}
        onChange={(event) => onChange(event.target.value)}
        data-testid="bank-transfer-to"
      />
      {chips.length > 0 ? (
        <fieldset
          className={cx(segmentsClass, "mt-1")}
          aria-label="This customer's other accounts"
        >
          {chips.map((account) => (
            <button
              key={account.id}
              type="button"
              className={segmentClass(digits === account.number)}
              onClick={() => onChange(formatAccountNumber(account.number))}
            >
              {account.name} · {account.number.slice(-4)}
            </button>
          ))}
        </fieldset>
      ) : null}
    </Field>
  );
}
