"use client";

import { useId, useState } from "react";
import type { ApprovalDecision, ApprovalView, RunView } from "../../domain/run";
import type { Staff } from "../../domain/staff";
import {
  Badge,
  Button,
  ConfirmDialog,
  ErrorNote,
  Field,
  inputClass,
  Markdown,
  useWrite,
} from "../ui";
import { approvalGate } from "./approval-gating";

const DRAFT_LABEL: Record<string, string> = {
  letter: "Letter",
  payment_instruction: "Payment instruction",
  transfer_instruction: "Transfer instruction",
  employer_query: "Employer query",
  regulator_report: "Report to the regulator",
};

export const draftLabel = (kind: string) =>
  DRAFT_LABEL[kind] ??
  kind.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/**
 * The point where a Run waits for a person: the Draft, how risky it is and
 * the two ways out. What the server refuses, the buttons refuse first, and
 * say why. A high-risk decision asks first.
 */
export function ApprovalPanel({
  run,
  approval,
  staff,
  decide,
}: {
  run: RunView;
  approval: ApprovalView;
  staff: Pick<Staff, "id" | "role" | "name">;
  /** Sends the decision; throws a message to show. */
  decide: (
    approval: ApprovalView,
    decision: ApprovalDecision,
    note: string,
  ) => Promise<unknown>;
}) {
  const noteId = useId();
  const reasonId = useId();
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState<ApprovalDecision | null>(null);
  const [pendingDecision, setPendingDecision] =
    useState<ApprovalDecision | null>(null);
  const gate = approvalGate(staff, run, approval);
  const draft = approval.draft;

  const write = useWrite(async (decision: ApprovalDecision) => {
    setPendingDecision(decision);
    try {
      return await decide(approval, decision, note);
    } finally {
      setPendingDecision(null);
    }
  });

  const press = (decision: ApprovalDecision) => {
    if (gate.confirm) setAsking(decision);
    else void write.run(decision);
  };

  return (
    <section
      aria-label="Approval needed"
      className="rounded-sm border border-oak/60 bg-brass/10"
    >
      <header className="flex flex-wrap items-center gap-2 border-oak/30 border-b px-4 py-2.5">
        <h3 className="min-w-0 flex-1 text-sm font-semibold">
          Approval needed: {approval.title}
        </h3>
        <Badge tone={gate.risk === "high" ? "red" : "neutral"}>
          {gate.risk === "high" ? "High risk" : "Low risk"}
        </Badge>
        <Badge tone="amber" dot>
          Waiting for a person
        </Badge>
      </header>

      <div className="space-y-3 px-4 py-3">
        <article
          aria-label={`Draft: ${draft.title}`}
          className="rounded-sm border border-ink/20 bg-paper"
        >
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-ink/10 border-b px-3 py-2">
            <p className="font-mono text-[0.65rem] font-bold tracking-[0.08em] text-ink-muted uppercase">
              Draft · {draftLabel(draft.kind)}
            </p>
            {draft.to ? (
              <p className="text-xs text-ink-muted">To: {draft.to}</p>
            ) : null}
          </div>
          <div className="hx-scroll max-h-80 overflow-y-auto px-3 py-3">
            <p className="mb-2 text-sm font-semibold">{draft.title}</p>
            <Markdown text={draft.body} />
          </div>
        </article>

        <Field label="Note (optional)" htmlFor={noteId}>
          <textarea
            id={noteId}
            value={note}
            rows={2}
            maxLength={1000}
            onChange={(event) => setNote(event.target.value)}
            className={inputClass}
            placeholder="Why you approve it, or what to fix when you return it."
          />
        </Field>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            disabled={!gate.allowed}
            pending={write.pending && pendingDecision === "approve"}
            pendingLabel="Approving…"
            aria-describedby={gate.reason ? reasonId : undefined}
            onClick={() => press("approve")}
          >
            Approve
          </Button>
          <Button
            variant="secondary"
            disabled={!gate.allowed || write.pending}
            pending={write.pending && pendingDecision === "return"}
            pendingLabel="Returning…"
            aria-describedby={gate.reason ? reasonId : undefined}
            onClick={() => press("return")}
          >
            Return
          </Button>
          <p className="text-xs text-ink-muted">Signed in as {staff.name}.</p>
        </div>
        {gate.reason ? (
          <p id={reasonId} className="text-xs text-oak">
            {gate.reason}
          </p>
        ) : null}
        <ErrorNote>{write.error}</ErrorNote>
      </div>

      {asking ? (
        <ConfirmDialog
          title={
            asking === "approve" ? "Approve this Draft?" : "Return this Draft?"
          }
          confirm={asking === "approve" ? "Approve" : "Return"}
          pendingLabel={asking === "approve" ? "Approving…" : "Returning…"}
          danger={asking === "return"}
          onClose={() => setAsking(null)}
          onConfirm={async () => {
            await decide(approval, asking, note);
          }}
        >
          {asking === "approve" ? (
            <p>
              This is a high-risk Approval ({draftLabel(draft.kind)}). Once you
              approve, the Run goes on and records "{draft.title}" as approved
              by {staff.name}.
            </p>
          ) : (
            <p>
              This is a high-risk Approval. Returning it ends the Run as
              returned and sends "{draft.title}" back without recording it.
            </p>
          )}
        </ConfirmDialog>
      ) : null}
    </section>
  );
}
