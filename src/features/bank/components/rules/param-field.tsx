"use client";

import { useId } from "react";
import { formatMoney, parseMoney } from "../../domain/money";
import type { ParamDef } from "../../domain/rules";
import { cx, Field, inputClass } from "../ui";
import { UNIT } from "./draft";

/**
 * One Parameter of a Rule, edited by its kind: florins for money, a percent
 * for basis points, a whole number with its unit, a checkbox for a flag, a
 * comma-separated list for words.
 */
export function ParamField({
  field,
  value,
  error,
  disabled,
  onChange,
}: {
  field: ParamDef;
  value: string | boolean;
  error?: string;
  disabled: boolean;
  onChange: (value: string | boolean) => void;
}) {
  const id = useId();

  if (field.kind === "flag") {
    return (
      <div className="flex flex-col gap-1 sm:col-span-2">
        <label htmlFor={id} className="flex items-start gap-2 text-sm">
          <input
            id={id}
            type="checkbox"
            checked={value === true}
            disabled={disabled}
            onChange={(event) => onChange(event.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-federal-blue"
          />
          <span>{field.label}</span>
        </label>
        {field.help ? (
          <p className="pl-6 text-xs text-ink-muted">{field.help}</p>
        ) : null}
        {error ? (
          <p role="alert" className="pl-6 text-xs text-seal-red">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  const text = typeof value === "string" ? value : "";

  if (field.kind === "words") {
    return (
      <Field
        label={field.label}
        htmlFor={id}
        error={error}
        hint={field.help ?? "Words separated by commas."}
        className="sm:col-span-2"
      >
        <textarea
          id={id}
          value={text}
          rows={2}
          disabled={disabled}
          aria-invalid={Boolean(error) || undefined}
          onChange={(event) => onChange(event.target.value)}
          className={inputClass}
        />
      </Field>
    );
  }

  const unit = UNIT[field.kind];
  const minor = field.kind === "money" ? parseMoney(text) : null;
  const hint =
    field.kind === "money" && minor !== null
      ? formatMoney(minor)
      : (field.help ??
        (field.kind === "hour" ? "Hour of the bank day, 0 to 23." : undefined));

  return (
    <Field label={field.label} htmlFor={id} error={error} hint={hint}>
      <div className="flex items-stretch">
        <input
          id={id}
          type="text"
          inputMode={
            field.kind === "money" || field.kind === "bps"
              ? "decimal"
              : "numeric"
          }
          value={text}
          disabled={disabled}
          aria-invalid={Boolean(error) || undefined}
          onChange={(event) => onChange(event.target.value)}
          className={cx(
            inputClass,
            "text-right font-mono tabular-nums",
            unit && "rounded-r-none",
          )}
        />
        {unit ? (
          <span className="outline-box -ml-0.5 flex shrink-0 items-center rounded-r-sm border-l-0 bg-marble px-2 font-mono text-[0.7rem] whitespace-nowrap text-ink-muted">
            {unit}
          </span>
        ) : null}
      </div>
    </Field>
  );
}
