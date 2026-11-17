"use client";

import { useId, useState } from "react";
import { formatParameter, type ParameterSpec } from "../../domain/rules";
import { type ParamDraft, unitOf } from "../../domain/skills/rule-fields";
import { cx } from "../ui";

const fieldBase =
  "rounded-sm border bg-paper px-1.5 py-0.5 text-sm font-medium text-ink focus-visible:border-federal-blue focus-visible:outline-2 focus-visible:outline-federal-blue/30 disabled:bg-transparent disabled:text-ink read-only:bg-transparent aria-[invalid=true]:border-seal-red aria-[invalid=true]:bg-seal-red/5";

/**
 * One Parameter drawn inside its Rule's sentence: a number with its unit, a
 * select for an enum, chips for a list. A value that differs from the
 * Default is tinted, and the Default shows on hover or focus.
 */
export function ParamField({
  name,
  spec,
  draft,
  defaultValue,
  changed,
  invalid,
  disabled,
  onChange,
  describedBy,
}: {
  name: string;
  spec: ParameterSpec;
  draft: ParamDraft | undefined;
  defaultValue: Parameters<typeof formatParameter>[1];
  changed: boolean;
  invalid: boolean;
  /** Read-only: a user, or a Rule that is switched off keeps its fields. */
  disabled: boolean;
  onChange: (value: ParamDraft) => void;
  describedBy?: string;
}) {
  const id = useId();
  const border = changed ? "border-brass bg-brass/15" : "border-ink";
  const defaultText = formatParameter(spec, defaultValue);
  const hint = (
    <span
      id={`${id}-default`}
      className="ml-1 hidden font-mono text-[0.65rem] font-normal text-oak group-focus-within/param:inline group-hover/param:inline"
    >
      default {defaultText}
    </span>
  );
  const label = `${spec.label}${changed ? ` (default ${defaultText})` : ""}`;

  if (spec.kind === "enum") {
    return (
      <span className="group/param inline-flex items-baseline">
        <select
          aria-label={label}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          disabled={disabled}
          value={typeof draft === "string" ? draft : ""}
          onChange={(event) => onChange(event.target.value)}
          title={changed ? `Default: ${defaultText}` : undefined}
          className={cx(fieldBase, border, "max-w-full")}
        >
          {typeof draft === "string" &&
          !spec.options.some((option) => option.value === draft) ? (
            <option value={draft}>{draft || "Choose…"}</option>
          ) : null}
          {spec.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {changed ? hint : null}
      </span>
    );
  }

  if (spec.kind === "list") {
    return (
      <ListField
        id={id}
        name={name}
        spec={spec}
        items={Array.isArray(draft) ? draft : []}
        border={border}
        label={label}
        invalid={invalid}
        disabled={disabled}
        changed={changed}
        hint={hint}
        onChange={onChange}
      />
    );
  }

  const unit = unitOf(spec);
  const text = typeof draft === "string" ? draft : "";
  return (
    <span className="group/param inline-flex items-baseline gap-1 whitespace-nowrap">
      {unit.before ? (
        <span className="font-mono text-xs text-ink-muted">{unit.before}</span>
      ) : null}
      <input
        type="text"
        inputMode={
          spec.kind === "money" ||
          spec.kind === "percent" ||
          spec.kind === "number"
            ? "decimal"
            : "numeric"
        }
        autoComplete="off"
        spellCheck={false}
        aria-label={label}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        readOnly={disabled}
        value={text}
        onChange={(event) => onChange(event.target.value)}
        title={changed ? `Default: ${defaultText}` : undefined}
        style={{ width: `${Math.max(3, text.length + 1.5)}ch` }}
        className={cx(fieldBase, border, "text-right font-mono tabular-nums")}
      />
      {unit.after ? (
        <span className="font-mono text-xs text-ink-muted">{unit.after}</span>
      ) : null}
      {changed ? hint : null}
    </span>
  );
}

function ListField({
  id,
  name,
  spec,
  items,
  border,
  label,
  invalid,
  disabled,
  changed,
  hint,
  onChange,
}: {
  id: string;
  name: string;
  spec: Extract<ParameterSpec, { kind: "list" }>;
  items: string[];
  border: string;
  label: string;
  invalid: boolean;
  disabled: boolean;
  changed: boolean;
  hint: React.ReactNode;
  onChange: (value: string[]) => void;
}) {
  const [adding, setAdding] = useState("");
  const labelOf = (value: string) =>
    spec.options?.find((option) => option.value === value)?.label ?? value;
  const chip =
    "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs font-medium";

  if (spec.options) {
    return (
      <span
        aria-invalid={invalid}
        className="group/param inline-flex flex-wrap items-baseline gap-1 align-middle"
      >
        {spec.options.map((option) => {
          const on = items.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={on}
              aria-label={`${spec.label}: ${option.label}`}
              disabled={disabled}
              onClick={() =>
                onChange(
                  on
                    ? items.filter((item) => item !== option.value)
                    : [...items, option.value],
                )
              }
              className={cx(
                chip,
                "focus-visible:outline-2 focus-visible:outline-federal-blue",
                on
                  ? cx(
                      changed
                        ? "border-brass bg-brass/20"
                        : "border-federal-blue/40 bg-morning-haze",
                      "text-ink",
                    )
                  : "border-ink border-dashed text-ink-muted",
                invalid && "border-seal-red",
                !disabled && "hover:border-ink/50",
              )}
            >
              {on ? "✓ " : ""}
              {option.label}
            </button>
          );
        })}
        {changed ? hint : null}
      </span>
    );
  }

  const add = () => {
    const value = adding.trim();
    if (value && !items.includes(value)) onChange([...items, value]);
    setAdding("");
  };
  return (
    <span className="group/param inline-flex flex-wrap items-baseline gap-1 align-middle">
      {items.map((item) => (
        <span key={item} className={cx(chip, border)}>
          {labelOf(item)}
          {disabled ? null : (
            <button
              type="button"
              aria-label={`Remove ${labelOf(item)}`}
              onClick={() => onChange(items.filter((other) => other !== item))}
              className="text-ink-muted hover:text-seal-red"
            >
              ×
            </button>
          )}
        </span>
      ))}
      {disabled ? null : (
        <input
          id={`${id}-${name}-add`}
          type="text"
          value={adding}
          placeholder="add…"
          aria-label={`Add to ${spec.label}`}
          aria-invalid={invalid}
          onChange={(event) => setAdding(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              add();
            }
          }}
          onBlur={add}
          className={cx(fieldBase, "w-20 border-ink text-xs")}
        />
      )}
      {changed ? hint : null}
    </span>
  );
}
