"use client";

import { type ReactNode, useCallback, useEffect, useId, useState } from "react";
import {
  DEFAULT_RULEBOOK,
  ENTITY_TYPES,
  type Rulebook,
  type RulebookVersion,
  rulebookSchema,
} from "../domain/contract";
import { getRulebook, rulebookHistory, saveRulebook } from "../server/actions";
import { percent } from "./format";
import {
  Button,
  ConfirmDialog,
  cx,
  ErrorNote,
  fieldClass,
  friendly,
  Panel,
  Tag,
  useWrite,
} from "./ui";

const WHEN = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const same = (a: Rulebook, b: Rulebook) =>
  JSON.stringify(a) === JSON.stringify(b);

const TOGGLES = [
  {
    key: "resolveAliases",
    title: "Resolve aliases",
    on: "Treat initials, reordered and transliterated spellings of one party as one name.",
    off: "List every spelling as its own name.",
  },
  {
    key: "includeHandles",
    title: "Names in handles",
    on: "Extract names that only appear inside email addresses or handles.",
    off: "Skip names that only appear in email addresses or handles.",
  },
  {
    key: "includeOfficials",
    title: "Officials",
    on: "Extract judges, notaries and registrars acting in an official capacity.",
    off: "Leave out officials acting in an official capacity.",
  },
] as const;

function RuleCard({
  title,
  changed,
  children,
}: {
  title: string;
  changed: boolean;
  children: ReactNode;
}) {
  return (
    <li
      className={cx(
        "flex flex-col gap-2 rounded-sm border bg-paper p-3",
        changed ? "border-brass" : "border-ink/15",
      )}
    >
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {changed ? <Tag tone="brass">edited</Tag> : null}
      </div>
      <div className="text-sm leading-relaxed">{children}</div>
    </li>
  );
}

function Slider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <span className="mx-1 inline-flex items-center gap-2 align-middle">
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-32 accent-federal-blue"
      />
      <span className="rounded-sm border border-ink/25 px-1.5 font-mono text-xs tabular-nums">
        {percent(value)}
      </span>
    </span>
  );
}

/**
 * The Rulebook as cards with their parameters inline. Edits stay here until
 * Save, which writes a new version with an optional note. History can show
 * any version and restore it as a new one; Reset writes the default as a new
 * version after asking. Every Run records the version it ran under.
 */
export function RulesEditor({
  onSaved,
}: {
  /** Another part of the page shows the Rulebook (the Register's threshold). */
  onSaved: (version: RulebookVersion) => void;
}) {
  const [current, setCurrent] = useState<RulebookVersion | null>(null);
  const [history, setHistory] = useState<RulebookVersion[]>([]);
  const [draft, setDraft] = useState<Rulebook>(DEFAULT_RULEBOOK);
  const [note, setNote] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [newExclude, setNewExclude] = useState("");
  const [newInstruction, setNewInstruction] = useState("");
  const [viewing, setViewing] = useState<number | null>(null);
  const [resetting, setResetting] = useState(false);
  const id = useId();

  const load = useCallback(async () => {
    try {
      const [rulebook, versions] = await Promise.all([
        getRulebook(),
        rulebookHistory(),
      ]);
      setCurrent(rulebook);
      setDraft(rulebook.rulebook);
      setHistory(versions);
      setLoadError(null);
      return rulebook;
    } catch (error) {
      setLoadError(
        friendly(error, "The rules could not load, so the defaults are shown."),
      );
      return null;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const base = current?.rulebook ?? DEFAULT_RULEBOOK;
  const dirty = !same(base, draft);
  const valid = rulebookSchema.safeParse(draft);
  const problem = !valid.success
    ? draft.entityTypes.length === 0
      ? "Pick at least one entity type."
      : "Some rule is out of range."
    : draft.dropBelow > draft.reviewBelow
      ? "Drop-below is above review-below: names you would flag are dropped instead."
      : null;

  const edit = (patch: Partial<Rulebook>) => {
    setResult(null);
    setDraft((value) => ({ ...value, ...patch }));
  };

  /** Writes a Rulebook as a new version; says what happened where the button is. */
  const write = async (rulebook: Rulebook, saveNote: string) => {
    const response = await saveRulebook({
      rulebook,
      note: saveNote.trim() || undefined,
    });
    if ("error" in response) return response.error;
    const fresh = await load();
    if (fresh) onSaved(fresh);
    setNote("");
    setResult({
      ok: true,
      text: `Saved as version ${response.version}. New runs use it.`,
    });
    return null;
  };

  const save = useWrite(async () => {
    setResult(null);
    const error = await write(draft, note).catch((caught: unknown) =>
      friendly(caught, "Could not save."),
    );
    if (error) setResult({ ok: false, text: error });
  });

  const restore = useWrite(async (version: RulebookVersion) => {
    setResult(null);
    const error = await write(
      version.rulebook,
      `Restored version ${version.version}`,
    ).catch((caught: unknown) => friendly(caught, "Could not restore."));
    if (error) setResult({ ok: false, text: error });
  });

  const addExclude = () => {
    const value = newExclude.trim();
    if (!value) return;
    if (
      !draft.exclude.some((item) => item.toLowerCase() === value.toLowerCase())
    )
      edit({ exclude: [...draft.exclude, value.slice(0, 200)] });
    setNewExclude("");
  };
  const addInstruction = () => {
    const value = newInstruction.trim();
    if (!value || draft.instructions.length >= 30) return;
    edit({ instructions: [...draft.instructions, value.slice(0, 500)] });
    setNewInstruction("");
  };
  const moveInstruction = (index: number, by: -1 | 1) => {
    const next = draft.instructions.slice();
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item);
    edit({ instructions: next });
  };

  const busy = save.pending || restore.pending;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <Panel
        eyebrow={
          current
            ? `Rulebook · version ${current.version}${current.version === 0 ? " (default)" : ""}`
            : "Rulebook"
        }
        title="What counts as a name"
        actions={
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || same(base, DEFAULT_RULEBOOK)}
            onClick={() => setResetting(true)}
          >
            Reset to default
          </Button>
        }
        bodyClassName="flex flex-col gap-4 p-4"
      >
        {loadError ? <ErrorNote>{loadError}</ErrorNote> : null}
        <ul className="grid gap-3 md:grid-cols-2">
          <RuleCard
            title="Entity types"
            changed={!same({ ...base, entityTypes: draft.entityTypes }, base)}
          >
            Extract
            {ENTITY_TYPES.map((type) => (
              <label
                key={type}
                className="mx-1.5 inline-flex items-center gap-1"
              >
                <input
                  type="checkbox"
                  checked={draft.entityTypes.includes(type)}
                  onChange={(event) =>
                    edit({
                      entityTypes: event.target.checked
                        ? ENTITY_TYPES.filter(
                            (item) =>
                              item === type || draft.entityTypes.includes(item),
                          )
                        : draft.entityTypes.filter((item) => item !== type),
                    })
                  }
                />
                {type === "person" ? "people" : "organizations"}
              </label>
            ))}
            named in the document.
          </RuleCard>
          <RuleCard
            title="Thresholds"
            changed={
              base.reviewBelow !== draft.reviewBelow ||
              base.dropBelow !== draft.dropBelow
            }
          >
            <span className="block">
              Flag a name <strong>for review</strong> when confidence is below
              <Slider
                label="Review below"
                value={draft.reviewBelow}
                onChange={(value) => edit({ reviewBelow: value })}
              />
            </span>
            <span className="block">
              Leave a name out only below
              <Slider
                label="Drop below"
                value={draft.dropBelow}
                onChange={(value) => edit({ dropBelow: value })}
              />
              <span className="text-xs text-ink-muted">
                {" "}
                Default 0%: never leave one out.
              </span>
            </span>
          </RuleCard>
          {TOGGLES.map((toggle) => (
            <RuleCard
              key={toggle.key}
              title={toggle.title}
              changed={base[toggle.key] !== draft[toggle.key]}
            >
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  role="switch"
                  aria-checked={draft[toggle.key]}
                  className="mt-1"
                  checked={draft[toggle.key]}
                  onChange={(event) =>
                    edit({ [toggle.key]: event.target.checked })
                  }
                />
                <span>{draft[toggle.key] ? toggle.on : toggle.off}</span>
              </label>
            </RuleCard>
          ))}
          <RuleCard
            title="Never extract"
            changed={!same({ ...base, exclude: draft.exclude }, base)}
          >
            <ul className="mb-2 flex flex-wrap gap-1">
              {draft.exclude.map((item) => (
                <li key={item}>
                  <span className="inline-flex items-center gap-1 rounded-sm border border-ink/20 bg-marble px-1.5 py-0.5 text-xs">
                    {item}
                    <button
                      type="button"
                      aria-label={`Remove ${item}`}
                      onClick={() =>
                        edit({
                          exclude: draft.exclude.filter(
                            (value) => value !== item,
                          ),
                        })
                      }
                      className="font-mono text-ink-muted hover:text-seal-red"
                    >
                      ×
                    </button>
                  </span>
                </li>
              ))}
              {draft.exclude.length === 0 ? (
                <li className="text-xs text-ink-muted">Nothing excluded.</li>
              ) : null}
            </ul>
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                addExclude();
              }}
            >
              <input
                value={newExclude}
                onChange={(event) => setNewExclude(event.target.value)}
                maxLength={200}
                placeholder="e.g. the bank's own name"
                aria-label="Add a name never to extract"
                className={cx(fieldClass, "h-8 flex-1")}
              />
              <Button size="sm" type="submit" disabled={!newExclude.trim()}>
                Add
              </Button>
            </form>
          </RuleCard>
        </ul>

        <section
          className={cx(
            "flex flex-col gap-2 rounded-sm border p-3",
            same({ ...base, instructions: draft.instructions }, base)
              ? "border-ink/15"
              : "border-brass",
          )}
        >
          <h3 className="text-sm font-semibold">
            Instructions every agent follows, in plain language
          </h3>
          <ol className="flex flex-col gap-1.5">
            {draft.instructions.map((instruction, index) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: instructions are edited in place and may repeat
                key={index}
                className="flex items-start gap-2 text-sm"
              >
                <span className="w-5 shrink-0 pt-1.5 text-right font-mono text-xs text-ink-muted">
                  {index + 1}.
                </span>
                <textarea
                  value={instruction}
                  maxLength={500}
                  rows={1}
                  aria-label={`Instruction ${index + 1}`}
                  onChange={(event) => {
                    const next = draft.instructions.slice();
                    next[index] = event.target.value;
                    edit({ instructions: next });
                  }}
                  className={cx(
                    fieldClass,
                    "h-auto min-h-9 flex-1 resize-y py-1.5",
                  )}
                />
                <span className="flex shrink-0 gap-0.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Move up"
                    disabled={index === 0}
                    onClick={() => moveInstruction(index, -1)}
                  >
                    ↑
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Move down"
                    disabled={index === draft.instructions.length - 1}
                    onClick={() => moveInstruction(index, 1)}
                  >
                    ↓
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Remove"
                    onClick={() =>
                      edit({
                        instructions: draft.instructions.filter(
                          (_, at) => at !== index,
                        ),
                      })
                    }
                  >
                    ×
                  </Button>
                </span>
              </li>
            ))}
          </ol>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              addInstruction();
            }}
          >
            <input
              value={newInstruction}
              onChange={(event) => setNewInstruction(event.target.value)}
              maxLength={500}
              placeholder="Add an instruction in plain language"
              aria-label="Add an instruction"
              className={cx(fieldClass, "h-8 flex-1")}
            />
            <Button
              size="sm"
              type="submit"
              disabled={
                !newInstruction.trim() || draft.instructions.length >= 30
              }
            >
              Add
            </Button>
          </form>
        </section>

        <div className="flex flex-col gap-2 border-ink/10 border-t pt-4">
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
              maxLength={200}
              placeholder="Why the change"
              className={cx(fieldClass, "min-w-48 flex-1")}
            />
            <Button
              variant="primary"
              pending={save.pending}
              pendingLabel="Saving…"
              disabled={!dirty || !valid.success || restore.pending}
              onClick={() => void save.run()}
            >
              Save as new version
            </Button>
            <Button
              variant="ghost"
              disabled={!dirty || busy}
              onClick={() => {
                setDraft(base);
                setResult(null);
              }}
            >
              Discard
            </Button>
          </div>
          {problem ? (
            <p
              className={cx(
                "text-sm",
                valid.success ? "text-oak" : "text-seal-red",
              )}
            >
              {problem}
            </p>
          ) : null}
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
        title={`${history.length} versions`}
        bodyClassName=""
      >
        <ol className="sv-scroll max-h-[40rem] overflow-y-auto">
          {history.map((version) => (
            <li
              key={version.version}
              className="border-ink/10 border-b px-4 py-2 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-semibold">
                  v{version.version}
                </span>
                {version.version === current?.version ? (
                  <Tag tone="green">in force</Tag>
                ) : null}
                <span className="ml-auto font-mono text-[0.68rem] text-ink-muted">
                  {version.version === 0
                    ? "built in"
                    : WHEN.format(new Date(version.createdAt))}
                </span>
              </div>
              <p className="text-xs text-ink-muted">
                {version.note ??
                  (version.version === 0 ? "The default." : "No note.")}
              </p>
              <div className="mt-1 flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-expanded={viewing === version.version}
                  onClick={() =>
                    setViewing(
                      viewing === version.version ? null : version.version,
                    )
                  }
                >
                  {viewing === version.version ? "Hide" : "View"}
                </Button>
                {version.version !== current?.version ? (
                  <Button
                    size="sm"
                    pending={restore.pending}
                    pendingLabel="Restoring…"
                    disabled={save.pending}
                    onClick={() => void restore.run(version)}
                  >
                    Restore as new version
                  </Button>
                ) : null}
              </div>
              {viewing === version.version ? (
                <pre className="sv-scroll mt-2 max-h-72 overflow-auto rounded-sm bg-marble/60 p-2 font-mono text-[0.68rem] whitespace-pre-wrap">
                  {JSON.stringify(version.rulebook, null, 2)}
                </pre>
              ) : null}
            </li>
          ))}
          {history.length === 0 && !loadError ? (
            <li className="px-4 py-3 text-sm text-ink-muted">Loading…</li>
          ) : null}
        </ol>
      </Panel>

      {resetting ? (
        <ConfirmDialog
          title="Reset the Rulebook to default"
          confirm="Reset"
          pendingLabel="Resetting…"
          danger
          onClose={() => setResetting(false)}
          onConfirm={async () => {
            const error = await write(DEFAULT_RULEBOOK, "Reset to default");
            return error;
          }}
        >
          Writes the default rules as a new version and drops any unsaved edits.
          Earlier versions stay in the history, so you can restore one.
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
