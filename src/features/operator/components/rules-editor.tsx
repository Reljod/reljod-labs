"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { RulebookVersion } from "../domain/contract";
import {
  ACTION_KINDS,
  ACTION_TITLES,
  DEFAULT_RULEBOOK,
  FIELD_CODES,
  FIELD_TITLES,
  RULE_LIMITS,
  RULES,
  type Rulebook,
  type RuleInfo,
  SCREEN_CODES,
} from "../domain/rules";
import { SCREEN_TITLES } from "../legacy/types";
import { saveRulebook } from "../server/actions";
import { api } from "./api";
import {
  changedRules,
  diffSummary,
  firstProblem,
  nextVersion,
  sameRulebook,
  toggleIn,
  warningOf,
} from "./rulebook-diff";
import {
  Button,
  cx,
  ErrorNote,
  fieldClass,
  friendly,
  Panel,
  Spinner,
  Tag,
  useWrite,
} from "./ui";

const WHEN = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const NOTE_CHARS = 200;

/** A pressed-or-not choice: a Screen, a field, an Action kind. */
function Chip({
  pressed,
  onToggle,
  tone = "blue",
  children,
  label,
}: {
  pressed: boolean;
  onToggle: () => void;
  tone?: "blue" | "brass";
  children: ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      onClick={onToggle}
      className={cx(
        "flex min-h-9 w-full items-start gap-2 rounded-sm border-2 px-2 py-1.5 text-left text-xs transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-federal-blue",
        "disabled:cursor-not-allowed",
        pressed
          ? tone === "brass"
            ? "border-ink bg-brass/30 text-ink shadow-hard-sm"
            : "border-ink bg-morning-haze text-ink shadow-hard-sm"
          : "border-ink/20 bg-paper text-ink-muted hover:border-ink",
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          "mt-px flex size-3.5 shrink-0 items-center justify-center rounded-[1px] border-2 border-ink font-mono text-[0.6rem] leading-none",
          pressed ? "bg-ink text-paper" : "bg-paper",
        )}
      >
        {pressed ? "✓" : ""}
      </span>
      <span className="min-w-0">{children}</span>
    </button>
  );
}

/** The on/off switch of one Rule: a real checkbox with the switch role. */
function RuleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <label className="inline-flex shrink-0 cursor-pointer items-center gap-2">
      <input
        type="checkbox"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={cx(
          "relative h-5 w-9 rounded-sm border-2 border-ink transition-colors",
          "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-federal-blue",
          checked ? "bg-ivy" : "bg-marble",
        )}
      >
        <span
          className={cx(
            "absolute top-0.5 size-3 rounded-[1px] border border-ink bg-paper transition-transform",
            checked ? "translate-x-[1.1rem]" : "translate-x-0.5",
          )}
        />
      </span>
      <span className="w-6 font-mono text-[0.68rem] font-bold uppercase">
        {checked ? "On" : "Off"}
      </span>
    </label>
  );
}

function Parameters({
  rule,
  draft,
  edit,
}: {
  rule: RuleInfo;
  draft: Rulebook;
  edit: (next: Rulebook) => void;
}) {
  const id = useId();
  if (rule.key === "screens") {
    return (
      <div className="flex flex-col gap-2">
        <p className="eyebrow text-[0.62rem] text-ink-muted">
          Screens it may enter ({draft.screens.allowed.length} of{" "}
          {SCREEN_CODES.length})
        </p>
        <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
          {SCREEN_CODES.map((code) => (
            <li key={code}>
              <Chip
                pressed={draft.screens.allowed.includes(code)}
                label={`${code} ${SCREEN_TITLES[code]}`}
                onToggle={() =>
                  edit({
                    ...draft,
                    screens: {
                      ...draft.screens,
                      allowed: toggleIn(
                        draft.screens.allowed,
                        code,
                        SCREEN_CODES,
                      ),
                    },
                  })
                }
              >
                <span className="font-mono font-bold">{code}</span>{" "}
                {SCREEN_TITLES[code]}
              </Chip>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (rule.key === "records") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <label
          htmlFor={`${id}-max`}
          className="eyebrow text-[0.62rem] text-ink-muted"
        >
          At most
        </label>
        <input
          id={`${id}-max`}
          type="number"
          inputMode="numeric"
          min={1}
          max={RULE_LIMITS.maxRecords}
          step={1}
          value={Number.isNaN(draft.records.max) ? "" : draft.records.max}
          onChange={(event) =>
            edit({
              ...draft,
              records: {
                ...draft.records,
                max:
                  event.target.value === ""
                    ? Number.NaN
                    : Number(event.target.value),
              },
            })
          }
          className={cx(fieldClass, "w-24 font-mono tabular-nums")}
        />
        <span className="text-xs text-ink-muted">
          records per Run (1 to {RULE_LIMITS.maxRecords})
        </span>
      </div>
    );
  }
  if (rule.key === "protectedFields") {
    return (
      <div className="flex flex-col gap-2">
        <p className="eyebrow text-[0.62rem] text-ink-muted">
          Protected fields ({draft.protectedFields.fields.length})
        </p>
        <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {FIELD_CODES.map((field) => (
            <li key={field}>
              <Chip
                pressed={draft.protectedFields.fields.includes(field)}
                label={FIELD_TITLES[field]}
                onToggle={() =>
                  edit({
                    ...draft,
                    protectedFields: {
                      ...draft.protectedFields,
                      fields: toggleIn(
                        draft.protectedFields.fields,
                        field,
                        FIELD_CODES,
                      ),
                    },
                  })
                }
              >
                {FIELD_TITLES[field]}
              </Chip>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (rule.key === "guarded") {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs">
          <span className="font-semibold">
            A ticked Action waits for a person.
          </span>{" "}
          <span className="text-ink-muted">
            The Guard holds the key that would commit it and pauses the Run
            until someone approves or refuses.
          </span>
        </p>
        <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {ACTION_KINDS.map((kind) => {
            const waits = draft.guarded.actions.includes(kind);
            return (
              <li key={kind}>
                <Chip
                  tone="brass"
                  pressed={waits}
                  label={`${ACTION_TITLES[kind]}: ${waits ? "waits for a person" : "goes through"}`}
                  onToggle={() =>
                    edit({
                      ...draft,
                      guarded: {
                        ...draft.guarded,
                        actions: toggleIn(
                          draft.guarded.actions,
                          kind,
                          ACTION_KINDS,
                        ),
                      },
                    })
                  }
                >
                  <span className="block">{ACTION_TITLES[kind]}</span>
                  <span
                    className={cx(
                      "font-mono text-[0.62rem] uppercase",
                      waits ? "font-bold text-oak" : "text-ink-muted",
                    )}
                  >
                    {waits ? "Waits for a person" : "Goes through"}
                  </span>
                </Chip>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }
  return null;
}

function RuleCard({
  rule,
  draft,
  changed,
  edit,
}: {
  rule: RuleInfo;
  draft: Rulebook;
  changed: boolean;
  edit: (next: Rulebook) => void;
}) {
  const enabled = draft[rule.key].enabled;
  const hasParameters =
    rule.key === "screens" ||
    rule.key === "records" ||
    rule.key === "protectedFields" ||
    rule.key === "guarded";
  return (
    <li
      className={cx(
        "flex min-w-0 flex-col gap-3 rounded-sm border-2 bg-paper p-3",
        changed
          ? "border-brass shadow-[3px_3px_0_var(--color-brass)]"
          : "border-ink",
        hasParameters ? "md:col-span-2" : "",
      )}
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{rule.title}</h3>
            {changed ? <Tag tone="brass">edited</Tag> : null}
          </div>
          <p className="font-mono text-[0.65rem] text-ink-muted">{rule.id}</p>
        </div>
        <RuleSwitch
          checked={enabled}
          label={`${rule.title}: ${enabled ? "on" : "off"}`}
          onChange={(checked) =>
            edit({
              ...draft,
              [rule.key]: { ...draft[rule.key], enabled: checked },
            })
          }
        />
      </div>
      <p
        className={cx(
          "text-sm leading-relaxed",
          enabled ? "" : "text-ink-muted line-through decoration-ink/30",
        )}
      >
        {rule.sentence(draft)}
      </p>
      <div className="flex flex-wrap gap-1.5">
        <Tag tone="neutral">{rule.when}</Tag>
        <Tag
          tone={
            rule.outcome === "pauses for a person"
              ? "brass"
              : rule.outcome === "refuses the Action"
                ? "red"
                : "blue"
          }
        >
          code {rule.outcome}
        </Tag>
        {enabled ? null : <Tag tone="ink">off</Tag>}
      </div>
      {hasParameters ? (
        <fieldset
          disabled={!enabled}
          className={cx(
            "min-w-0 border-ink/15 border-t pt-3",
            enabled ? "" : "opacity-55",
          )}
        >
          <legend className="sr-only">Parameters of {rule.title}</legend>
          <Parameters rule={rule} draft={draft} edit={edit} />
        </fieldset>
      ) : null}
    </li>
  );
}

/**
 * The Rules place: one card per Rule with its switch and Parameters inline,
 * the sentence updating as you edit. Edits stay a draft until Save writes the
 * next version. History loads any version into the draft; Reset loads the
 * Default. A Run records the version it ran under.
 */
export function RulesEditor({
  initialRulebooks,
}: {
  /** Every version newest first, then the Default; the first is current. Null: load it here. */
  initialRulebooks: RulebookVersion[] | null;
}) {
  const seeded =
    initialRulebooks && initialRulebooks.length > 0 ? initialRulebooks : null;
  const [history, setHistory] = useState<RulebookVersion[]>(seeded ?? []);
  const current = history[0] ?? null;
  const [draft, setDraft] = useState<Rulebook>(
    seeded?.[0]?.rulebook ?? DEFAULT_RULEBOOK,
  );
  /** Which version the draft was loaded from, when it was loaded from history. */
  const [loadedFrom, setLoadedFrom] = useState<number | "default" | null>(null);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(seeded === null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const reading = useRef<AbortController | null>(null);
  const id = useId();

  /**
   * Reads every version. A newer read aborts the older one, and a save
   * aborts any read in flight first, so an old answer never lands on top of
   * a write. `follow` moves the draft to the fresh current version when it
   * still equals `follow` (what was just saved), never over new edits.
   */
  const load = useCallback(async (follow?: Rulebook) => {
    reading.current?.abort();
    const controller = new AbortController();
    reading.current = controller;
    setLoading(true);
    try {
      const versions = await api.rulebooks({ signal: controller.signal });
      if (controller.signal.aborted) return;
      setHistory(versions);
      setLoadError(null);
      const fresh = versions[0]?.rulebook;
      if (fresh) {
        if (follow)
          setDraft((value) => (sameRulebook(value, follow) ? fresh : value));
        else setDraft(fresh);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      setLoadError(
        friendly(
          error,
          "The Rulebook could not load, so the Default is shown.",
        ),
      );
    } finally {
      if (reading.current === controller) {
        reading.current = null;
        setLoading(false);
      }
    }
  }, []);

  // Seeded by the page: no second read on mount (a late one would overwrite edits).
  const loadOnMount = seeded === null;
  useEffect(() => {
    if (loadOnMount) void load();
    return () => reading.current?.abort();
  }, [load, loadOnMount]);

  const base = current?.rulebook ?? DEFAULT_RULEBOOK;
  const changed = changedRules(base, draft);
  const dirty = changed.length > 0;
  const problem = firstProblem(draft);
  const warning = problem ? null : warningOf(draft);
  const upcoming = nextVersion(history);

  const edit = (next: Rulebook) => {
    setResult(null);
    setDraft(next);
  };

  const save = useWrite(async () => {
    setResult(null);
    if (problem) {
      setResult({ ok: false, text: problem });
      return;
    }
    const saved = draft;
    const savedNote = note.trim().slice(0, NOTE_CHARS);
    try {
      const response = await saveRulebook({
        rulebook: saved,
        note: savedNote || undefined,
      });
      if ("error" in response) {
        setResult({ ok: false, text: response.error });
        return;
      }
      // Drop any read that started before the save, show the write's own
      // answer at once, then read the history again.
      reading.current?.abort();
      setHistory((value) => [
        {
          version: response.version,
          rulebook: saved,
          note: savedNote || null,
          createdAt: new Date().toISOString(),
        },
        ...value.filter((item) => item.version !== response.version),
      ]);
      setNote("");
      setLoadedFrom(null);
      setResult({
        ok: true,
        text: `Saved as version ${response.version}. The next Run uses it; a Run already going keeps its own.`,
      });
      void load(saved);
    } catch (error) {
      setResult({ ok: false, text: friendly(error, "Could not save.") });
    }
  });

  const loadIntoDraft = (version: RulebookVersion) => {
    setResult(null);
    setDraft(version.rulebook);
    setLoadedFrom(version.version === 0 ? "default" : version.version);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <Panel
        eyebrow={
          current
            ? `Rulebook · version ${current.version} in force${current.version === 0 ? " (the Default)" : ""}`
            : "Rulebook"
        }
        title="What the Operator may do"
        actions={
          <Button
            size="sm"
            disabled={save.pending || sameRulebook(draft, DEFAULT_RULEBOOK)}
            onClick={() => {
              setResult(null);
              setDraft(DEFAULT_RULEBOOK);
              setLoadedFrom("default");
            }}
          >
            Reset to Default
          </Button>
        }
        bodyClassName="flex flex-col gap-4 p-4"
      >
        <p className="max-w-3xl text-sm leading-relaxed text-ink-muted">
          Rules are data; the Guard and the checks that apply them are code.
          Every Run records the Rulebook version it ran under. A change you save
          applies to the next Run, never to one already going.
        </p>
        {loadError ? <ErrorNote>{loadError}</ErrorNote> : null}
        {loadedFrom !== null ? (
          <p className="rounded-sm border-2 border-federal-blue/40 bg-morning-haze px-3 py-2 text-xs">
            The draft holds{" "}
            {loadedFrom === "default" ? "the Default" : `version ${loadedFrom}`}
            . Nothing is saved until you press Save.
          </p>
        ) : null}

        <ul className="grid gap-3 md:grid-cols-2" aria-busy={loading}>
          {RULES.map((rule) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              draft={draft}
              changed={changed.includes(rule.id)}
              edit={edit}
            />
          ))}
        </ul>

        <div className="flex flex-col gap-2 border-ink/15 border-t-2 pt-4">
          <p
            className={cx(
              "font-mono text-xs font-bold uppercase",
              dirty ? "text-oak" : "text-ink-muted",
            )}
          >
            {diffSummary(changed)}
            {dirty ? (
              <span className="font-normal normal-case">
                {": "}
                {changed
                  .map(
                    (ruleId) => RULES.find((rule) => rule.id === ruleId)?.title,
                  )
                  .join(", ")}
              </span>
            ) : null}
          </p>
          <label
            htmlFor={`${id}-note`}
            className="eyebrow text-[0.62rem] text-ink-muted"
          >
            Note for this version (optional)
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id={`${id}-note`}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={NOTE_CHARS}
              placeholder="Why the change"
              className={cx(fieldClass, "min-w-0 flex-1 basis-48")}
            />
            <Button
              variant="primary"
              pending={save.pending}
              pendingLabel="Saving…"
              disabled={!dirty || problem !== null}
              onClick={() => void save.run()}
            >
              Save as version {upcoming}
            </Button>
            <Button
              variant="ghost"
              disabled={!dirty || save.pending}
              onClick={() => {
                setDraft(base);
                setLoadedFrom(null);
                setResult(null);
              }}
            >
              Discard edits
            </Button>
          </div>
          <p className="text-right font-mono text-[0.62rem] text-ink-muted">
            {note.length}/{NOTE_CHARS}
          </p>
          {problem ? (
            <p role="alert" className="text-sm text-seal-red">
              {problem}
            </p>
          ) : null}
          {warning ? <p className="text-sm text-oak">{warning}</p> : null}
          <p
            aria-live="polite"
            className={cx("text-sm", result?.ok ? "text-ivy" : "text-seal-red")}
          >
            {result?.text}
          </p>
        </div>
      </Panel>

      <Panel
        eyebrow="History"
        title={
          history.length > 0
            ? `${history.length} ${history.length === 1 ? "version" : "versions"}`
            : "Versions"
        }
        actions={loading ? <Spinner className="text-ink-muted" /> : null}
        bodyClassName=""
      >
        <ol className="max-h-[40rem] overflow-y-auto" aria-busy={loading}>
          {history.map((version) => {
            const isCurrent = version.version === current?.version;
            const isLoaded =
              loadedFrom === version.version ||
              (loadedFrom === "default" && version.version === 0);
            return (
              <li key={version.version} className="border-ink/10 border-b">
                <button
                  type="button"
                  onClick={() => loadIntoDraft(version)}
                  aria-label={`Load version ${version.version} into the draft`}
                  className={cx(
                    "flex w-full flex-col gap-0.5 px-4 py-2 text-left text-sm transition-colors hover:bg-marble",
                    "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-federal-blue",
                    isLoaded ? "bg-morning-haze" : "",
                  )}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-semibold">
                      v{version.version}
                    </span>
                    {isCurrent ? <Tag tone="green">in force</Tag> : null}
                    {version.version === 0 ? (
                      <Tag tone="neutral">Default</Tag>
                    ) : null}
                    {isLoaded ? <Tag tone="blue">in the draft</Tag> : null}
                    <span className="ml-auto font-mono text-[0.68rem] text-ink-muted">
                      {version.createdAt
                        ? WHEN.format(new Date(version.createdAt))
                        : "built in"}
                    </span>
                  </span>
                  <span className="text-xs text-ink-muted">
                    {version.note ??
                      (version.version === 0
                        ? "The Rules the site ships with."
                        : "No note.")}
                  </span>
                </button>
              </li>
            );
          })}
          {history.length === 0 ? (
            <li className="px-4 py-3 text-sm text-ink-muted">
              {loading
                ? "Loading the versions…"
                : "No versions to show. The Default is in the draft."}
            </li>
          ) : null}
        </ol>
        <p className="border-ink/10 border-t px-4 py-2 text-xs text-ink-muted">
          Click a version to load it into the draft. Saving it makes a new
          version; old ones are never changed.
        </p>
      </Panel>
    </div>
  );
}
