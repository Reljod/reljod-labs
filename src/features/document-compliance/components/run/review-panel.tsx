"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import { LIMITS } from "../../domain/limits";
import {
  type ReviewOutcome,
  type ReviewView,
  reviewVerb,
} from "../../domain/review";
import { OUTCOME_LABELS } from "../../domain/types";
import type { FindingView } from "../../view";
import { reviewFinding } from "../api";
import { AUDIT_KEY, runKey } from "../queries";

/**
 * A Reviewer's decision on one flagged Finding: what stands now, and (on the
 * latest Evaluation) a form to confirm or override it with a note.
 */
export function ReviewPanel({
  runId,
  finding,
  review,
  evaluation,
  editable,
}: {
  runId: string;
  finding: FindingView;
  /** The newest decision on this Requirement, from any Evaluation. */
  review: ReviewView | null;
  evaluation: number;
  /** Only the latest Evaluation of a finished run takes new decisions. */
  editable: boolean;
}) {
  const queryClient = useQueryClient();
  const noteId = useId();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<ReviewOutcome | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const save = useMutation({
    mutationFn: () =>
      reviewFinding(runId, {
        requirementId: finding.requirementId,
        evaluation,
        outcome,
        note,
      }),
    onSuccess: async (result) => {
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: runKey(runId) }),
        queryClient.invalidateQueries({ queryKey: [AUDIT_KEY] }),
      ]);
      setOpen(false);
      setNote("");
      setOutcome(null);
    },
    onError: () => setError("Could not save the decision. Try again."),
    onSettled: () => {
      busy.current = false;
    },
  });

  const stale = review && review.evaluation !== evaluation;
  const trimmed = note.trim();
  const ready =
    outcome !== null &&
    trimmed.length >= LIMITS.noteMinLength &&
    trimmed.length <= LIMITS.noteMaxLength;

  return (
    <div
      data-testid={`review-${finding.requirementId}`}
      className="flex flex-col gap-2 border-ink/15 border-t px-3 pt-2 pb-3"
    >
      {review ? (
        <p
          data-testid="review-decision"
          data-outcome={review.outcome}
          className="font-mono text-xs"
        >
          <span
            className={`mr-1.5 rounded-sm px-1.5 py-0.5 font-bold ${
              review.outcome === "pass"
                ? "bg-ivy text-paper"
                : "bg-seal-red text-paper"
            }`}
          >
            {reviewVerb(review)} · {OUTCOME_LABELS[review.outcome]}
          </span>
          {review.reviewer}, {new Date(review.at).toLocaleString("en-GB")}
          {stale ? (
            <span className="ml-1.5 rounded-sm bg-brass px-1 text-ink">
              on Evaluation {review.evaluation} (
              {OUTCOME_LABELS[review.findingOutcome]})
            </span>
          ) : null}
          <span className="mt-1 block font-sans text-sm">“{review.note}”</span>
        </p>
      ) : (
        <p className="font-mono text-xs text-ink-muted">
          Waiting for a Reviewer.
        </p>
      )}

      {editable && !open ? (
        <button
          type="button"
          data-testid="review-open"
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
          className="outline-box press self-start rounded-sm bg-paper px-2.5 py-1 font-mono text-xs font-bold uppercase"
        >
          {review ? "Change decision" : "Review"}
        </button>
      ) : null}

      {editable && open ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy.current || !ready) return;
            busy.current = true;
            setError(null);
            save.mutate();
          }}
        >
          <fieldset className="flex flex-wrap items-center gap-2">
            <legend className="sr-only">Settle this Finding as</legend>
            {(["pass", "fail"] as const).map((value) => (
              <label
                key={value}
                className={`outline-box cursor-pointer rounded-sm px-2.5 py-1 font-mono text-xs font-bold uppercase ${
                  outcome === value
                    ? value === "pass"
                      ? "bg-ivy text-paper"
                      : "bg-seal-red text-paper"
                    : "bg-paper"
                }`}
              >
                <input
                  type="radio"
                  name={`${noteId}-outcome`}
                  value={value}
                  data-testid={`review-outcome-${value}`}
                  checked={outcome === value}
                  disabled={save.isPending}
                  onChange={() => setOutcome(value)}
                  className="sr-only"
                />
                {finding.outcome === value ? "Confirm " : "Settle as "}
                {OUTCOME_LABELS[value]}
              </label>
            ))}
          </fieldset>
          <label htmlFor={noteId} className="sr-only">
            Why
          </label>
          <textarea
            id={noteId}
            data-testid="review-note"
            value={note}
            disabled={save.isPending}
            maxLength={LIMITS.noteMaxLength}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Why? (required, kept in the Audit trail)"
            rows={2}
            className="rounded-sm border-2 border-ink bg-paper px-2 py-1 text-sm"
          />
          <span className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              data-testid="review-save"
              disabled={!ready || save.isPending}
              aria-busy={save.isPending}
              className="outline-box press rounded-sm bg-ink px-3 py-1.5 font-mono text-xs font-bold text-paper uppercase disabled:opacity-40"
            >
              {save.isPending ? "Saving…" : "Save decision"}
            </button>
            <button
              type="button"
              disabled={save.isPending}
              onClick={() => setOpen(false)}
              className="outline-box press rounded-sm bg-paper px-3 py-1.5 font-mono text-xs font-bold uppercase"
            >
              Cancel
            </button>
            {error ? (
              <span role="alert" className="font-mono text-xs text-seal-red">
                ✕ {error}
              </span>
            ) : null}
          </span>
        </form>
      ) : null}
    </div>
  );
}
