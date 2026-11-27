"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RulesResponse } from "../../domain/api";
import { describeRule, type Rule, type RuleOverride } from "../../domain/rules";
import { saveRule } from "../api";
import {
  fieldClass,
  focusRing,
  InlineError,
  InlineNote,
  linkButtonClass,
  smallButtonClass,
} from "../ui";
import {
  draftErrors,
  draftFrom,
  isDirty,
  isLocked,
  previewRule,
  ruleDef,
  toOverride,
} from "./rule-form";

export type SavedRules = RulesResponse;

/** Changes when what the Rule says changes, not when its object is replaced. */
function signature(rule: Rule): string {
  return JSON.stringify([rule.enabled, rule.severity, rule.params]);
}

/**
 * One Rule: what it asks, with the Parameters filled in, a switch, its
 * severity and its numbers. Save sends only what differs from the default;
 * "Back to default" clears the Owner's override.
 */
export function RuleCard({
  rule,
  onSaved,
}: {
  rule: Rule;
  onSaved: (saved: SavedRules) => void;
}) {
  const def = ruleDef(rule.id);
  const locked = isLocked(rule.id);
  const [draft, setDraft] = useState(() => draftFrom(rule));
  const [pending, setPending] = useState<"save" | "default" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const saved = signature(rule);

  // A save or reset elsewhere brings this card back to what is stored.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the Rule's content, not its identity
  useEffect(() => {
    setDraft(draftFrom(rule));
  }, [saved]);

  const errors = useMemo(
    () => (def ? draftErrors(def, draft) : {}),
    [def, draft],
  );
  const dirty = isDirty(rule, draft);
  const valid = Object.keys(errors).length === 0;
  const preview = previewRule(rule, draft);

  if (!def) return null;

  const send = async (
    kind: "save" | "default",
    override: RuleOverride | null,
  ) => {
    if (busy.current) return;
    busy.current = true;
    setPending(kind);
    setError(null);
    setNote(null);
    try {
      const result = await saveRule(rule.id, override);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSaved(result.value);
      setNote(
        kind === "default"
          ? `Back to the default. Rules are now version ${result.value.rulesVersion}.`
          : `Saved. Rules are now version ${result.value.rulesVersion}.`,
      );
    } catch {
      setError("That did not reach the server. Try again.");
    } finally {
      busy.current = false;
      setPending(null);
    }
  };

  const id = `rule-${rule.id.replace(/\W/g, "-")}`;
  return (
    <article
      aria-labelledby={`${id}-title`}
      className={`outline-box flex min-w-0 flex-col gap-3 rounded-sm p-4 ${draft.enabled ? "bg-paper" : "bg-marble"} ${rule.edited ? "shadow-hard-sm" : ""}`}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4
            id={`${id}-title`}
            className={`font-semibold leading-snug ${draft.enabled ? "" : "text-ink-muted"}`}
          >
            {rule.title}
          </h4>
          <p className="mt-0.5 flex flex-wrap gap-2 font-mono text-[10px] tracking-[0.08em] text-ink-muted uppercase">
            <span>{rule.id}</span>
            {rule.edited ? (
              <span className="rounded-sm bg-brass px-1 font-bold text-ink">
                Edited
              </span>
            ) : null}
          </p>
        </div>
        <Switch
          id={`${id}-on`}
          checked={draft.enabled}
          disabled={locked || pending !== null}
          label={`${rule.title}: ${draft.enabled ? "on" : "off"}`}
          onChange={(enabled) =>
            setDraft((current) => ({ ...current, enabled }))
          }
        />
      </header>

      <p
        className={`text-sm ${draft.enabled ? "" : "text-ink-muted line-through decoration-ink/30"}`}
      >
        {describeRule(preview)}
      </p>
      {locked ? (
        <p className="text-xs text-ink-muted">
          Always on: without a limit on Rounds, a Deck that never passes would
          never be held for a person.
        </p>
      ) : null}

      <fieldset
        className="flex flex-col gap-1.5"
        disabled={pending !== null || !draft.enabled}
      >
        <legend className="eyebrow mb-1 text-ink-muted">When it fails</legend>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["block", "Blocks approval"],
              ["warn", "Warning only"],
            ] as const
          ).map(([value, label]) => (
            <label
              key={value}
              className={`flex min-h-9 cursor-pointer items-center gap-2 rounded-sm border-2 px-2.5 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-federal-blue has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 ${draft.severity === value ? (value === "block" ? "border-seal-red bg-seal-red/10" : "border-brass bg-brass/15") : "border-ink/25"}`}
            >
              <input
                type="radio"
                name={`${id}-severity`}
                value={value}
                checked={draft.severity === value}
                onChange={() =>
                  setDraft((current) => ({ ...current, severity: value }))
                }
                className="accent-federal-blue"
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      {def.params.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {def.params.map((param) => {
            const inputId = `${id}-${param.key}`;
            const problem = errors[param.key];
            return (
              <div key={param.key} className="flex min-w-0 flex-col gap-1">
                <label htmlFor={inputId} className="eyebrow text-ink-muted">
                  {param.label}
                  {param.unit ? ` (${param.unit})` : ""}
                </label>
                <input
                  id={inputId}
                  type="number"
                  inputMode="decimal"
                  min={param.min}
                  max={param.max}
                  step={param.step}
                  value={draft.params[param.key] ?? ""}
                  disabled={pending !== null || !draft.enabled}
                  aria-invalid={problem ? true : undefined}
                  aria-describedby={`${inputId}-hint`}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      params: {
                        ...current.params,
                        [param.key]: event.target.value,
                      },
                    }))
                  }
                  className={`${fieldClass} font-mono ${problem ? "border-seal-red" : ""}`}
                />
                <p
                  id={`${inputId}-hint`}
                  className={`text-[11px] ${problem ? "text-seal-red" : "text-ink-muted"}`}
                >
                  {problem ??
                    `${param.min}–${param.max}, default ${def.defaults[param.key]}`}
                </p>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* mt-auto: in a row of stretched cards the spare height goes above the footer, so every Save lines up at the bottom. */}
      <div className="mt-auto flex flex-col gap-2">
        <footer className="flex flex-wrap items-center gap-x-4 gap-y-2 border-ink/15 border-t pt-3">
          <button
            type="button"
            onClick={() => send("save", toOverride(def, draft))}
            disabled={!dirty || !valid || pending !== null}
            aria-busy={pending === "save"}
            className={smallButtonClass}
          >
            {pending === "save" ? "Saving…" : "Save"}
          </button>
          {dirty && pending === null ? (
            <button
              type="button"
              onClick={() => setDraft(draftFrom(rule))}
              className={`${linkButtonClass} text-sm`}
            >
              Undo changes
            </button>
          ) : null}
          {rule.edited ? (
            <button
              type="button"
              onClick={() => send("default", null)}
              disabled={pending !== null}
              aria-busy={pending === "default"}
              className={`${linkButtonClass} text-sm disabled:opacity-50`}
            >
              {pending === "default" ? "Going back…" : "Back to default"}
            </button>
          ) : null}
        </footer>
        <InlineNote>{note}</InlineNote>
        <InlineError>{error}</InlineError>
      </div>
    </article>
  );
}

function Switch({
  id,
  checked,
  disabled,
  label,
  onChange,
}: {
  id: string;
  checked: boolean;
  disabled: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`outline-box relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${focusRing} ${checked ? "bg-ivy" : "bg-limestone"}`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-0.5 size-5 rounded-full border-2 border-ink bg-paper transition-[left] motion-reduce:transition-none ${checked ? "left-[22px]" : "left-0.5"}`}
      />
    </button>
  );
}
