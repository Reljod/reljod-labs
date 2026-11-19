"use client";

import { useId, useState } from "react";
import { type ResolvedRule, ruleDef } from "../../domain/rules";
import { CommandDialog, OutcomeNote } from "../shell/command-dialog";
import { Badge, Button, cx, inputClass } from "../ui";
import { useCommand } from "../use-bank";
import { checkDraft, type Draft, sameParams, toDraft } from "./draft";
import { HistoryDialog } from "./history-dialog";
import { ParamField } from "./param-field";

/**
 * One Rule: its sentence, re-rendered from the Parameters as they are typed,
 * its Version, an on/off switch unless the bank cannot run without it, and
 * the editor for its Parameters. Saving makes a new Version (asked first);
 * the checks that apply it are code and read it from the Rulebook.
 */
export function RuleCard({
  rule,
  canEdit,
  refusal,
}: {
  rule: ResolvedRule;
  canEdit: boolean;
  /** Why this Staff member may not edit, shown once per card. */
  refusal: string;
}) {
  const def = ruleDef(rule.id);
  const [base, setBase] = useState({
    version: rule.version,
    enabled: rule.enabled,
  });
  const [draft, setDraft] = useState<Draft>(() =>
    toDraft(rule.fields, rule.params),
  );
  const [enabled, setEnabled] = useState(rule.enabled);
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState<"save" | "restore" | "history" | null>(
    null,
  );
  const save = useCommand();
  const restore = useCommand();
  const noteId = useId();

  // A new Version (ours or anyone's) becomes what the card edits from.
  if (base.version !== rule.version || base.enabled !== rule.enabled) {
    setBase({ version: rule.version, enabled: rule.enabled });
    setDraft(toDraft(rule.fields, rule.params));
    setEnabled(rule.enabled);
  }

  const checked = def
    ? checkDraft(def, draft)
    : { params: rule.params, errors: {} };
  const serverErrors = Object.fromEntries(
    save.fieldErrors.map((error) => [error.field, error.message]),
  );
  const errors: Record<string, string> = { ...serverErrors, ...checked.errors };
  const valid = Object.keys(checked.errors).length === 0;
  const dirty =
    !sameParams(rule.fields, checked.params, rule.params) ||
    enabled !== rule.enabled ||
    Object.keys(checked.errors).length > 0;
  const sentence = def
    ? def.sentence({ ...rule.params, ...checked.params })
    : rule.sentence;
  const atDefault =
    sameParams(rule.fields, rule.params, rule.defaults) && rule.enabled;
  const locked = !canEdit || save.pending || restore.pending;

  return (
    <article
      className={cx(
        "outline-box rounded-sm bg-paper shadow-hard-sm",
        !enabled && "bg-marble",
      )}
      data-testid={`bank-rule-${rule.id}`}
    >
      <header className="flex flex-wrap items-center gap-2 border-ink border-b-2 px-3 py-2">
        <h3 className="min-w-0 flex-1 font-mono text-sm font-bold tracking-[0.04em] uppercase">
          {rule.title}
        </h3>
        <Badge tone={rule.edited ? "blue" : "neutral"}>
          {rule.edited ? `Version ${rule.version}` : "Default"}
        </Badge>
        {rule.required ? (
          <Badge tone="ink" title="The bank cannot run without this Rule">
            Required
          </Badge>
        ) : (
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label={`${rule.title} is ${enabled ? "on" : "off"}`}
            disabled={locked}
            onClick={() => setEnabled((value) => !value)}
            className="outline-box press flex h-7 items-center gap-1.5 rounded-sm bg-paper px-1.5 shadow-hard-sm disabled:translate-none disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
          >
            <span
              className={cx(
                "relative h-3.5 w-7 rounded-sm border border-ink",
                enabled ? "bg-ivy" : "bg-limestone",
              )}
            >
              <span
                className={cx(
                  "absolute top-px size-2.5 rounded-sm border border-ink bg-paper transition-transform",
                  enabled ? "translate-x-[0.85rem]" : "translate-x-px",
                )}
              />
            </span>
            <span className="eyebrow text-[0.6rem] font-bold">
              {enabled ? "On" : "Off"}
            </span>
          </button>
        )}
      </header>

      <div className="space-y-3 px-3 py-3">
        <blockquote
          className={cx(
            "border-l-4 pl-3 text-[0.95rem] leading-snug",
            dirty ? "border-federal-blue" : "border-ink",
            !enabled && "text-ink-muted line-through decoration-1",
          )}
          aria-live="polite"
          data-testid={`bank-rule-${rule.id}-sentence`}
        >
          {sentence}
        </blockquote>
        {dirty && valid ? (
          <p className="text-xs text-ink-muted">
            <span className="eyebrow mr-1 text-[0.6rem] font-bold">
              In force
            </span>
            {rule.sentence}
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          {rule.fields.map((field) => (
            <ParamField
              key={field.key}
              field={field}
              value={draft[field.key] ?? ""}
              error={errors[field.key]}
              disabled={locked}
              onChange={(value) =>
                setDraft((current) => ({ ...current, [field.key]: value }))
              }
            />
          ))}
        </div>
      </div>

      <footer className="space-y-2 border-ink/20 border-t bg-marble/50 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            disabled={locked || !dirty || !valid}
            pending={save.pending}
            pendingLabel="Saving…"
            onClick={() => {
              save.reset();
              setNote("");
              setAsking("save");
            }}
            data-testid={`bank-rule-${rule.id}-save`}
          >
            Save as new Version
          </Button>
          {dirty ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={locked}
              onClick={() => {
                setDraft(toDraft(rule.fields, rule.params));
                setEnabled(rule.enabled);
                save.reset();
              }}
            >
              Discard
            </Button>
          ) : null}
          <Button
            size="sm"
            disabled={locked || atDefault}
            pending={restore.pending}
            pendingLabel="Restoring…"
            title={
              atDefault
                ? "This Rule already says what its Default says."
                : undefined
            }
            onClick={() => {
              restore.reset();
              setAsking("restore");
            }}
          >
            Restore Default
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setAsking("history")}
            className="ml-auto"
          >
            History
          </Button>
        </div>
        {!canEdit ? <p className="text-xs text-ink-muted">{refusal}</p> : null}
        <OutcomeNote command={save} />
        <OutcomeNote command={restore} />
      </footer>

      {asking === "save" ? (
        <CommandDialog
          title={`Save “${rule.title}”`}
          confirm={`Save Version ${rule.version + 1}`}
          pendingLabel="Saving…"
          command={save}
          onClose={() => setAsking(null)}
          testId={`bank-rule-${rule.id}-confirm`}
          onConfirm={() =>
            save.run("edit_rule", {
              ruleId: rule.id,
              params: checked.params,
              ...(rule.required ? {} : { enabled }),
              ...(note.trim() ? { note: note.trim() } : {}),
            })
          }
        >
          <p className="text-ink-muted">
            From the next check on, the bank runs on:
          </p>
          <blockquote className="border-federal-blue border-l-4 pl-3">
            {enabled ? sentence : `Off. ${sentence}`}
          </blockquote>
          <label
            htmlFor={noteId}
            className="eyebrow block text-[0.65rem] font-bold text-ink-muted"
          >
            Why (optional, kept with the Version)
          </label>
          <input
            id={noteId}
            value={note}
            maxLength={200}
            onChange={(event) => setNote(event.target.value)}
            className={inputClass}
          />
        </CommandDialog>
      ) : null}
      {asking === "restore" ? (
        <CommandDialog
          title={`Restore “${rule.title}”`}
          confirm="Restore the Default"
          pendingLabel="Restoring…"
          command={restore}
          onClose={() => setAsking(null)}
          onConfirm={() => restore.run("restore_rule", { ruleId: rule.id })}
        >
          <p className="text-ink-muted">
            A new Version is saved with the Default Parameters:
          </p>
          <blockquote className="border-ink border-l-4 pl-3">
            {rule.defaultSentence}
          </blockquote>
        </CommandDialog>
      ) : null}
      {asking === "history" ? (
        <HistoryDialog rule={rule} onClose={() => setAsking(null)} />
      ) : null}
    </article>
  );
}
