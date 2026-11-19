"use client";

import { type ReactNode, useId, useState } from "react";
import type { CommandName, WriteOutcome } from "../../domain/commands";
import { formatMinor, formatMoney, parseMoney } from "../../domain/money";
import { Button, cx, Dialog, ErrorNote, Field, inputClass } from "../ui";
import { useCommand } from "../use-bank";
import { GateLine, OutcomeNote } from "./shared";

/** The one dialog every write of the Customer view goes through. */

/** What a money-moving write asks before it runs: the summary and the word to type. */
export type StepUp = { summary: ReactNode; word: string };

const matches = (typed: string, word: string) => {
  const wanted = parseMoney(word);
  if (wanted !== null) return parseMoney(typed) === wanted;
  return typed.trim().toLowerCase() === word.trim().toLowerCase();
};

export type Built = { name: CommandName; input: Record<string, unknown> };

/**
 * A dialog that sends one write. `build` turns the form into a command, or
 * returns the reason it cannot yet (shown inline). With `stepUp` the person
 * reads exactly what will happen and types the amount (or word) before the
 * confirm button enables. After the write it shows the Outcome where it was
 * clicked and a Done button.
 */
export function WriteDialog<Result = unknown>({
  title,
  onClose,
  children,
  build,
  submit,
  pendingLabel = "Sending…",
  danger = false,
  stepUp,
  gate = null,
  wide = false,
  onDone,
  after,
}: {
  title: string;
  onClose: () => void;
  children?: ReactNode;
  build: () => Built | string;
  submit: string;
  pendingLabel?: string;
  danger?: boolean;
  stepUp?: (built: Built) => StepUp;
  gate?: string | null;
  wide?: boolean;
  /** Called once with the Outcome when the write was accepted. */
  onDone?: (outcome: WriteOutcome<Result>) => void;
  /** Shown under the Outcome: a next step. */
  after?: (outcome: WriteOutcome<Result>) => ReactNode;
}) {
  const command = useCommand<Result>();
  const formId = useId();
  const typedId = useId();
  const [problem, setProblem] = useState<string | null>(null);
  const [review, setReview] = useState<{ built: Built; step: StepUp } | null>(
    null,
  );
  const [typed, setTyped] = useState("");

  const send = async (built: Built) => {
    const outcome = await command.run(built.name, built.input);
    if (outcome) onDone?.(outcome);
  };

  const onSubmit = () => {
    if (command.pending || command.outcome || gate) return;
    const built = build();
    if (typeof built === "string") {
      setProblem(built);
      return;
    }
    setProblem(null);
    if (stepUp) {
      setReview({ built, step: stepUp(built) });
      setTyped("");
      return;
    }
    void send(built);
  };

  const finished = command.outcome;
  const ready = review ? matches(typed, review.step.word) : true;

  return (
    <Dialog
      title={title}
      onClose={onClose}
      busy={command.pending}
      wide={wide}
      footer={
        finished ? (
          <Button
            variant="primary"
            onClick={onClose}
            data-testid="bank-write-done"
          >
            Done
          </Button>
        ) : (
          <>
            {review ? (
              <Button
                variant="ghost"
                onClick={() => setReview(null)}
                disabled={command.pending}
              >
                Back
              </Button>
            ) : (
              <Button
                variant="ghost"
                onClick={onClose}
                disabled={command.pending}
              >
                Cancel
              </Button>
            )}
            {review ? (
              <Button
                variant={danger ? "danger" : "primary"}
                pending={command.pending}
                pendingLabel={pendingLabel}
                disabled={!ready || Boolean(gate)}
                onClick={() => void send(review.built)}
                data-testid="bank-stepup-confirm"
              >
                Confirm
              </Button>
            ) : (
              <Button
                type="submit"
                form={formId}
                variant={danger ? "danger" : "primary"}
                pending={command.pending}
                pendingLabel={pendingLabel}
                disabled={Boolean(gate)}
                data-testid="bank-write-submit"
              >
                {stepUp ? "Review" : submit}
              </Button>
            )}
          </>
        )
      }
    >
      {finished ? (
        <div className="space-y-3">
          <OutcomeNote outcome={finished} error={null} />
          {after?.(finished)}
        </div>
      ) : review ? (
        <div className="space-y-3">
          <div className="outline-box rounded-sm bg-marble px-3 py-2">
            <p className="eyebrow text-[0.65rem] font-bold text-ink-muted">
              {submit}
            </p>
            <div className="mt-1">{review.step.summary}</div>
          </div>
          <Field
            label={`Type ${review.step.word} to confirm`}
            htmlFor={typedId}
            hint="Money moves only when what you type matches."
          >
            <input
              id={typedId}
              className={cx(inputClass, "font-mono")}
              autoComplete="off"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && ready && !gate)
                  void send(review.built);
              }}
              data-testid="bank-stepup-input"
            />
          </Field>
          <OutcomeNote outcome={null} error={command.error} />
        </div>
      ) : (
        <form
          id={formId}
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          {children}
          <GateLine reason={gate} />
          {problem ? <ErrorNote>{problem}</ErrorNote> : null}
          <OutcomeNote outcome={null} error={command.error} />
        </form>
      )}
    </Dialog>
  );
}

/** The step-up for a plain amount: names the move and asks for the amount typed. */
export const amountStepUp = (amount: number, sentence: ReactNode): StepUp => ({
  summary: (
    <div className="space-y-1">
      <p className="font-mono text-lg font-bold tabular-nums">
        {formatMoney(amount)}
      </p>
      <p>{sentence}</p>
    </div>
  ),
  word: formatMinor(amount),
});
