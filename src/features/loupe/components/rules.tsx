"use client";

import { useEffect, useMemo, useState } from "react";
import type { CorpusResponse } from "../domain/api";
import {
  DOCUMENT_KINDS,
  type DocumentKind,
  KIND_LABELS,
  METRIC_GROUPS,
  METRIC_IDS,
  METRICS,
  type MetricGroup,
  type MetricId,
  TAMPER_TYPES,
  WEIGHT_LABELS,
  WEIGHTS,
  type Weight,
} from "../domain/contract";
import {
  DEFAULT_RULEBOOK,
  diffRulebooks,
  parseRulebook,
  RULE_TEXT,
  type Rulebook,
  type RulebookVersion,
  ruleSentence,
  withRule,
} from "../domain/rules";
import { type Calibration, calibrate, overall } from "../domain/score";
import { saveRulebook } from "../server/actions";
import { api } from "./api";
import { Button, cx, ErrorNote, fieldClass, Panel, Tag, useWrite } from "./ui";

const percent = (rate: number) => `${(rate * 100).toFixed(0)}%`;

const lines = (text: string) =>
  text
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);

/**
 * The Rules: one card per Metric (threshold, Weight, on or off, Document
 * kinds), the Policy, and the Calibration of the draft against the Corpus,
 * recomputed in the browser as the visitor edits (`calibrate` is pure).
 */
export function Rules({
  versions,
  onSaved,
}: {
  versions: RulebookVersion[];
  onSaved: () => void;
}) {
  const current = versions[0];
  const [draft, setDraft] = useState<Rulebook>(current.rulebook);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [corpus, setCorpus] = useState<CorpusResponse | null>(null);
  const [corpusError, setCorpusError] = useState<string | null>(null);

  // A saved version replaces the draft; an edit in flight is the visitor's own.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the saved version changes.
  useEffect(() => {
    setDraft(current.rulebook);
  }, [current.version]);

  useEffect(() => {
    const controller = new AbortController();
    api
      .corpus({ signal: controller.signal })
      .then(setCorpus)
      .catch((reason) => {
        if (!controller.signal.aborted)
          setCorpusError(
            reason instanceof Error ? reason.message : "Could not load.",
          );
      });
    return () => controller.abort();
  }, []);

  const changes = useMemo(
    () => diffRulebooks(current.rulebook, draft),
    [current.rulebook, draft],
  );
  const valid = useMemo(() => parseRulebook(draft), [draft]);
  const calibration = useMemo(() => {
    if (!corpus) return null;
    const recorded = new Map(corpus.sweeps.map((sweep) => [sweep.id, sweep]));
    return {
      draft: calibrate(corpus.entries, recorded, draft),
      saved: calibrate(corpus.entries, recorded, current.rulebook),
    };
  }, [corpus, draft, current.rulebook]);

  const save = useWrite(async () => {
    setError(null);
    setMessage(null);
    const saved = await saveRulebook({ rulebook: draft, note });
    if ("error" in saved) return setError(saved.error);
    setMessage(
      `Saved as version ${saved.version}. Finished Examinations keep their Verdict until you re-evaluate them.`,
    );
    setNote("");
    onSaved();
  });

  const setRule = (metric: MetricId, patch: Parameters<typeof withRule>[2]) =>
    setDraft((book) => withRule(book, metric, patch));
  const setPolicy = (patch: Partial<Rulebook["policy"]>) =>
    setDraft((book) => ({ ...book, policy: { ...book.policy, ...patch } }));

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="min-w-0 space-y-5">
        {(Object.keys(METRIC_GROUPS) as MetricGroup[]).map((group) => (
          <Panel
            key={group}
            eyebrow="Rules"
            title={METRIC_GROUPS[group]}
            bodyClassName="p-0"
          >
            <ul className="divide-y-2 divide-ink/10">
              {METRIC_IDS.filter((id) => METRICS[id].group === group).map(
                (id) => (
                  <RuleCard
                    key={id}
                    metric={id}
                    rulebook={draft}
                    saved={current.rulebook}
                    onChange={(patch) => setRule(id, patch)}
                  />
                ),
              )}
            </ul>
          </Panel>
        ))}

        <Panel
          eyebrow="Policy"
          title="From Findings to a Verdict, and what is benign"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField
              label="Tampered at this many supporting Findings"
              value={draft.policy.tamperedAtSupporting}
              min={1}
              max={20}
              step={1}
              testId="loupe-policy-tampered"
              onChange={(value) => setPolicy({ tamperedAtSupporting: value })}
            />
            <NumberField
              label="Suspicious at this many supporting Findings"
              value={draft.policy.suspiciousAtSupporting}
              min={1}
              max={20}
              step={1}
              onChange={(value) => setPolicy({ suspiciousAtSupporting: value })}
            />
            <NumberField
              label="A pixel Finding over this share of the page is a re-save (context only)"
              value={draft.policy.wholePageShare}
              min={0.2}
              max={1}
              step={0.05}
              onChange={(value) => setPolicy({ wholePageShare: value })}
            />
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1 size-4 accent-federal-blue"
                checked={draft.policy.ownCodeDecisive}
                onChange={(event) =>
                  setPolicy({ ownCodeDecisive: event.target.checked })
                }
              />
              <span>
                A Measurement from the Examiner's own code may be decisive.
                <span className="block text-xs text-ink-muted">
                  Off, only a named Check, which anyone can run again, makes a
                  Document Tampered alone.
                </span>
              </span>
            </label>
            <ListField
              label="Editing tools (a PDF written by one is flagged)"
              value={draft.policy.editors}
              onChange={(editors) => setPolicy({ editors })}
            />
            <ListField
              label="Benign producers (scanners, print drivers: a re-save is not tampering)"
              value={draft.policy.benignProducers}
              onChange={(benignProducers) => setPolicy({ benignProducers })}
            />
          </div>
        </Panel>
      </div>

      <div className="space-y-5 self-start xl:sticky xl:top-20">
        <Panel
          eyebrow={`Rulebook v${current.version}${changes.length ? " · edited" : ""}`}
          title="Save"
        >
          <div className="space-y-3">
            {changes.length ? (
              <ul className="space-y-0.5 text-xs" data-testid="loupe-changes">
                {changes.slice(0, 8).map((line) => (
                  <li key={line}>· {line}</li>
                ))}
                {changes.length > 8 ? (
                  <li>· and {changes.length - 8} more</li>
                ) : null}
              </ul>
            ) : (
              <p className="text-xs text-ink-muted">
                Change a threshold, a Weight or the Policy. Every save is a new
                version; every Examination records the version it was decided
                under.
              </p>
            )}
            <input
              className={fieldClass}
              placeholder="Why (optional)"
              value={note}
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                disabled={changes.length === 0 || !valid.ok}
                pending={save.pending}
                pendingLabel="Saving…"
                onClick={() => save.run()}
                data-testid="loupe-save-rules"
              >
                Save as v{current.version + 1}
              </Button>
              <Button
                disabled={changes.length === 0}
                onClick={() => setDraft(current.rulebook)}
              >
                Undo edits
              </Button>
              <Button
                variant="ghost"
                onClick={() => setDraft(DEFAULT_RULEBOOK)}
                data-testid="loupe-defaults"
              >
                Defaults
              </Button>
            </div>
            {!valid.ok ? <ErrorNote>{valid.error}</ErrorNote> : null}
            {error ? <ErrorNote>{error}</ErrorNote> : null}
            {message ? (
              <output
                className="block text-sm font-medium"
                data-testid="loupe-saved"
              >
                {message}
              </output>
            ) : null}
          </div>
        </Panel>

        <Panel
          eyebrow="Calibration"
          title="This Rulebook on the Corpus, Sweep alone"
        >
          {calibration ? (
            <CalibrationTable
              draft={calibration.draft}
              saved={calibration.saved}
              edited={changes.length > 0}
            />
          ) : corpusError ? (
            <ErrorNote>{corpusError}</ErrorNote>
          ) : (
            <p className="text-sm text-ink-muted" aria-busy="true">
              Loading the Corpus…
            </p>
          )}
        </Panel>

        <Panel eyebrow="History" title="Versions" bodyClassName="p-0">
          <ul className="max-h-64 divide-y-2 divide-ink/10 overflow-y-auto text-xs">
            {versions.map((version) => (
              <li key={version.version} className="space-y-0.5 px-4 py-2">
                <p className="flex items-center gap-2 font-semibold">
                  v{version.version}
                  {version.version === 0 ? <Tag>Defaults</Tag> : null}
                  {version.version === current.version ? (
                    <Tag tone="green">current</Tag>
                  ) : null}
                  {version.version > 0 ? (
                    <span className="font-normal text-ink-muted">
                      {new Date(version.createdAt).toLocaleString()}
                    </span>
                  ) : null}
                </p>
                {version.note ? <p>{version.note}</p> : null}
                {version.changes.slice(0, 4).map((line) => (
                  <p key={line} className="text-ink-muted">
                    · {line}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  testId,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  testId?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block">{label}</span>
      <input
        type="number"
        className={cx(fieldClass, "max-w-32")}
        value={value}
        min={min}
        max={max}
        step={step}
        data-testid={testId}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
      />
    </label>
  );
}

function ListField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const [text, setText] = useState(value.join("\n"));
  const joined = value.join("\n");
  // biome-ignore lint/correctness/useExhaustiveDependencies: take the list when it changes from outside (undo, defaults).
  useEffect(() => {
    if (lines(text).join("\n") !== joined) setText(joined);
  }, [joined]);
  return (
    <label className="block text-sm">
      <span className="mb-1 block">{label}</span>
      <textarea
        className={cx(fieldClass, "h-28 py-2 font-mono text-xs")}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          onChange(lines(event.target.value));
        }}
      />
    </label>
  );
}

function RuleCard({
  metric,
  rulebook,
  saved,
  onChange,
}: {
  metric: MetricId;
  rulebook: Rulebook;
  saved: Rulebook;
  onChange: (patch: Parameters<typeof withRule>[2]) => void;
}) {
  const rule = rulebook.rules[metric];
  const text = RULE_TEXT[metric];
  const edited = JSON.stringify(rule) !== JSON.stringify(saved.rules[metric]);
  const fixed = text.min === text.max;
  return (
    <li
      className={cx("space-y-2 px-4 py-3", !rule.enabled && "opacity-60")}
      data-testid={`loupe-rule-${metric}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            className="size-4 accent-federal-blue"
            checked={rule.enabled}
            onChange={(event) => onChange({ enabled: event.target.checked })}
            aria-label={`${METRICS[metric].label}: on`}
          />
          {METRICS[metric].label}
          {edited ? <Tag tone="brass">edited</Tag> : null}
        </label>
        {fixed ? null : (
          <label className="flex items-center gap-1.5 font-mono text-xs">
            <span className="sr-only">Threshold</span>
            <input
              type="number"
              className={cx(fieldClass, "h-8 w-24 text-xs")}
              value={rule.threshold}
              min={text.min}
              max={text.max}
              step={text.step}
              data-testid={`loupe-threshold-${metric}`}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (Number.isFinite(next)) onChange({ threshold: next });
              }}
            />
            {METRICS[metric].unit}
          </label>
        )}
        <select
          className={cx(fieldClass, "h-8 w-32 text-xs")}
          value={rule.weight}
          aria-label={`${METRICS[metric].label}: Weight`}
          data-testid={`loupe-weight-${metric}`}
          onChange={(event) =>
            onChange({ weight: event.target.value as Weight })
          }
        >
          {WEIGHTS.map((weight) => (
            <option key={weight} value={weight}>
              {WEIGHT_LABELS[weight]}
            </option>
          ))}
        </select>
      </div>
      <p className="text-sm">{ruleSentence(metric, rule.threshold)}</p>
      <p className="text-xs text-ink-muted">{text.why}</p>
      <details className="text-xs">
        <summary className="cursor-pointer text-ink-muted">
          Applies to{" "}
          {rule.kinds.length
            ? rule.kinds.map((kind) => KIND_LABELS[kind]).join(", ")
            : "every Document kind"}
        </summary>
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
          {DOCUMENT_KINDS.map((kind: DocumentKind) => {
            const on = rule.kinds.length === 0 || rule.kinds.includes(kind);
            return (
              <label key={kind} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  className="accent-federal-blue"
                  checked={on}
                  onChange={(event) => {
                    const all = rule.kinds.length
                      ? rule.kinds
                      : [...DOCUMENT_KINDS];
                    const next = event.target.checked
                      ? [...new Set([...all, kind])]
                      : all.filter((item) => item !== kind);
                    onChange({
                      kinds: next.length === DOCUMENT_KINDS.length ? [] : next,
                    });
                  }}
                />
                {KIND_LABELS[kind]}
              </label>
            );
          })}
        </div>
      </details>
    </li>
  );
}

export function CalibrationTable({
  draft,
  saved,
  edited,
}: {
  draft: Calibration;
  saved?: Calibration;
  edited?: boolean;
}) {
  const all = overall(draft);
  const before = saved ? overall(saved) : null;
  return (
    <div className="space-y-3 text-sm" data-testid="loupe-calibration">
      <p>
        Flags{" "}
        <strong data-testid="loupe-fpr">
          {all.falsePositives} of {all.genuine}
        </strong>{" "}
        genuine documents ({percent(all.falsePositiveRate)} false positives) and
        detects{" "}
        <strong data-testid="loupe-detection">
          {all.detected} of {all.tampered}
        </strong>{" "}
        tampered ones ({percent(all.detectionRate)}).
        {edited && before ? (
          <span className="text-ink-muted">
            {" "}
            Saved Rulebook: {before.falsePositives} of {before.genuine} and{" "}
            {before.detected} of {before.tampered}.
          </span>
        ) : null}
      </p>
      <table className="w-full text-left font-mono text-xs">
        <thead>
          <tr className="border-ink border-b-2">
            <th className="py-1 font-bold">Split</th>
            <th className="py-1 font-bold">Detected</th>
            <th className="py-1 font-bold">False positives</th>
          </tr>
        </thead>
        <tbody>
          {draft.splits.map((row) => (
            <tr key={row.split} className="border-ink/10 border-b">
              <td className="py-1">
                {row.split}
                {row.split === "test" ? " (never tuned on)" : ""}
              </td>
              <td className="py-1">
                {row.detected}/{row.tampered} ({percent(row.detectionRate)})
              </td>
              <td className="py-1">
                {row.falsePositives}/{row.genuine} (
                {percent(row.falsePositiveRate)})
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {draft.missed.length ? (
        <details className="text-xs">
          <summary className="cursor-pointer">
            {draft.missed.length} tampered documents the Sweep misses
          </summary>
          <ul className="mt-1 space-y-0.5 text-ink-muted">
            {draft.missed.map((item) => (
              <li key={item.id}>
                {item.id}:{" "}
                {item.types.map((type) => TAMPER_TYPES[type]).join(", ")}
                {item.hard
                  ? " (an edit that keeps every number consistent; nothing to measure)"
                  : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {draft.falselyFlagged.length ? (
        <p className="text-xs text-seal-red">
          Genuine documents flagged:{" "}
          {draft.falselyFlagged.map((item) => item.id).join(", ")}
        </p>
      ) : null}
      <p className="text-xs text-ink-muted">
        {all.documents} synthetic documents; thresholds were tuned on train and
        validation only. A small sample: read the rates as a floor check, not a
        guarantee. No false positive here does not mean none on real paperwork.
      </p>
    </div>
  );
}
