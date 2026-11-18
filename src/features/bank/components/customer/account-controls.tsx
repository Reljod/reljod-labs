"use client";

import { useId, useState } from "react";
import { formatDate } from "../../domain/dates";
import { formatMinor, formatMoney, parseMoney } from "../../domain/money";
import { formatAccountNumber } from "../../domain/numbers";
import type { AccountView, TransactionView } from "../../domain/views";
import { cx, Field, inputClass } from "../ui";
import { DISPUTE_REASONS, type DisputeReason } from "./format";
import { MoneyField, selectClass, useGate } from "./shared";
import { WriteDialog } from "./write-dialog";

/** The controls of one account: freeze, overdraft, close, and a dispute on a transaction. */

export function FreezeDialog({
  account,
  onClose,
}: {
  account: AccountView;
  onClose: () => void;
}) {
  const id = useId();
  const gate = useGate("account.restrict");
  // Fixed when the dialog opens: the account's status changes under it once the write lands.
  const [freezing] = useState(account.status === "open");
  const [reason, setReason] = useState("");
  return (
    <WriteDialog
      title={`${freezing ? "Freeze" : "Unfreeze"} ${account.name}`}
      submit={freezing ? "Freeze the account" : "Unfreeze the account"}
      pendingLabel={freezing ? "Freezing…" : "Unfreezing…"}
      danger={freezing}
      gate={gate}
      onClose={onClose}
      build={() => {
        if (reason.trim().length < 3) return "Give the reason for the file.";
        return {
          name: "set_account_status",
          input: {
            accountId: account.id,
            status: freezing ? "frozen" : "open",
            reason: reason.trim(),
          },
        };
      }}
    >
      <p className="text-ink-muted">
        {freezing
          ? `Nothing may leave ${formatAccountNumber(account.number)} while it is frozen: transfers, payments and card purchases are refused. Money may still arrive.`
          : `${formatAccountNumber(account.number)} opens again: money may leave it.`}
      </p>
      <Field label="Reason" htmlFor={id}>
        <input
          id={id}
          className={inputClass}
          maxLength={200}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
    </WriteDialog>
  );
}

export function OverdraftDialog({
  account,
  onClose,
}: {
  account: AccountView;
  onClose: () => void;
}) {
  const id = useId();
  const gate = useGate("account.restrict");
  const [limitText, setLimitText] = useState(
    formatMinor(account.overdraftLimit),
  );
  const parsed = limitText.trim() === "" ? 0 : parseMoney(limitText);
  const tooHigh = parsed !== null && parsed > 50_000_00;
  return (
    <WriteDialog
      title={`Overdraft on ${account.name}`}
      submit="Set the limit"
      pendingLabel="Saving…"
      gate={gate}
      onClose={onClose}
      build={() => {
        if (parsed === null) return "Give the limit as an amount, 0 for none.";
        if (tooHigh) return "The most a branch may set is MRF 50,000.00.";
        return {
          name: "set_overdraft",
          input: { accountId: account.id, limit: parsed },
        };
      }}
    >
      <p className="text-ink-muted">
        How far {formatAccountNumber(account.number)} may go below zero. Over
        the overdraft Rule's threshold it waits for a supervisor's Approval.
      </p>
      <MoneyField
        id={id}
        label="Overdraft limit"
        value={limitText}
        onChange={setLimitText}
        error={tooHigh ? "At most MRF 50,000.00." : null}
        hint="0 removes the overdraft."
      />
    </WriteDialog>
  );
}

export function CloseAccountDialog({
  account,
  onClose,
}: {
  account: AccountView;
  onClose: () => void;
}) {
  const gate = useGate("account.manage");
  return (
    <WriteDialog
      title={`Close ${account.name}`}
      submit="Close the account"
      pendingLabel="Closing…"
      danger
      gate={gate}
      onClose={onClose}
      build={() => ({
        name: "close_account",
        input: { accountId: account.id },
      })}
    >
      <p className="text-ink-muted">
        {formatAccountNumber(account.number)} closes for good. Its balance must
        be zero, with no holds, cards or scheduled payments left.
      </p>
      {account.balance !== 0 ? (
        <p className="text-seal-red">
          It still holds {formatMoney(account.balance)}: move it out first, or
          the bank refuses.
        </p>
      ) : null}
    </WriteDialog>
  );
}

export function DisputeDialog({
  account,
  transaction,
  onClose,
}: {
  account: AccountView;
  transaction: TransactionView;
  onClose: () => void;
}) {
  const id = useId();
  const gate = useGate("dispute.open");
  const [reason, setReason] = useState<DisputeReason>("not_recognised");
  const [detail, setDetail] = useState("");
  return (
    <WriteDialog
      title="Dispute a transaction"
      submit="Open the dispute"
      pendingLabel="Opening…"
      gate={gate}
      onClose={onClose}
      build={() => ({
        name: "open_dispute",
        input: {
          accountId: account.id,
          entryId: transaction.entryId,
          reason,
          detail: detail.trim() || undefined,
        },
      })}
    >
      <div className="outline-box rounded-sm bg-marble px-3 py-2">
        <p className="font-bold">{transaction.description}</p>
        <p className="font-mono text-xs text-ink-muted">
          {formatDate(transaction.date)} · {formatMoney(transaction.amount)} out
          of {formatAccountNumber(account.number)}
        </p>
      </div>
      <Field label="Reason" htmlFor={`${id}-reason`}>
        <select
          id={`${id}-reason`}
          className={selectClass}
          value={reason}
          onChange={(event) => setReason(event.target.value as DisputeReason)}
        >
          {DISPUTE_REASONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="What the customer says (optional)" htmlFor={`${id}-detail`}>
        <textarea
          id={`${id}-detail`}
          rows={3}
          maxLength={400}
          className={cx(inputClass)}
          value={detail}
          onChange={(event) => setDetail(event.target.value)}
        />
      </Field>
      <p className="text-xs text-ink-muted">
        A supervisor or compliance upholds it (a refund) or rejects it.
      </p>
    </WriteDialog>
  );
}
