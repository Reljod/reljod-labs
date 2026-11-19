"use client";

import { useState } from "react";
import type { ConfirmationView } from "../../domain/views";
import { Badge, Button, ErrorNote, inputClass } from "../ui";
import { useCommand } from "../use-bank";

/** Commands that move money: confirming one asks the person to type a word first. */
const STEP_UP = new Set([
  "transfer",
  "pay_payee",
  "create_standing_order",
  "open_term_deposit",
  "repay_loan",
  "accept_loan",
  "reverse_payment",
]);

const WORD = "CONFIRM";

/**
 * A sensitive write the Teller (or an MCP client) asked for. It is not done
 * until the person clicks here: the model proposed, the person decides.
 */
export function ConfirmationCard({
  confirmation,
  onDecided,
}: {
  confirmation: ConfirmationView;
  onDecided?: () => void;
}) {
  const decide = useCommand<{ status?: string }>();
  const [typed, setTyped] = useState("");
  const pending = confirmation.status === "pending" && !decide.outcome;
  const stepUp = STEP_UP.has(confirmation.command);
  const settle = async (decision: "confirm" | "decline") => {
    await decide.run("confirm_request", {
      confirmationId: confirmation.id,
      decision,
    });
    onDecided?.();
  };
  const result = decide.outcome?.message ?? confirmation.resultMessage;
  const status = decide.outcome
    ? ((decide.outcome.status === "done"
        ? decide.outcome.result?.status
        : undefined) ?? "confirmed")
    : confirmation.status;

  return (
    <div
      data-testid="bank-confirmation"
      data-status={status}
      className="outline-box rounded-sm bg-paper p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="eyebrow">
          {pending ? "Needs your confirmation" : "Your decision"}
        </p>
        <Badge
          tone={
            pending ? "amber" : status === "confirmed" ? "green" : "neutral"
          }
          dot={pending}
        >
          {pending ? "Waiting for you" : status}
        </Badge>
      </div>
      <p className="mt-2 font-semibold text-sm">{confirmation.summary}</p>
      <p className="mt-1 text-ink/70 text-xs">
        {confirmation.commandTitle}, asked by{" "}
        {confirmation.requestedVia === "mcp" ? "an MCP client" : "the Teller"}.
        {pending ? " The Teller cannot confirm this. Only you can." : ""}
      </p>
      {pending ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          {stepUp ? (
            <label className="text-xs">
              <span className="eyebrow block">Type {WORD} to move money</span>
              <input
                data-testid="bank-confirmation-stepup"
                className={`${inputClass} mt-1 w-36`}
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                autoComplete="off"
              />
            </label>
          ) : null}
          <Button
            data-testid="bank-confirmation-confirm"
            disabled={
              decide.pending || (stepUp && typed.trim().toUpperCase() !== WORD)
            }
            aria-busy={decide.pending}
            onClick={() => settle("confirm")}
          >
            {decide.pending ? "Working…" : "Confirm"}
          </Button>
          <Button
            data-testid="bank-confirmation-decline"
            variant="secondary"
            disabled={decide.pending}
            onClick={() => settle("decline")}
          >
            Decline
          </Button>
        </div>
      ) : null}
      {result ? (
        <p data-testid="bank-confirmation-result" className="mt-2 text-sm">
          {result}
        </p>
      ) : null}
      {decide.error ? (
        <ErrorNote className="mt-2">{decide.error}</ErrorNote>
      ) : null}
    </div>
  );
}
