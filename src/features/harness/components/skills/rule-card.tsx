"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  OUTCOME_LABEL,
  OUTCOMES,
  type Outcome,
  type ParameterValue,
  type RuleEditError,
  type RuleVersion,
  type RuleView,
  renderRuleSentence,
} from "../../domain/rules";
import {
  type CardDraft,
  dateProblem,
  differsFromDefault,
  draftOfState,
  draftProblems,
  editOfDraft,
  isDirty,
  type ParamDraft,
} from "../../domain/skills/rule-fields";
import { ApiFailure, api, keys, messageOf } from "../api";
import { scrollWithin } from "../scroll";
import {
  Badge,
  Button,
  ConfirmDialog,
  cx,
  Dialog,
  DoneNote,
  ErrorNote,
  Loading,
  useWrite,
} from "../ui";
import { ParamField } from "./param-field";

const MEANING: Record<Outcome, { short: string; line: string }> = {
  block: { short: "stops the case", line: "The case cannot proceed." },
  refer: { short: "a person looks", line: "A person must look at it." },
  warn: { short: "noted, goes on", line: "It is noted and the Run goes on." },
};

/** What Demo mode may do to the open card. */
export type RuleCardHandle = {
  setParameter(name: string, value: ParameterValue): void;
  save(): Promise<void>;
};

const WHEN = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * One Rule as a card (ADR 0015): switch, title, the Rule's sentence with its
 * Parameters as fields in it, the Outcome, the citation and the effective
 * date. Edits stay in the card until Save; Save and Discard show only while
 * the card differs from the saved Version. A refusal from the server lands on
 * the field at fault.
 */
export function RuleCard({
  view,
  canEdit,
  highlighted,
  register,
}: {
  view: RuleView;
  canEdit: boolean;
  highlighted: boolean;
  register: (ruleId: string, handle: RuleCardHandle | null) => void;
}) {
  const { spec, state } = view;
  const queryClient = useQueryClient();
  const base = useMemo(() => draftOfState(spec, state), [spec, state]);
  const [draft, setDraft] = useState<CardDraft>(base);
  const [server, setServer] = useState<RuleEditError[]>([]);
  const [history, setHistory] = useState(false);
  const [restoring, setRestoring] = useState<{ version: number | null } | null>(
    null,
  );
  const [saved, setSaved] = useState<string | null>(null);
  const titleId = useId();
  const ref = useRef<HTMLElement>(null);

  // A new saved Version (mine, or a restore) replaces what the card holds.
  const stateKey = `${state.version}`;
  const lastKey = useRef(stateKey);
  useEffect(() => {
    if (lastKey.current === stateKey) return;
    lastKey.current = stateKey;
    setDraft(base);
    setServer([]);
  }, [stateKey, base]);

  useEffect(() => {
    if (highlighted) scrollWithin(ref.current, "center");
  }, [highlighted]);

  const dirty = isDirty(spec, base, draft);
  const local = useMemo(() => draftProblems(spec, draft), [spec, draft]);
  const dateError = dateProblem(draft.effectiveFrom);
  const problems: Record<string, string> = { ...local };
  for (const error of server) {
    if (error.field === "params" && error.param)
      problems[error.param] ??= error.message;
  }
  const hasProblem = Object.keys(local).length > 0 || dateError !== null;

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["harness", "rules"] }),
      queryClient.invalidateQueries({ queryKey: keys.skills }),
      queryClient.invalidateQueries({ queryKey: keys.ruleHistory(spec.id) }),
      queryClient.invalidateQueries({ queryKey: ["harness", "audit"] }),
    ]);

  const save = useWrite(async () => {
    setServer([]);
    setSaved(null);
    try {
      const edit = editOfDraft(spec, base, draft);
      const next = await api.rules.save(spec.id, edit);
      await refresh();
      setSaved(`Saved as Version ${next.state.version}.`);
      return next;
    } catch (error) {
      if (error instanceof ApiFailure) setServer(error.errors);
      throw error;
    }
  });

  const update = (patch: Partial<CardDraft>) => {
    setSaved(null);
    setServer([]);
    setDraft((current) => ({ ...current, ...patch }));
  };
  const setParam = (name: string, value: ParamDraft) =>
    update({ params: { ...draft.params, [name]: value } });

  // The controller for Demo mode reaches the card through a handle that always sees the latest draft.
  const latest = useRef({ draft, setParam, save, hasProblem });
  latest.current = { draft, setParam, save, hasProblem };
  useEffect(() => {
    register(spec.id, {
      setParameter(name, value) {
        const parameter = spec.params[name];
        if (!parameter)
          throw new Error(`This Rule has no Parameter "${name}".`);
        const next: ParamDraft =
          parameter.kind === "list"
            ? Array.isArray(value)
              ? value.map(String)
              : [String(value)]
            : String(value);
        latest.current.setParam(name, next);
      },
      async save() {
        const result = await latest.current.save.run();
        if (!result) {
          throw new Error(
            latest.current.save.error ??
              "The Rule was not saved. Check its fields.",
          );
        }
      },
    });
    return () => register(spec.id, null);
  }, [register, spec]);

  const segments = renderRuleSentence(spec, state.params);
  const off = !draft.enabled;
  const readOnly = !canEdit;
  const versionLabel = state.version === 0 ? "default" : `v${state.version}`;
  const errorId = `${titleId}-errors`;
  const messages = [
    ...Object.entries(problems).map(([name, message]) => ({
      key: name,
      message,
    })),
    ...(dateError ? [{ key: "effectiveFrom", message: dateError }] : []),
    ...server
      .filter((error) => error.field !== "params")
      .map((error) => ({ key: error.field, message: error.message })),
  ];

  return (
    <article
      ref={ref}
      id={`rule-${spec.id}`}
      aria-labelledby={titleId}
      className={cx(
        "rounded-sm border bg-paper",
        highlighted ? "hx-flash border-federal-blue" : "border-ink/15",
        dirty && "border-brass",
      )}
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5">
        <button
          type="button"
          role="switch"
          aria-checked={draft.enabled}
          aria-label={`${spec.title}: ${draft.enabled ? "on" : "off"}`}
          disabled={readOnly}
          onClick={() => update({ enabled: !draft.enabled })}
          className={cx(
            "relative h-5 w-9 shrink-0 rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-federal-blue disabled:opacity-60",
            draft.enabled
              ? "border-federal-blue bg-federal-blue"
              : "border-ink/30 bg-marble",
          )}
        >
          <span
            aria-hidden="true"
            className={cx(
              "absolute top-0.5 size-3.5 rounded-full bg-paper shadow transition-[left]",
              draft.enabled ? "left-[1.2rem]" : "left-0.5 bg-ink/40",
            )}
          />
        </button>
        <h3
          id={titleId}
          className={cx(
            "min-w-0 flex-1 text-sm font-semibold",
            off && "text-ink-muted line-through decoration-ink/30",
          )}
        >
          {spec.title}
        </h3>
        {dirty ? <Badge tone="amber">unsaved</Badge> : null}
        <Badge
          tone={state.version === 0 ? "neutral" : "blue"}
          title={
            state.version === 0
              ? "The Default is in force"
              : `Version ${state.version}`
          }
        >
          {versionLabel}
        </Badge>
        <button
          type="button"
          onClick={() => setHistory(true)}
          className="text-xs font-medium text-ink-muted underline underline-offset-2 hover:text-ink"
        >
          History
        </button>
        {view.edited && canEdit ? (
          <button
            type="button"
            onClick={() => setRestoring({ version: null })}
            className="text-xs font-medium text-ink-muted underline underline-offset-2 hover:text-ink"
          >
            Restore default
          </button>
        ) : null}
      </header>

      <div
        className={cx(
          "space-y-3 border-ink/10 border-t px-3 py-3",
          off && "opacity-60",
        )}
      >
        <p className="text-sm leading-8">
          {segments.map((segment, index) =>
            segment.type === "text" ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: the sentence is rebuilt from the same spec; order is identity
              <span key={index}>{segment.text}</span>
            ) : (
              <ParamField
                // biome-ignore lint/suspicious/noArrayIndexKey: as above
                key={index}
                name={segment.name}
                spec={segment.spec}
                draft={draft.params[segment.name]}
                defaultValue={spec.defaults[segment.name]}
                changed={differsFromDefault(
                  spec,
                  segment.name,
                  draft.params[segment.name],
                )}
                invalid={Boolean(problems[segment.name])}
                disabled={readOnly}
                describedBy={errorId}
                onChange={(value) => setParam(segment.name, value)}
              />
            ),
          )}
        </p>

        <fieldset
          className="flex flex-wrap items-center gap-x-3 gap-y-1.5"
          disabled={readOnly}
        >
          <legend className="sr-only">If the Rule is not met</legend>
          <span className="text-xs text-ink-muted" aria-hidden="true">
            If not met:
          </span>
          <div className="inline-flex rounded-sm border border-ink/25 p-0.5">
            {OUTCOMES.map((outcome) => (
              <button
                key={outcome}
                type="button"
                aria-pressed={draft.outcome === outcome}
                title={MEANING[outcome].line}
                onClick={() => update({ outcome })}
                className={cx(
                  "flex h-7 items-baseline gap-1.5 rounded-sm px-2.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-federal-blue",
                  draft.outcome === outcome
                    ? outcome === "block"
                      ? "bg-seal-red text-paper"
                      : outcome === "refer"
                        ? "bg-oak text-paper"
                        : "bg-ink text-paper"
                    : "text-ink-muted hover:bg-marble hover:text-ink",
                  "items-center disabled:cursor-default",
                )}
              >
                {OUTCOME_LABEL[outcome]}
                <span className="hidden text-[0.6rem] font-normal opacity-80 md:inline">
                  {MEANING[outcome].short}
                </span>
              </button>
            ))}
          </div>
          <span className="text-xs text-ink-muted">
            {MEANING[draft.outcome].line}
          </span>
          {draft.outcome !== spec.defaultOutcome ? (
            <span className="font-mono text-[0.65rem] text-oak">
              default {spec.defaultOutcome}
            </span>
          ) : null}
        </fieldset>

        {messages.length > 0 ? (
          <ul
            id={errorId}
            role="alert"
            className="space-y-0.5 text-xs text-seal-red"
          >
            {messages.map((item) => (
              <li key={item.key}>{item.message}</li>
            ))}
          </ul>
        ) : null}
      </div>

      <footer className="flex flex-wrap items-center gap-x-4 gap-y-2 border-ink/10 border-t px-3 py-2 text-xs text-ink-muted">
        <span className="min-w-0 [overflow-wrap:anywhere]">
          {spec.citation}
        </span>
        <label className="ml-auto flex items-center gap-1.5">
          Effective
          <input
            type="date"
            value={draft.effectiveFrom}
            readOnly={readOnly}
            aria-invalid={dateError !== null}
            onChange={(event) => update({ effectiveFrom: event.target.value })}
            title={
              draft.effectiveFrom !== spec.effectiveFrom
                ? `Default: ${spec.effectiveFrom}`
                : undefined
            }
            className={cx(
              "rounded-sm border bg-paper px-1.5 py-0.5 font-mono text-xs text-ink aria-[invalid=true]:border-seal-red",
              draft.effectiveFrom !== spec.effectiveFrom
                ? "border-brass bg-brass/15"
                : "border-ink/25",
            )}
          />
        </label>
      </footer>

      {dirty || save.error || saved ? (
        <div className="flex flex-wrap items-center gap-2 border-ink/10 border-t bg-marble/40 px-3 py-2">
          {dirty ? (
            <>
              <Button
                size="sm"
                variant="primary"
                pending={save.pending}
                pendingLabel="Saving…"
                disabled={hasProblem}
                onClick={() => void save.run()}
              >
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={save.pending}
                onClick={() => {
                  setDraft(base);
                  setServer([]);
                  save.reset();
                }}
              >
                Discard
              </Button>
            </>
          ) : null}
          <ErrorNote className="min-w-0 flex-1 py-1 text-xs">
            {save.error}
          </ErrorNote>
          {!dirty ? (
            <DoneNote className="py-1 text-xs">{saved}</DoneNote>
          ) : null}
        </div>
      ) : null}

      {history ? (
        <RuleHistory
          view={view}
          canEdit={canEdit}
          onClose={() => setHistory(false)}
          onRestore={(version) => setRestoring({ version })}
        />
      ) : null}
      {restoring ? (
        <ConfirmDialog
          title={
            restoring.version === null
              ? `Restore the Default of "${spec.title}"?`
              : `Restore Version ${restoring.version} of "${spec.title}"?`
          }
          confirm={
            restoring.version === null
              ? "Restore default"
              : "Restore this Version"
          }
          pendingLabel="Restoring…"
          onClose={() => setRestoring(null)}
          onConfirm={async () => {
            const next = await api.rules.restore(
              spec.id,
              restoring.version === null ? {} : { version: restoring.version },
            );
            await refresh();
            return `Saved as Version ${next.state.version}. History keeps every earlier Version.`;
          }}
        >
          This saves the{" "}
          {restoring.version === null
            ? "Default"
            : `earlier Version ${restoring.version}`}{" "}
          as a new Version of this Rule. Runs started from now on use it.
          Nothing in the history is deleted.
        </ConfirmDialog>
      ) : null}
    </article>
  );
}

function RuleHistory({
  view,
  canEdit,
  onClose,
  onRestore,
}: {
  view: RuleView;
  canEdit: boolean;
  onClose: () => void;
  onRestore: (version: number) => void;
}) {
  const { spec } = view;
  const history = useQuery({
    queryKey: keys.ruleHistory(spec.id),
    queryFn: () => api.rules.history(spec.id),
  });
  return (
    <Dialog title={`History: ${spec.title}`} onClose={onClose} wide>
      {history.isPending ? (
        <Loading rows={3} />
      ) : history.isError ? (
        <ErrorNote onRetry={() => void history.refetch()}>
          {messageOf(history.error)}
        </ErrorNote>
      ) : history.data.length === 0 ? (
        <p className="text-ink-muted">Never edited: the Default is in force.</p>
      ) : (
        <ol className="space-y-2">
          {history.data.map((version) => (
            <VersionRow
              key={version.version}
              view={view}
              version={version}
              current={version.version === view.state.version}
              canEdit={canEdit}
              onRestore={() => onRestore(version.version)}
            />
          ))}
        </ol>
      )}
    </Dialog>
  );
}

function VersionRow({
  view,
  version,
  current,
  canEdit,
  onRestore,
}: {
  view: RuleView;
  version: RuleVersion;
  current: boolean;
  canEdit: boolean;
  onRestore: () => void;
}) {
  const { spec } = view;
  const sentence = renderRuleSentence(spec, version.params)
    .map((segment) => segment.text)
    .join("");
  return (
    <li className="rounded-sm border border-ink/15 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={current ? "blue" : "neutral"}>v{version.version}</Badge>
        {current ? <Badge tone="green">in force</Badge> : null}
        {!version.enabled ? <Badge tone="amber">off</Badge> : null}
        <Badge>{OUTCOME_LABEL[version.outcome]}</Badge>
        <span className="text-xs text-ink-muted">
          {version.savedBy.name} · {WHEN.format(new Date(version.createdAt))}
        </span>
        {canEdit && !current ? (
          <Button size="sm" className="ml-auto" onClick={onRestore}>
            Restore
          </Button>
        ) : null}
      </div>
      <p className="mt-2 text-sm [overflow-wrap:anywhere]">{sentence}</p>
      <p className="mt-1 font-mono text-[0.7rem] text-ink-muted">
        from {version.effectiveFrom}
        {version.note ? ` · ${version.note}` : ""}
      </p>
    </li>
  );
}
