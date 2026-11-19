"use client";

import { useId, useState } from "react";
import { formatDate } from "../../domain/dates";
import { formatMoney } from "../../domain/money";
import { formatAccountNumber } from "../../domain/numbers";
import type { DisputeView } from "../../domain/views";
import {
  Badge,
  Button,
  ErrorNote,
  Field,
  inputClass,
  Loading,
  Panel,
} from "../ui";
import { useRead } from "../use-bank";
import { DISPUTE_TONE, disputeReasonLabel } from "./format";
import { GateLine, Money, useGate } from "./shared";
import { WriteDialog } from "./write-dialog";

/** The Customer's Disputes, and for an open one the decision: uphold (refund) or reject. */
export function DisputesList({
  customerId,
  live,
}: {
  customerId: string;
  live: boolean;
}) {
  const list = useRead<{ disputes: DisputeView[] }>(
    "list_disputes",
    { customerId },
    { refetchMs: live ? 6_000 : false },
  );
  const gate = useGate("dispute.resolve");
  const [deciding, setDeciding] = useState<{
    dispute: DisputeView;
    outcome: "upheld" | "rejected";
  } | null>(null);
  const disputes = list.data?.disputes ?? [];
  const anyOpen = disputes.some((dispute) => dispute.status === "open");

  return (
    <Panel
      title="Disputes"
      eyebrow="Open one from a transaction under Accounts"
      bodyClassName=""
    >
      {list.error ? (
        <ErrorNote className="m-4" onRetry={() => void list.refetch()}>
          {list.error.message}
        </ErrorNote>
      ) : null}
      {!list.data && !list.error ? (
        <div className="p-4">
          <span className="sr-only" aria-live="polite">
            Loading disputes
          </span>
          <Loading rows={2} />
        </div>
      ) : list.data && disputes.length === 0 ? (
        <p className="px-4 py-6 text-sm text-ink-muted">
          No disputes. A customer challenges a transaction with Dispute on its
          row.
        </p>
      ) : (
        <ul
          className="divide-y divide-ink/10"
          aria-busy={list.isFetching || undefined}
          data-testid="bank-disputes"
        >
          {disputes.map((dispute) => (
            <li
              key={dispute.id}
              className="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_auto]"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={DISPUTE_TONE[dispute.status]}>
                    {dispute.status}
                  </Badge>
                  <span className="font-bold">
                    {disputeReasonLabel(dispute.reason)}
                  </span>
                  <Money minor={dispute.amount} className="text-sm" />
                </div>
                <p className="mt-1 text-xs text-ink-muted">
                  <span className="font-mono">
                    {formatAccountNumber(dispute.accountNumber)}
                  </span>{" "}
                  · entry <span className="font-mono">#{dispute.entryId}</span>{" "}
                  · opened {formatDate(dispute.openedOn)}
                  {dispute.resolvedOn
                    ? ` · resolved ${formatDate(dispute.resolvedOn)}`
                    : ""}
                </p>
                {dispute.detail ? (
                  <p className="mt-1 text-sm">"{dispute.detail}"</p>
                ) : null}
                {dispute.resolutionNote ? (
                  <p className="mt-1 text-xs">
                    Decision: {dispute.resolutionNote}
                  </p>
                ) : null}
              </div>
              {dispute.status === "open" ? (
                <div className="flex items-start gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={Boolean(gate)}
                    title={gate ?? undefined}
                    onClick={() => setDeciding({ dispute, outcome: "upheld" })}
                    data-testid="bank-dispute-uphold"
                  >
                    Uphold
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={Boolean(gate)}
                    title={gate ?? undefined}
                    onClick={() =>
                      setDeciding({ dispute, outcome: "rejected" })
                    }
                    data-testid="bank-dispute-reject"
                  >
                    Reject
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {anyOpen && gate ? (
        <GateLine
          className="border-ink/15 border-t px-4 py-2"
          reason={`Decide: ${gate}`}
        />
      ) : null}
      {deciding ? (
        <ResolveDialog
          dispute={deciding.dispute}
          outcome={deciding.outcome}
          onClose={() => setDeciding(null)}
        />
      ) : null}
    </Panel>
  );
}

function ResolveDialog({
  dispute,
  outcome,
  onClose,
}: {
  dispute: DisputeView;
  outcome: "upheld" | "rejected";
  onClose: () => void;
}) {
  const id = useId();
  const gate = useGate("dispute.resolve");
  const [note, setNote] = useState("");
  const upheld = outcome === "upheld";
  return (
    <WriteDialog
      title={upheld ? "Uphold the dispute" : "Reject the dispute"}
      submit={upheld ? "Uphold and refund" : "Reject the dispute"}
      pendingLabel={upheld ? "Upholding…" : "Rejecting…"}
      danger={!upheld}
      gate={gate}
      onClose={onClose}
      build={() => {
        if (note.trim().length < 3)
          return "Give a note for the customer's file.";
        return {
          name: "resolve_dispute",
          input: { disputeId: dispute.id, outcome, note: note.trim() },
        };
      }}
    >
      <p className="text-ink-muted">
        {upheld
          ? `${dispute.customerName} is refunded ${formatMoney(dispute.amount)} into ${formatAccountNumber(dispute.accountNumber)}, from the bank's losses account.`
          : `${dispute.customerName} is told the transaction stands. Nothing moves.`}
      </p>
      <Field label="Note" htmlFor={id}>
        <textarea
          id={id}
          rows={3}
          maxLength={300}
          className={inputClass}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>
    </WriteDialog>
  );
}
