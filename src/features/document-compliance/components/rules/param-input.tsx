"use client";

import type { ParameterSpec, ParameterValue } from "../../domain/rules";

type ParamInputProps = {
  name: string;
  spec: ParameterSpec;
  value: ParameterValue;
  invalid: boolean;
  disabled: boolean;
  onChange: (value: ParameterValue) => void;
};

const control =
  "rounded-sm border-2 border-ink bg-paper px-1.5 py-0.5 font-mono text-sm font-bold aria-invalid:border-seal-red aria-invalid:bg-seal-red/10 disabled:opacity-60";

/**
 * One Parameter edited in place inside its Rule's sentence. Numbers stay
 * numbers (a cleared field sends NaN, which the Rule refuses), so the card can
 * check the edit with the same function the server uses.
 */
export function ParamInput({
  name,
  spec,
  value,
  invalid,
  disabled,
  onChange,
}: ParamInputProps) {
  const testId = `rule-param-${name}`;
  switch (spec.kind) {
    case "days":
    case "months":
      return (
        <span className="inline-flex items-baseline gap-1">
          <input
            type="number"
            data-testid={testId}
            aria-label={spec.label}
            aria-invalid={invalid}
            disabled={disabled}
            min={spec.min}
            max={spec.max}
            step={1}
            value={Number.isFinite(value) ? (value as number) : ""}
            onChange={(event) => onChange(event.target.valueAsNumber)}
            className={`${control} w-16 text-right`}
          />
          <span>{spec.kind}</span>
        </span>
      );
    case "percent":
      return (
        <span className="inline-flex items-baseline gap-1">
          <input
            type="number"
            data-testid={testId}
            aria-label={`${spec.label} (percent)`}
            aria-invalid={invalid}
            disabled={disabled}
            min={Math.round(spec.min * 100)}
            max={Math.round(spec.max * 100)}
            step={Math.round(spec.step * 100)}
            value={
              Number.isFinite(value) ? Math.round((value as number) * 100) : ""
            }
            onChange={(event) => onChange(event.target.valueAsNumber / 100)}
            className={`${control} w-16 text-right`}
          />
          <span>%</span>
        </span>
      );
    case "enum":
      return (
        <select
          data-testid={testId}
          aria-label={spec.label}
          aria-invalid={invalid}
          disabled={disabled}
          value={value as string}
          onChange={(event) => onChange(event.target.value)}
          className={control}
        >
          {spec.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    case "list": {
      const selected = new Set(value as string[]);
      return (
        <fieldset
          aria-label={spec.label}
          aria-invalid={invalid}
          data-testid={testId}
          className="my-1 inline-flex flex-wrap gap-1.5 align-middle"
        >
          {spec.options.map((option) => {
            const on = selected.has(option.value);
            return (
              <label
                key={option.value}
                className={`inline-flex cursor-pointer items-center gap-1 rounded-sm border-2 px-1.5 py-0.5 font-mono text-xs font-bold ${
                  on ? "border-ink bg-ink text-paper" : "border-ink/40 bg-paper"
                } ${invalid ? "border-seal-red" : ""}`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={on}
                  disabled={disabled}
                  onChange={() =>
                    onChange(
                      on
                        ? (value as string[]).filter(
                            (item) => item !== option.value,
                          )
                        : [...(value as string[]), option.value],
                    )
                  }
                />
                {on ? "✓" : "+"} {option.label}
              </label>
            );
          })}
        </fieldset>
      );
    }
  }
}
