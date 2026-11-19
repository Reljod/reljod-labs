"use client";

import { useEffect, useState } from "react";
import { API, type RulesResponse } from "../domain/api";
import {
  defaultRulebook,
  RULE_DEFS,
  RULE_GROUPS,
  type Rulebook,
  type RuleEdit,
  type RuleValue,
  sentenceOf,
} from "../domain/rules";
import { saveRulesAction } from "../server/actions";
import { getJson } from "./api";
import { Badge, Button, cx, inputClass, Panel } from "./ui";

const same = (a: RuleValue | undefined, b: RuleValue | undefined) =>
  JSON.stringify(a) === JSON.stringify(b);

/** The edits that turn `saved` into `draft`. */
function editsOf(saved: Rulebook, draft: Rulebook): RuleEdit[] {
  const edits: RuleEdit[] = [];
  for (const def of RULE_DEFS) {
    const before = saved[def.id];
    const after = draft[def.id];
    const params: Record<string, RuleValue> = {};
    for (const name of Object.keys(def.params))
      if (!same(before.params[name], after.params[name]))
        params[name] = after.params[name];
    const toggled = before.enabled !== after.enabled;
    if (toggled || Object.keys(params).length > 0)
      edits.push({
        id: def.id,
        ...(toggled ? { enabled: after.enabled } : {}),
        ...(Object.keys(params).length > 0 ? { params } : {}),
      });
  }
  return edits;
}

/** The Rules place: every Rule as a sentence with its values, edited and saved as a new Version. */
export function RulesPanel({ initial }: { initial: RulesResponse | null }) {
  const [rules, setRules] = useState<RulesResponse | null>(initial);
  const [draft, setDraft] = useState<Rulebook>(
    initial?.rulebook ?? defaultRulebook(),
  );
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const load = async () => {
    const next = await getJson<RulesResponse>(API.rules);
    setRules(next);
    setDraft(next.rulebook);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: loads once when the server gave nothing.
  useEffect(() => {
    if (!initial)
      void load().catch((error: Error) =>
        setNote({ ok: false, text: error.message }),
      );
  }, []);

  const saved = rules?.rulebook ?? defaultRulebook();
  const edits = editsOf(saved, draft);

  const set = (id: keyof Rulebook, change: Partial<Rulebook[keyof Rulebook]>) =>
    setDraft((current) => ({
      ...current,
      [id]: {
        ...current[id],
        ...change,
        params: { ...current[id].params, ...(change.params ?? {}) },
      },
    }));

  const save = async () => {
    setPending(true);
    setNote(null);
    setErrors({});
    const result = await saveRulesAction(edits);
    setPending(false);
    if (!result.ok) {
      setNote({ ok: false, text: result.error });
      setErrors(
        Object.fromEntries(
          (result.errors ?? []).map((error) => [
            `${error.id}:${error.param ?? ""}`,
            error.message,
          ]),
        ),
      );
      return;
    }
    await load().catch(() => {});
    setNote({ ok: true, text: `Saved as Rulebook v${result.version}.` });
  };

  return (
    <div
      className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]"
      id="cv-panel-rules"
    >
      <div className="flex flex-col gap-4">
        {RULE_GROUPS.map((group) => (
          <Panel key={group.id} title={group.title} bodyClassName="">
            <ul className="divide-y divide-ink/15">
              {RULE_DEFS.filter((def) => def.group === group.id).map((def) => {
                const state = draft[def.id];
                return (
                  <li
                    key={def.id}
                    className="space-y-2 px-4 py-3"
                    data-rule={def.id}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold">{def.title}</h3>
                      <Badge tone={def.outcome === "block" ? "red" : "amber"}>
                        {def.outcome === "block" ? "Refuses" : "Flags"}
                      </Badge>
                      {def.canDisable ? (
                        <label className="ml-auto flex items-center gap-1.5 text-xs">
                          <input
                            type="checkbox"
                            checked={state.enabled}
                            onChange={(event) =>
                              set(def.id, { enabled: event.target.checked })
                            }
                          />
                          On
                        </label>
                      ) : (
                        <span className="ml-auto font-mono text-[0.65rem] text-ink-muted uppercase">
                          Always on
                        </span>
                      )}
                    </div>
                    <p
                      className={cx(
                        "text-sm",
                        !state.enabled && "text-ink-muted line-through",
                      )}
                    >
                      {sentenceOf(def, state)}
                    </p>
                    <p className="text-xs text-ink-muted">{def.why}</p>
                    <div className="flex flex-wrap gap-3">
                      {Object.entries(def.params).map(([name, param]) => {
                        const id = `rule-${def.id}-${name}`;
                        const error = errors[`${def.id}:${name}`];
                        return (
                          <label
                            key={name}
                            htmlFor={id}
                            className="flex min-w-40 flex-1 flex-col gap-1 text-xs"
                          >
                            <span className="eyebrow text-ink-muted">
                              {param.label}
                              {param.kind === "number" && param.unit
                                ? ` (${param.unit})`
                                : ""}
                            </span>
                            {param.kind === "number" ? (
                              <input
                                id={id}
                                type="number"
                                className={cx(inputClass, "max-w-40")}
                                min={param.min}
                                max={param.max}
                                step={param.step}
                                aria-invalid={Boolean(error)}
                                value={Number(state.params[name] ?? 0)}
                                onChange={(event) =>
                                  set(def.id, {
                                    params: {
                                      [name]: Number(event.target.value),
                                    },
                                  })
                                }
                              />
                            ) : (
                              <textarea
                                id={id}
                                rows={3}
                                className={cx(inputClass, "font-mono text-xs")}
                                aria-invalid={Boolean(error)}
                                placeholder={
                                  param.kind === "columns"
                                    ? "table.column, one per line"
                                    : "table, one per line"
                                }
                                value={(
                                  (state.params[name] as string[]) ?? []
                                ).join("\n")}
                                onChange={(event) =>
                                  set(def.id, {
                                    params: {
                                      [name]: event.target.value
                                        .split(/[\n,]+/)
                                        .map((item) => item.trim())
                                        .filter(Boolean),
                                    },
                                  })
                                }
                              />
                            )}
                            {error ? (
                              <span className="text-seal-red">{error}</span>
                            ) : null}
                          </label>
                        );
                      })}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Panel>
        ))}
      </div>
      <div className="flex flex-col gap-4">
        <Panel eyebrow={`Rulebook v${rules?.version ?? 0}`} title="Save">
          <p className="text-sm">
            Rules are data: each save is a new Version of your Rulebook. Checks
            are code. The Guard and the chart checks read these values on every
            Query and every View; the Analyst cannot waive them.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              pending={pending}
              pendingLabel="Saving…"
              disabled={edits.length === 0}
              onClick={save}
            >
              Save{" "}
              {edits.length > 0
                ? `${edits.length} change${edits.length === 1 ? "" : "s"}`
                : "Rules"}
            </Button>
            <Button
              variant="ghost"
              disabled={edits.length === 0 || pending}
              onClick={() => setDraft(saved)}
            >
              Discard
            </Button>
          </div>
          {note ? (
            <p
              role={note.ok ? "status" : "alert"}
              className={cx(
                "mt-2 text-sm",
                note.ok ? "text-ivy" : "text-seal-red",
              )}
            >
              {note.text}
            </p>
          ) : null}
        </Panel>
        <Panel title="Versions" bodyClassName="">
          <ul className="divide-y divide-ink/15 text-sm">
            {(rules?.history ?? []).map((version) => (
              <li key={version.version} className="px-4 py-2">
                <span className="font-mono font-bold">v{version.version}</span>{" "}
                <span className="text-xs text-ink-muted">
                  {new Date(version.savedAt).toLocaleString("en-GB")}
                </span>
                <p className="text-xs text-ink-muted">
                  {version.changed.join(", ")}
                </p>
              </li>
            ))}
            <li className="px-4 py-2">
              <span className="font-mono font-bold">v0</span>{" "}
              <span className="text-xs text-ink-muted">The Defaults</span>
            </li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}
