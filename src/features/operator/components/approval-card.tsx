"use client";

import { useEffect, useRef, useState } from "react";
import type { PendingApproval } from "../domain/contract";
import { ACTION_TITLES, type Rulebook, ruleInfo } from "../domain/rules";
import { SCREEN_TITLES } from "../legacy/types";
import { api } from "./api";
import { clock } from "./format";
import { Button, ErrorNote, friendly, Tag, useNow, useWrite } from "./ui";

/**
 * A guarded key the harness stopped before HARBOURMASTER took it. A person
 * approves or refuses; one decision is sent, once. The card takes focus when
 * it appears (the card, not a button, so a stray Enter decides nothing).
 */
export function ApprovalCard({
  runId,
  pending,
  rulebook,
}: {
  runId: string;
  pending: PendingApproval;
  rulebook: Rulebook | null;
}) {
  const card = useRef<HTMLDivElement>(null);
  const now = useNow(true);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<"approved" | "refused" | null>(null);
  const write = useWrite(async (decision: "approved" | "refused") => {
    setError(null);
    try {
      await api.decide(runId, pending.approvalId, decision);
      setSent(decision);
    } catch (caught) {
      setError(friendly(caught, "The decision did not go through."));
    }
  });

  useEffect(() => {
    card.current?.focus({ preventScroll: false });
  }, []);

  const rule = ruleInfo("actions.guarded");
  const left = pending.expiresAt - now;
  const locked = write.pending || sent !== null;
  return (
    <div
      ref={card}
      tabIndex={-1}
      role="alertdialog"
      aria-labelledby={`approval-${pending.approvalId}`}
      aria-describedby={`approval-${pending.approvalId}-why`}
      className="op-stamp outline-box w-full max-w-md rounded-sm bg-paper text-ink shadow-hard-lg focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-brass"
    >
      <p className="eyebrow flex items-center justify-between gap-2 border-ink border-b-2 bg-seal-red px-3 py-1.5 text-[0.65rem] font-bold text-paper">
        <span>The Guard stopped this key</span>
        <span className="tabular-nums" aria-hidden={now === 0}>
          {now === 0 ? "" : left > 0 ? clock(left) : "0:00"}
        </span>
      </p>
      <div className="flex flex-col gap-3 p-4">
        <h3
          id={`approval-${pending.approvalId}`}
          className="text-base leading-snug font-semibold"
        >
          {pending.label}
        </h3>
        {/* An Approval covers exactly these values (the Guard's fingerprint). */}
        {pending.change.op !== "delete" ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-xs">
            {(pending.change.op === "update"
              ? (pending.change.fields ?? [])
              : Object.keys(pending.change.after ?? {})
            ).map((field) => (
              <div key={field} className="contents">
                <dt className="text-ink-muted">{field}</dt>
                <dd>
                  {pending.change.op === "update"
                    ? `${String(pending.change.before?.[field] ?? "")} → `
                    : ""}
                  <strong>{String(pending.change.after?.[field] ?? "")}</strong>
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        <p id={`approval-${pending.approvalId}-why`} className="text-sm">
          The Operator pressed{" "}
          <kbd className="font-mono font-bold">{pending.key}</kbd> on{" "}
          {pending.screen} ({SCREEN_TITLES[pending.screen]}). The key has not
          reached HARBOURMASTER. Code stopped it, not the model, because a Rule
          says this Action waits for a person.
        </p>
        <div className="rounded-sm border-2 border-ink/15 bg-marble px-3 py-2 text-xs">
          <p className="flex flex-wrap items-center gap-1.5">
            <Tag tone="red">{rule.id}</Tag>
            <span className="font-semibold">{rule.title}</span>
          </p>
          <p className="mt-1 text-ink-muted">
            {rulebook
              ? rule.sentence(rulebook)
              : `${ACTION_TITLES[pending.actionKind]} waits for a person.`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            disabled={locked}
            pending={write.pending}
            pendingLabel="Sending…"
            onClick={() => void write.run("approved")}
          >
            Approve
          </Button>
          <Button
            variant="danger"
            disabled={locked}
            onClick={() => void write.run("refused")}
          >
            Refuse
          </Button>
        </div>
        <output aria-live="polite" className="block text-xs text-ink-muted">
          {sent
            ? `${sent === "approved" ? "Approved" : "Refused"}. The Run carries on in a moment.`
            : now !== 0 && left <= 0
              ? "Time is up. The harness refuses the key on its own."
              : "If nobody decides in time, the harness refuses the key on its own."}
        </output>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
      </div>
    </div>
  );
}
