"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRef, useState } from "react";
import { diffFindings, type FindingChange } from "../../domain/review";
import { OUTCOME_LABELS } from "../../domain/types";
import { reevaluateRun } from "../../server/actions";
import type { EvaluationView, RunView } from "../../view";
import { AUDIT_KEY, runKey } from "../queries";

const outcomeText = (outcome: FindingChange["from"]) =>
  outcome ? OUTCOME_LABELS[outcome] : "off";

function Changes({ changes }: { changes: FindingChange[] }) {
  if (changes.length === 0) {
    return (
      <p className="font-mono text-xs text-ink-muted">
        No Finding changed outcome.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-1" data-testid="evaluation-changes">
      {changes.map((change) => (
        <li key={change.requirementId} className="font-mono text-xs">
          <strong>{change.title}</strong>: {outcomeText(change.from)} →{" "}
          <strong>{outcomeText(change.to)}</strong>
        </li>
      ))}
    </ul>
  );
}

/**
 * The run's Evaluations: its own, then each re-evaluation with the Owner's
 * Rules at the time. Re-evaluating is pure code over the stored readings, so
 * it calls no model and costs nothing.
 */
export function EvaluationBar({
  view,
  selected,
  onSelect,
}: {
  view: RunView;
  selected: EvaluationView;
  onSelect: (number: number | null) => void;
}) {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<
    { ok: true; number: number } | { ok: false; text: string } | null
  >(null);
  const busy = useRef(false);
  const reevaluate = useMutation({
    mutationFn: () => reevaluateRun(view.id),
    onSuccess: async (result) => {
      if (result.ok) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: runKey(view.id) }),
          queryClient.invalidateQueries({ queryKey: [AUDIT_KEY] }),
        ]);
        onSelect(null);
        setNotice({ ok: true, number: result.number });
      } else {
        setNotice({ ok: false, text: result.message });
      }
    },
    onError: () =>
      setNotice({ ok: false, text: "Could not re-evaluate. Try again." }),
    onSettled: () => {
      busy.current = false;
    },
  });

  const index = view.evaluations.findIndex(
    (item) => item.number === selected.number,
  );
  const previous = index > 0 ? view.evaluations[index - 1] : null;
  const edited = selected.rules.filter((rule) => rule.version > 0).length;
  const canReevaluate = view.status === "completed";

  return (
    <section
      aria-label="Evaluations"
      data-testid="evaluation-bar"
      className="outline-box flex flex-col gap-3 rounded-sm bg-paper p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="eyebrow text-ink-muted">Evaluation</span>
        {view.evaluations.map((evaluation) => (
          <button
            key={evaluation.number}
            type="button"
            data-testid={`evaluation-${evaluation.number}`}
            aria-pressed={evaluation.number === selected.number}
            onClick={() =>
              onSelect(
                evaluation.number === view.evaluations.at(-1)?.number
                  ? null
                  : evaluation.number,
              )
            }
            className={`outline-box press rounded-sm px-2.5 py-1 font-mono text-xs font-bold ${
              evaluation.number === selected.number
                ? "bg-ink text-paper"
                : "bg-paper"
            }`}
          >
            #{evaluation.number}
            {evaluation.number === 1 ? " · run" : ""}
          </button>
        ))}
        {canReevaluate ? (
          <button
            type="button"
            data-testid="reevaluate"
            onClick={() => {
              if (busy.current) return;
              busy.current = true;
              setNotice(null);
              reevaluate.mutate();
            }}
            disabled={reevaluate.isPending}
            aria-busy={reevaluate.isPending}
            className="outline-box press ml-auto min-h-9 rounded-sm bg-federal-blue px-3 font-mono text-xs font-bold text-paper uppercase disabled:opacity-60"
          >
            {reevaluate.isPending
              ? "Re-evaluating…"
              : "↻ Re-evaluate with my Rules"}
          </button>
        ) : null}
      </div>

      <p className="font-mono text-xs text-ink-muted">
        {selected.number === 1
          ? "The run's own Evaluation"
          : `Re-evaluated by ${selected.createdBy ?? "someone"}, ${new Date(selected.createdAt).toLocaleString("en-GB")}`}
        {" · "}
        {edited === 0
          ? "every Rule at its Default"
          : `${edited} edited Rule${edited === 1 ? "" : "s"}`}
        {" · "}
        <Link
          href="/demos/document-compliance/rules"
          className="text-federal-blue underline"
        >
          Edit Rules
        </Link>
        {" · no model call, $0"}
      </p>

      {notice ? (
        notice.ok ? (
          <output
            data-testid="reevaluate-notice"
            className="font-mono text-xs text-ivy"
          >
            ✓ Saved as Evaluation {notice.number}.
          </output>
        ) : (
          <p
            role="alert"
            data-testid="reevaluate-notice"
            className="font-mono text-xs text-seal-red"
          >
            ✕ {notice.text}
          </p>
        )
      ) : null}

      {previous ? (
        <div className="flex flex-col gap-1 border-ink/20 border-t pt-2">
          <span className="eyebrow text-ink-muted">
            Against Evaluation {previous.number}
          </span>
          <Changes
            changes={diffFindings(previous.findings, selected.findings)}
          />
        </div>
      ) : null}
    </section>
  );
}
