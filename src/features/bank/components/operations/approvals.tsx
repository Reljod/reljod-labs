"use client";

import { useId, useState } from "react";
import { formatMoney } from "../../domain/money";
import { approvalRefusal } from "../../domain/permissions";
import type { ApprovalView } from "../../domain/views";
import { CommandDialog, OutcomeNote } from "../shell/command-dialog";
import { formatStamp } from "../shell/time";
import { Badge, Button, cx, Empty, inputClass, type Tone } from "../ui";
import { useBank, useCommand, useRead } from "../use-bank";
import { Amount, ListSkeleton, type Live, ReadError } from "./figures";

const STATUS: Record<ApprovalView["status"], { tone: Tone; label: string }> = {
  pending: { tone: "amber", label: "Pending" },
  approved: { tone: "green", label: "Approved" },
  rejected: { tone: "ink", label: "Rejected" },
  expired: { tone: "neutral", label: "Expired" },
  failed: { tone: "red", label: "Failed" },
};

const VIA: Record<string, string> = {
  app: "in the app",
  chat: "through the Teller",
  mcp: "from an MCP client",
};

/**
 * Maker-checker. A write over a Rule's threshold waits here for a supervisor
 * who did not make it. Pending ones first; one list, so a decided Approval
 * keeps its outcome on screen as it moves down.
 */
export function Approvals({ live }: { live: Live }) {
  const read = useRead<{ approvals: ApprovalView[] }>(
    "list_approvals",
    {},
    live,
  );
  if (read.isPending)
    return (
      <ListSkeleton rows={3} height="h-28" label="Reading the Approvals…" />
    );
  if (!read.data)
    return <ReadError error={read.error} onRetry={() => void read.refetch()} />;
  const approvals = [...read.data.approvals].sort(
    (a, b) => Number(b.status === "pending") - Number(a.status === "pending"),
  );
  if (approvals.length === 0) {
    return (
      <Empty title="Nothing waits for a checker">
        A large payment, a reversal or an overdraft limit waits here for a
        supervisor who did not ask for it (the Rule “Second pair of eyes” sets
        the threshold).
      </Empty>
    );
  }
  const firstDecided = approvals.findIndex((item) => item.status !== "pending");
  return (
    <ul
      className="space-y-3"
      aria-busy={read.isFetching || undefined}
      data-testid="bank-ops-approvals"
    >
      {approvals.map((approval, index) => (
        <ApprovalItem
          key={approval.id}
          approval={approval}
          divider={index === firstDecided && index > 0}
        />
      ))}
    </ul>
  );
}

function ApprovalItem({
  approval,
  divider,
}: {
  approval: ApprovalView;
  divider: boolean;
}) {
  const { activeStaff } = useBank();
  const decide = useCommand();
  const [asking, setAsking] = useState<"approve" | "reject" | null>(null);
  const [note, setNote] = useState("");
  const noteId = useId();
  const pending = approval.status === "pending";
  const refusal = approvalRefusal(activeStaff, approval);
  const status = STATUS[approval.status];

  const ask = (decision: "approve" | "reject") => {
    decide.reset();
    setNote("");
    setAsking(decision);
  };

  return (
    <li>
      {divider ? (
        <p className="eyebrow mt-5 mb-2 text-[0.65rem] font-bold text-ink-muted">
          Decided
        </p>
      ) : null}
      <article
        className={cx(
          "outline-box rounded-sm bg-paper",
          pending ? "shadow-hard-md" : "border-ink/40 text-ink-muted",
        )}
        data-testid={`bank-approval-${approval.id}`}
      >
        <div className="grid gap-x-4 gap-y-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={status.tone} dot={pending}>
                {status.label}
              </Badge>
              <span className="eyebrow text-[0.6rem] font-bold text-ink-muted">
                {approval.commandTitle}
              </span>
            </div>
            <p className="text-sm font-semibold text-ink">{approval.summary}</p>
            <p className="text-xs">
              <span className="text-ink-muted">Why it waits: </span>
              {approval.reason}
            </p>
            <p className="text-xs text-ink-muted">
              Asked by{" "}
              <span className="font-semibold text-ink">
                {approval.requestedByName}
              </span>{" "}
              {VIA[approval.requestedVia] ?? `via ${approval.requestedVia}`} ·{" "}
              {formatStamp(approval.createdAt)}
            </p>
            {approval.decidedByName ? (
              <p className="text-xs text-ink-muted">
                {status.label} by{" "}
                <span className="font-semibold text-ink">
                  {approval.decidedByName}
                </span>
                {approval.decidedAt
                  ? ` · ${formatStamp(approval.decidedAt)}`
                  : ""}
                {approval.decisionNote ? ` · “${approval.decisionNote}”` : ""}
              </p>
            ) : null}
          </div>
          {approval.amount !== null ? (
            <div className="sm:text-right">
              <p className="eyebrow text-[0.6rem] font-bold text-ink-muted">
                MRF
              </p>
              <Amount
                minor={approval.amount}
                className="text-xl font-bold text-ink"
              />
            </div>
          ) : null}
        </div>
        {pending ? (
          <footer className="flex flex-wrap items-center gap-2 border-ink/20 border-t bg-marble/50 px-3 py-2">
            <Button
              size="sm"
              variant="primary"
              disabled={Boolean(refusal) || decide.pending}
              title={refusal ?? undefined}
              onClick={() => ask("approve")}
              data-testid="bank-approval-approve"
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={Boolean(refusal) || decide.pending}
              title={refusal ?? undefined}
              onClick={() => ask("reject")}
              data-testid="bank-approval-reject"
            >
              Reject
            </Button>
            {refusal ? (
              <span className="text-xs text-ink-muted">{refusal}</span>
            ) : null}
          </footer>
        ) : null}
        <OutcomeNote command={decide} className="m-3 mt-0" />
      </article>
      {asking ? (
        <CommandDialog
          title={
            asking === "approve" ? "Give the Approval" : "Refuse the Approval"
          }
          confirm={asking === "approve" ? "Approve" : "Reject"}
          pendingLabel={asking === "approve" ? "Approving…" : "Rejecting…"}
          danger={asking === "reject"}
          command={decide}
          onClose={() => setAsking(null)}
          testId="bank-approval-confirm"
          onConfirm={() =>
            decide.run("decide_approval", {
              approvalId: approval.id,
              decision: asking,
              ...(note.trim() ? { note: note.trim() } : {}),
            })
          }
        >
          <p className="text-ink-muted">
            {asking === "approve"
              ? `${approval.summary}${approval.amount !== null ? ` (${formatMoney(approval.amount)})` : ""} runs now, as ${approval.requestedByName} asked. If the money is no longer there, it fails and says so.`
              : `${approval.summary} does not run. ${approval.requestedByName} sees that you refused it.`}
          </p>
          <label
            htmlFor={noteId}
            className="eyebrow block text-[0.65rem] font-bold text-ink-muted"
          >
            Note (optional)
          </label>
          <textarea
            id={noteId}
            value={note}
            maxLength={300}
            rows={2}
            onChange={(event) => setNote(event.target.value)}
            className={inputClass}
          />
        </CommandDialog>
      ) : null}
    </li>
  );
}
