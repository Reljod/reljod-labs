"use client";

import { motion } from "motion/react";
import { useState } from "react";
import type { PrismAnswer, RefractResponse } from "../domain/api";
import {
  DECISION_MODELS,
  type DecisionModelId,
  MODEL_BY_ID,
} from "../domain/models";
import {
  buildSdkSnippet,
  draftsToQuestionMap,
  LAB_PRESETS,
  type LabQuestionDraft,
} from "../domain/questions";
import { formatMicroUsd, shannonEntropy } from "../domain/routing";
import { refractSlip } from "./api";

/**
 * Tab 4: Custom Decision Rubric Lab.
 * Build your own typed boolean / choice / score questions, test any November
 * 2026 Decision Model live, and copy the exact AI SDK 7 `experimental_decide`
 * TypeScript code.
 */
export function LabView({
  modelId,
  onModelChange,
}: {
  modelId: DecisionModelId;
  onModelChange: (id: DecisionModelId) => void;
}) {
  const [presetId, setPresetId] = useState(LAB_PRESETS[0].id);
  const [text, setText] = useState(LAB_PRESETS[0].sampleText);
  const [drafts, setDrafts] = useState<LabQuestionDraft[]>([
    ...LAB_PRESETS[0].questions,
  ]);
  const [result, setResult] = useState<RefractResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadPreset = (id: string) => {
    const preset = LAB_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setPresetId(preset.id);
    setText(preset.sampleText);
    setDrafts([...preset.questions]);
    setResult(null);
    setError(null);
  };

  const questionsMap = draftsToQuestionMap(drafts);
  const snippet = buildSdkSnippet(modelId, text, questionsMap);

  const runCustom = async () => {
    if (!text.trim() || Object.keys(questionsMap).length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await refractSlip({
        modelId,
        state: text.trim(),
        questions: questionsMap,
      });
      setResult(res);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not run custom slate.",
      );
    } finally {
      setBusy(false);
    }
  };

  const copySnippet = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard unavailable.
    }
  };

  return (
    <div className="space-y-5">
      {/* Preset Switcher + Run Controls */}
      <div className="outline-box rounded-sm bg-paper p-4 shadow-hard-md">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="eyebrow font-bold text-federal-blue">
              Custom Decision Engine Lab
            </p>
            <h2 className="mt-0.5 font-mono text-lg font-bold uppercase text-ink">
              Test Any Rubric With AI SDK 7 experimental_decide()
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Lab Decision Model"
              value={modelId}
              disabled={busy}
              onChange={(e) => onModelChange(e.target.value as DecisionModelId)}
              className="rounded-sm border-2 border-ink bg-marble px-2.5 py-1.5 font-mono text-xs font-bold text-ink"
            >
              {DECISION_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy || !text.trim()}
              aria-busy={busy}
              onClick={() => void runCustom()}
              className="outline-box press rounded-sm bg-ink px-4 py-1.5 font-mono text-xs font-bold tracking-[0.08em] text-paper uppercase disabled:opacity-60"
            >
              {busy ? "Evaluating…" : "Run Custom Slate ↵"}
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {LAB_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => loadPreset(p.id)}
              className={`rounded-sm border-2 border-ink px-2.5 py-1 font-mono text-xs font-bold ${
                presetId === p.id
                  ? "bg-brass text-ink shadow-hard-sm"
                  : "bg-marble text-ink hover:bg-paper"
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>

        <textarea
          rows={3}
          aria-label="Custom input state"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="mt-3 w-full rounded-sm border-2 border-ink bg-marble/60 p-3 text-sm text-ink focus:bg-paper focus:outline-2 focus:outline-federal-blue"
        />

        {error && (
          <p
            role="alert"
            className="mt-2 rounded-sm border-2 border-seal-red bg-seal-red/10 px-2.5 py-1.5 font-mono text-xs font-semibold text-seal-red"
          >
            {error}
          </p>
        )}
      </div>

      {/* Main Split: Editable Questions & Live Results vs Generated AI SDK 7 Code */}
      <div className="grid gap-5 lg:grid-cols-[1.15fr_1fr]">
        <div className="space-y-4">
          {drafts.map((q, idx) => {
            const answer = result?.answers[q.id];
            return (
              <div
                key={q.id}
                className="outline-box rounded-sm bg-paper p-4 shadow-hard-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="rounded-xs bg-ink px-1.5 py-0.5 font-mono text-[10px] font-bold text-brass uppercase">
                      {q.type}
                    </span>
                    <span className="font-mono text-xs font-bold text-ink">
                      {q.label}
                    </span>
                    <span className="font-mono text-[11px] text-ink-muted">
                      ({q.id})
                    </span>
                  </div>
                </div>

                <input
                  type="text"
                  aria-label={`Instructions for ${q.label}`}
                  value={q.instructions}
                  onChange={(e) => {
                    const next = [...drafts];
                    next[idx] = { ...q, instructions: e.target.value };
                    setDrafts(next);
                  }}
                  className="mt-2 w-full rounded-sm border border-ink/40 bg-marble/60 px-2.5 py-1.5 text-xs text-ink focus:bg-paper focus:outline-2 focus:outline-federal-blue"
                />

                {answer && <CustomAnswerViz answer={answer} />}
              </div>
            );
          })}
        </div>

        {/* Copyable AI SDK 7 Code Panel + Telemetry */}
        <div className="outline-box flex flex-col justify-between rounded-sm bg-ink p-4 text-paper shadow-hard-md">
          <div>
            <div className="flex items-center justify-between gap-2 border-paper/20 border-b pb-2.5">
              <div>
                <p className="eyebrow font-bold text-brass">
                  AI SDK 7 · Vercel AI Gateway
                </p>
                <p className="font-mono text-[11px] text-paper/75">
                  {MODEL_BY_ID[modelId].name} · {MODEL_BY_ID[modelId].released}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void copySnippet()}
                className="rounded-sm border border-paper/40 bg-paper/10 px-2.5 py-1 font-mono text-[11px] font-bold text-paper hover:bg-brass hover:text-ink"
              >
                {copied ? "Copied ✓" : "Copy TS"}
              </button>
            </div>

            <pre className="mt-3 max-h-[420px] overflow-auto rounded-sm bg-black/30 p-3 font-mono text-[11px] leading-relaxed text-paper/90">
              <code>{snippet}</code>
            </pre>
          </div>

          {result && (
            <div className="mt-4 grid grid-cols-3 gap-2 rounded-sm border border-paper/20 bg-paper/10 p-2.5 font-mono text-[11px]">
              <div>
                <div className="text-[10px] text-paper/65 uppercase">
                  Latency
                </div>
                <div className="font-bold text-brass tabular-nums">
                  {result.latencyMs} ms
                </div>
              </div>
              <div>
                <div className="text-[10px] text-paper/65 uppercase">
                  Output Tok
                </div>
                <div className="font-bold text-paper tabular-nums">
                  {result.outputTokens}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-paper/65 uppercase">Cost</div>
                <div className="font-bold text-clear-sky tabular-nums">
                  {formatMicroUsd(result.costUsd)}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CustomAnswerViz({ answer }: { answer: PrismAnswer }) {
  if (answer.type === "boolean") {
    const pct = Math.round(answer.probability * 100);
    return (
      <div className="mt-3 space-y-1">
        <div className="flex justify-between font-mono text-xs font-bold">
          <span>P(true)</span>
          <span className="tabular-nums">{pct}%</span>
        </div>
        <div className="h-3.5 w-full overflow-hidden rounded-xs border-2 border-ink bg-marble">
          <motion.div
            className="h-full bg-federal-blue"
            initial={{ width: 0 }}
            animate={{ width: `${Math.max(2, pct)}%` }}
            transition={{ type: "spring", stiffness: 180, damping: 20 }}
          />
        </div>
      </div>
    );
  }

  if (answer.type === "choice") {
    const entries = Object.entries(
      answer.probabilities ?? { [answer.choice]: 1 },
    ).sort((a, b) => b[1] - a[1]);
    const h = shannonEntropy(answer.probabilities);
    return (
      <div className="mt-3 space-y-1.5">
        <div className="flex justify-between font-mono text-[11px] text-ink-muted">
          <span>
            Selected: <strong className="text-ink">{answer.choice}</strong>
          </span>
          <span>H = {h.toFixed(2)}</span>
        </div>
        {entries.map(([key, p]) => {
          const pct = Math.round(p * 1000) / 10;
          return (
            <div
              key={key}
              className="flex items-center gap-2 font-mono text-[11px]"
            >
              <span className="w-28 truncate font-bold text-ink">{key}</span>
              <div className="h-3 flex-1 overflow-hidden rounded-xs border border-ink bg-marble">
                <motion.div
                  className={`h-full ${key === answer.choice ? "bg-ivy" : "bg-clear-sky"}`}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.max(2, pct)}%` }}
                  transition={{ type: "spring", stiffness: 180, damping: 20 }}
                />
              </div>
              <span className="w-11 text-right font-bold tabular-nums">
                {pct.toFixed(1)}%
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  const entries = Object.entries(answer.probabilities ?? {}).sort(
    (a, b) => Number(a[0]) - Number(b[0]),
  );
  return (
    <div className="mt-3 space-y-2">
      <div className="flex justify-between font-mono text-xs font-bold">
        <span>Expected Score</span>
        <span className="rounded-xs bg-brass px-1.5 py-0.5 tabular-nums">
          {answer.score.toFixed(2)}
        </span>
      </div>
      {entries.length > 0 && (
        <div
          className="grid h-16 items-end gap-1.5"
          style={{
            gridTemplateColumns: `repeat(${entries.length}, minmax(0, 1fr))`,
          }}
        >
          {entries.map(([lvl, p]) => (
            <div
              key={lvl}
              className="flex h-full flex-col items-center justify-end gap-0.5"
            >
              <span className="font-mono text-[9px] tabular-nums text-ink-muted">
                {Math.round(p * 100)}%
              </span>
              <motion.div
                className="w-full rounded-t-xs border border-ink bg-brass"
                initial={{ height: 0 }}
                animate={{ height: `${Math.max(8, Math.round(p * 100))}%` }}
                transition={{ type: "spring", stiffness: 180, damping: 20 }}
              />
              <span className="font-mono text-[9px] font-bold">L{lvl}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
