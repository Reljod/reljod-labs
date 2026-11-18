"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import {
  applyRuleEdit,
  type ParameterValue,
  type RuleParams,
  ruleSentence,
  ruleSpec,
  sentenceParts,
} from "../../domain/rules";
import { restoreRule, saveRule } from "../../server/rule-actions";
import type { RuleView } from "../../view";
import { RULES_KEY, ruleVersionsKey, ruleVersionsQuery } from "../queries";
import { ParamInput } from "./param-input";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

type Draft = { enabled: boolean; params: RuleParams };

/**
 * One Rule as a sentence whose Parameters are edited in place. The edit is
 * checked with the same function the server runs before it can be saved;
 * saving makes the Rule's next Version.
 */
export function RuleCard({ rule }: { rule: RuleView }) {
  const spec = ruleSpec(rule.id);
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>({
    enabled: rule.state.enabled,
    params: rule.state.params,
  });
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [showVersions, setShowVersions] = useState(false);
  const busy = useRef(false);

  const checked = applyRuleEdit(spec, rule.state, draft);
  const errors = checked.ok ? [] : checked.errors;
  const dirty =
    checked.ok &&
    (checked.next.enabled !== rule.state.enabled ||
      JSON.stringify(checked.next.params) !==
        JSON.stringify(rule.state.params));

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: RULES_KEY }),
      queryClient.invalidateQueries({ queryKey: ruleVersionsKey(rule.id) }),
    ]);
  };

  const save = useMutation({
    mutationFn: () => saveRule(rule.id, draft),
    onSuccess: async (result) => {
      if (result.ok) {
        setNotice({ ok: true, text: `Saved as Version ${result.version}.` });
        await refresh();
      } else {
        setNotice({ ok: false, text: result.message });
      }
    },
    onError: () =>
      setNotice({ ok: false, text: "Could not save. Try again in a moment." }),
    onSettled: () => {
      busy.current = false;
    },
  });

  function submit() {
    if (busy.current || !dirty) return;
    busy.current = true;
    setNotice(null);
    save.mutate();
  }

  function change(name: string, value: ParameterValue) {
    setNotice(null);
    setDraft((current) => ({
      ...current,
      params: { ...current.params, [name]: value },
    }));
  }

  // A new Version (just saved or restored, or saved on another device and
  // refetched) becomes the draft.
  const [syncedVersion, setSyncedVersion] = useState(rule.state.version);
  if (syncedVersion !== rule.state.version) {
    setSyncedVersion(rule.state.version);
    setDraft({ enabled: rule.state.enabled, params: rule.state.params });
  }

  const prefetchVersions = () => {
    void queryClient.prefetchQuery(ruleVersionsQuery(rule.id));
  };

  const errorFor = (name: string | null) =>
    errors.find((error) => error.param === name);
  const pending = save.isPending;

  return (
    <article
      data-testid={`rule-${rule.id}`}
      data-enabled={rule.state.enabled}
      data-version={rule.state.version}
      className={`outline-box flex flex-col gap-3 rounded-sm p-4 ${
        draft.enabled ? "bg-paper" : "bg-limestone"
      }`}
    >
      <header className="flex flex-wrap items-center gap-2">
        <span className="eyebrow rounded-sm bg-morning-haze px-2 py-0.5">
          {spec.requirementId ? "Requirement" : "Every check"}
        </span>
        {rule.edited ? (
          <span
            data-testid="rule-edited"
            className="eyebrow rounded-sm bg-brass px-2 py-0.5 text-ink"
          >
            Edited · v{rule.state.version}
          </span>
        ) : (
          <span className="eyebrow rounded-sm border border-ink/40 px-2 py-0.5 text-ink-muted">
            Default{rule.state.version > 0 ? ` · v${rule.state.version}` : ""}
          </span>
        )}
        <label className="ml-auto inline-flex items-center gap-2 font-mono text-xs font-bold uppercase">
          <input
            type="checkbox"
            data-testid="rule-switch"
            checked={draft.enabled}
            disabled={!spec.optional || pending}
            onChange={(event) => {
              setNotice(null);
              setDraft((current) => ({
                ...current,
                enabled: event.target.checked,
              }));
            }}
            className="size-4 accent-ink"
          />
          {draft.enabled ? "On" : "Off"}
        </label>
      </header>

      <p className="text-base leading-relaxed">
        {sentenceParts(spec, draft.params).map((part, index) =>
          part.kind === "text" ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: parts never reorder
            <span key={index}>{part.text}</span>
          ) : (
            <ParamInput
              key={part.name}
              name={part.name}
              spec={spec.params[part.name]}
              value={draft.params[part.name]}
              invalid={Boolean(errorFor(part.name))}
              disabled={pending}
              onChange={(value) => change(part.name, value)}
            />
          ),
        )}
      </p>

      {errors.length > 0 ? (
        <ul
          role="alert"
          className="flex flex-col gap-1 font-mono text-xs text-seal-red"
        >
          {errors.map((error) => (
            <li key={`${error.param}-${error.message}`}>✕ {error.message}</li>
          ))}
        </ul>
      ) : null}

      <footer className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="rule-save"
          onClick={submit}
          disabled={!dirty || pending}
          aria-busy={pending}
          className="outline-box press min-h-9 rounded-sm bg-ink px-3 font-mono text-xs font-bold text-paper uppercase disabled:opacity-40"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {dirty || errors.length > 0 ? (
          <button
            type="button"
            onClick={() => {
              setNotice(null);
              setDraft({
                enabled: rule.state.enabled,
                params: rule.state.params,
              });
            }}
            disabled={pending}
            className="outline-box press min-h-9 rounded-sm bg-paper px-3 font-mono text-xs font-bold uppercase"
          >
            Discard
          </button>
        ) : null}
        <button
          type="button"
          data-testid="rule-versions-toggle"
          aria-expanded={showVersions}
          onClick={() => setShowVersions((open) => !open)}
          // Start reading the Versions on intent, so they are there on click.
          onPointerEnter={prefetchVersions}
          onFocus={prefetchVersions}
          className="outline-box press min-h-9 rounded-sm bg-paper px-3 font-mono text-xs font-bold uppercase"
        >
          Versions ({rule.versionCount + 1})
        </button>
        {notice ? (
          <output
            data-testid="rule-notice"
            className={`font-mono text-xs ${notice.ok ? "text-ivy" : "text-seal-red"}`}
          >
            {notice.ok ? "✓" : "✕"} {notice.text}
          </output>
        ) : null}
        <span className="ml-auto font-mono text-[11px] text-ink-muted">
          {spec.citation}
          {rule.savedBy && rule.savedAt
            ? ` · saved by ${rule.savedBy}, ${when(rule.savedAt)}`
            : ""}
        </span>
      </footer>

      {showVersions ? (
        <RuleVersions
          ruleId={rule.id}
          current={rule.state.version}
          onRestored={async (version) => {
            setNotice({ ok: true, text: `Restored as Version ${version}.` });
            await refresh();
          }}
        />
      ) : null}
    </article>
  );
}

/** A Rule's history, newest first, each one restorable as the next Version. */
function RuleVersions({
  ruleId,
  current,
  onRestored,
}: {
  ruleId: RuleView["id"];
  current: number;
  onRestored: (version: number) => Promise<void>;
}) {
  const spec = ruleSpec(ruleId);
  const versions = useQuery(ruleVersionsQuery(ruleId));
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const restore = useMutation({
    mutationFn: (version: number) => restoreRule(ruleId, version),
    onSuccess: async (result) => {
      if (result.ok) await onRestored(result.version);
      else setError(result.message);
    },
    onError: () => setError("Could not restore. Try again in a moment."),
    onSettled: () => {
      busy.current = false;
    },
  });

  if (versions.isPending) {
    return (
      <p className="font-mono text-xs text-ink-muted">Loading Versions…</p>
    );
  }
  if (versions.isError) {
    return (
      <p role="alert" className="font-mono text-xs text-seal-red">
        ✕ Could not load the Versions.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2 border-ink/20 border-t pt-3">
      <ol className="flex flex-col gap-2" data-testid="rule-versions">
        {versions.data.map((version) => {
          const inForce = version.version === current;
          return (
            <li
              key={version.version}
              data-testid={`rule-version-${version.version}`}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-xs"
            >
              <span className="w-10 font-bold">v{version.version}</span>
              <span className="min-w-0 flex-1 font-sans text-sm">
                {version.enabled ? "" : "(off) "}
                {ruleSentence(spec, version.params)}
              </span>
              <span className="text-ink-muted">
                {version.savedBy}
                {version.savedAt ? `, ${when(version.savedAt)}` : ""}
                {version.restoredFrom !== null
                  ? ` · restored v${version.restoredFrom}`
                  : ""}
              </span>
              {inForce ? (
                <span className="eyebrow rounded-sm bg-ivy px-2 py-0.5 text-paper">
                  In force
                </span>
              ) : (
                <button
                  type="button"
                  data-testid="rule-restore"
                  disabled={restore.isPending}
                  aria-busy={
                    restore.isPending && restore.variables === version.version
                  }
                  onClick={() => {
                    if (busy.current) return;
                    busy.current = true;
                    setError(null);
                    restore.mutate(version.version);
                  }}
                  className="outline-box press rounded-sm bg-paper px-2 py-1 font-bold uppercase disabled:opacity-40"
                >
                  {restore.isPending && restore.variables === version.version
                    ? "Restoring…"
                    : "Restore"}
                </button>
              )}
            </li>
          );
        })}
      </ol>
      {error ? (
        <p role="alert" className="font-mono text-xs text-seal-red">
          ✕ {error}
        </p>
      ) : null}
    </div>
  );
}
