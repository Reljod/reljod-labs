"use client";

import { type ReactNode, useId, useState } from "react";
import type { CommandName, WriteOutcome } from "../../domain/commands";
import { formatDate } from "../../domain/dates";
import { formatMinor, formatMoney, parseMoney } from "../../domain/money";
import { type Action, can, rolesFor } from "../../domain/permissions";
import { ROLE_LABEL } from "../../domain/staff";
import { Button, cx, Dialog, DoneNote, ErrorNote, Field, inputClass } from "../ui";
import { useBank, useCommand } from "../use-bank";

/** Pieces every section of the Customer view shares. */

export const selectClass = cx(inputClass, "h-9 py-0");

/**
 * Why the active Staff member may not do `action`, or null when they may.
 * The control stays visible and disabled with this line, so a visitor learns
 * the bank's controls. The server checks it again.
 */
export function useGate(action: Action): string | null {
  const { activeStaff } = useBank();
  if (can(activeStaff, action)) return null;
  const roles = rolesFor(action).map((role) => ROLE_LABEL[role].toLowerCase());
  const who = roles.length > 1 ? `${roles.slice(0, -1).join(", ")} or ${roles.at(-1)}` : roles[0];
  return `Needs a ${who}. Switch Staff.`;
}

export function GateLine({ reason, className = "" }: { reason: string | null; className?: string }) {
  if (!reason) return null;
  return <p className={cx("text-xs text-ink-muted", className)}>{reason}</p>;
}

/** An amount, right-aligned and tabular. `sign` shows + for money in. */
export function Money({
  minor,
  className = "",
  sign = false,
}: {
  minor: number;
  className?: string;
  sign?: boolean;
}) {
  return (
    <span className={cx("font-mono tabular-nums whitespace-nowrap", className)}>
      {sign && minor > 0 ? "+" : ""}
      {formatMinor(minor)}
    </span>
  );
}

/** The headline of a write's Outcome: what happened, in a few words. */
function headlineOf(outcome: WriteOutcome<unknown>): { text: string; tone: "done" | "wait" | "bad" } {
  if (outcome.status === "needs_approval") return { text: "Waiting for an Approval", tone: "wait" };
  if (outcome.status === "needs_confirmation") return { text: "Waiting for a Confirmation", tone: "wait" };
  const result = outcome.result as { status?: string; settlesOn?: string } | null;
  switch (result?.status) {
    case "held":
      return { text: "Held for review", tone: "wait" };
    case "clearing":
      return {
        text: result.settlesOn ? `In clearing until ${formatDate(result.settlesOn)}` : "In clearing",
        tone: "wait",
      };
    case "declined":
      return { text: "Declined", tone: "bad" };
    case "offered":
      return { text: "Offered", tone: "done" };
    default:
      return { text: "Done", tone: "done" };
  }
}

/**
 * What a write answered, where it was clicked: done, in clearing until a
 * date, held for review, waiting for an Approval, or the refusal.
 */
export function OutcomeNote({
  outcome,
  error,
  className = "",
}: {
  outcome: WriteOutcome<unknown> | null;
  error: string | null;
  className?: string;
}) {
  if (error) return <ErrorNote className={className}>{error}</ErrorNote>;
  if (!outcome) return null;
  const { text, tone } = headlineOf(outcome);
  if (tone === "done" && outcome.status === "done") {
    return (
      <DoneNote className={className}>
        <span data-testid="bank-write-outcome">{outcome.message}</span>
      </DoneNote>
    );
  }
  return (
    <div
      aria-live="polite"
      data-testid="bank-write-outcome"
      className={cx(
        "outline-box rounded-sm px-3 py-2 text-sm",
        tone === "bad" ? "border-seal-red bg-paper text-seal-red" : "bg-brass/20 text-ink",
        className,
      )}
    >
      <p className="eyebrow text-[0.65rem] font-bold">{text}</p>
      <p className="mt-1">{outcome.message}</p>
      {outcome.status === "needs_approval" ? (
        <p className="mt-1 text-xs text-ink-muted">
          A supervisor who did not make the request decides it in Operations.
        </p>
      ) : null}
    </div>
  );
}

/** A money input with its parse error shown inline. */
export function MoneyField({
  id,
  label,
  value,
  onChange,
  hint,
  error,
  testId,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: ReactNode;
  /** An error from outside (a Rule, a limit); a parse error wins. */
  error?: string | null;
  testId?: string;
}) {
  const parsed = value.trim() ? parseMoney(value) : null;
  const parseError = value.trim() && parsed === null ? "Type an amount like 1,250.00" : null;
  return (
    <Field label={`${label} (MRF)`} htmlFor={id} hint={hint} error={parseError ?? error ?? undefined}>
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        className={cx(inputClass, "text-right font-mono tabular-nums")}
        value={value}
        placeholder="0.00"
        aria-invalid={Boolean(parseError ?? error) || undefined}
        onChange={(event) => onChange(event.target.value)}
        data-testid={testId}
      />
    </Field>
  );
}

/** A positive amount in minor units from what was typed, or null. */
export const amountOf = (text: string) => {
  const value = parseMoney(text);
  return value && value > 0 ? value : null;
};

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
  const [review, setReview] = useState<{ built: Built; step: StepUp } | null>(null);
  const [typed, setTyped] = useState("");

  const send = async (built: Built) => {
    const outcome = await command.run(built.name, built.input);
    if (outcome) onDone?.(outcome);
  };

  const onSubmit = () => {
    if (command.pending || command.outcome) return;
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
          <Button variant="primary" onClick={onClose} data-testid="bank-write-done">
            Done
          </Button>
        ) : (
          <>
            {review ? (
              <Button variant="ghost" onClick={() => setReview(null)} disabled={command.pending}>
                Back
              </Button>
            ) : (
              <Button variant="ghost" onClick={onClose} disabled={command.pending}>
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
            <p className="eyebrow text-[0.65rem] font-bold text-ink-muted">{submit}</p>
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
                if (event.key === "Enter" && ready && !gate) void send(review.built);
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
      <p className="font-mono text-lg font-bold tabular-nums">{formatMoney(amount)}</p>
      <p>{sentence}</p>
    </div>
  ),
  word: formatMinor(amount),
});

/** Saves bytes or text as a file through a temporary object URL. */
export function saveFile(data: BlobPart, fileName: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** A skeleton shaped like a row of cards, with a status for screen readers. */
export function CardsSkeleton({ count = 3, label }: { count?: number; label: string }) {
  return (
    <div aria-busy="true" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <span className="sr-only" aria-live="polite">
        {label}
      </span>
      {Array.from({ length: count }, (_, index) => `card-${index}`).map((key) => (
        <div key={key} className="hx-shimmer h-36 rounded-sm border-2 border-ink/20" />
      ))}
    </div>
  );
}

/** A label above a value, as the account cards and the loan figures show them. */
export function Figure({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("min-w-0", className)}>
      <p className="eyebrow text-[0.6rem] font-bold text-ink-muted">{label}</p>
      <div className="mt-0.5 text-sm">{children}</div>
    </div>
  );
}
