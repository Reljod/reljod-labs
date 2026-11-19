"use client";

import { useId, useState } from "react";
import { formatMinor, formatMoney } from "../../domain/money";
import { formatAccountNumber } from "../../domain/numbers";
import type { AccountView, CardView } from "../../domain/views";
import { segmentClass, segmentsClass } from "../ui";
import { AccountSelect } from "./account-dialogs";
import { amountOf, MoneyField, useGate } from "./shared";
import { WriteDialog } from "./write-dialog";

/** The forms of a card: issue one, set its limits, freeze or cancel it. */

export function IssueCardDialog({
  accounts,
  onClose,
}: {
  accounts: AccountView[];
  onClose: () => void;
}) {
  const id = useId();
  const gate = useGate("card.manage");
  const current = accounts.filter(
    (account) => account.kind === "current" && account.status === "open",
  );
  const [accountId, setAccountId] = useState(current[0]?.id ?? "");
  return (
    <WriteDialog
      title="Issue a debit card"
      submit="Issue the card"
      pendingLabel="Issuing…"
      gate={gate}
      onClose={onClose}
      build={() =>
        accountId
          ? { name: "issue_card", input: { accountId } }
          : "A card needs an open current account."
      }
    >
      <AccountSelect
        id={id}
        label="On account"
        accounts={current}
        value={accountId}
        onChange={setAccountId}
      />
      <p className="text-ink-muted">
        A debit card with the default limits from the cards Rule. Only its last
        four digits are ever kept.
      </p>
    </WriteDialog>
  );
}

export function CardLimitsDialog({
  card,
  onClose,
}: {
  card: CardView;
  onClose: () => void;
}) {
  const id = useId();
  const gate = useGate("card.manage");
  const [perText, setPerText] = useState(formatMinor(card.perTransactionLimit));
  const [dayText, setDayText] = useState(formatMinor(card.dailyLimit));
  const [online, setOnline] = useState(card.onlineEnabled);
  const per = amountOf(perText);
  const day = amountOf(dayText);
  const dayBelow = per !== null && day !== null && day < per;
  return (
    <WriteDialog
      title={`Limits of the card ending ${card.lastFour}`}
      submit="Save the limits"
      pendingLabel="Saving…"
      gate={gate}
      onClose={onClose}
      build={() => {
        if (!per || !day) return "Give both limits as amounts above zero.";
        if (dayBelow)
          return "The daily limit cannot be below the limit for one purchase.";
        return {
          name: "set_card_limits",
          input: {
            cardId: card.id,
            perTransaction: per,
            perDay: day,
            onlineEnabled: online,
          },
        };
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <MoneyField
          id={`${id}-per`}
          label="One purchase"
          value={perText}
          onChange={setPerText}
        />
        <MoneyField
          id={`${id}-day`}
          label="A day"
          value={dayText}
          onChange={setDayText}
          error={dayBelow ? "Not below one purchase." : null}
        />
      </div>
      <fieldset>
        <legend className="eyebrow mb-1 text-[0.65rem] font-bold text-ink-muted">
          Online purchases
        </legend>
        <div className={segmentsClass}>
          <button
            type="button"
            aria-pressed={online}
            className={segmentClass(online)}
            onClick={() => setOnline(true)}
          >
            On
          </button>
          <button
            type="button"
            aria-pressed={!online}
            className={segmentClass(!online)}
            onClick={() => setOnline(false)}
          >
            Off
          </button>
        </div>
      </fieldset>
      <p className="text-xs text-ink-muted">
        The cards Rule sets a ceiling no card may go above.
      </p>
    </WriteDialog>
  );
}

export function CardStatusDialog({
  card,
  status,
  onClose,
}: {
  card: CardView;
  status: "active" | "frozen" | "cancelled";
  onClose: () => void;
}) {
  const gate = useGate("card.manage");
  const copy = {
    frozen: {
      title: "Freeze the card",
      submit: "Freeze",
      pending: "Freezing…",
      text: "Every purchase is declined (code 62) until it is unfrozen. Nothing else changes.",
    },
    active: {
      title: "Unfreeze the card",
      submit: "Unfreeze",
      pending: "Unfreezing…",
      text: "The card works again within its limits.",
    },
    cancelled: {
      title: "Cancel the card",
      submit: "Cancel the card",
      pending: "Cancelling…",
      text: "The card stops for good: it cannot be unfrozen. Purchases already authorised still settle. Issue a new card to replace it.",
    },
  }[status];
  return (
    <WriteDialog
      title={`${copy.title} ending ${card.lastFour}`}
      submit={copy.submit}
      pendingLabel={copy.pending}
      danger={status !== "active"}
      gate={gate}
      onClose={onClose}
      build={() => ({
        name: "set_card_status",
        input: { cardId: card.id, status },
      })}
    >
      <p className="text-ink-muted">
        {copy.text} Card on {formatAccountNumber(card.accountNumber)}, limits{" "}
        {formatMoney(card.perTransactionLimit)} a purchase and{" "}
        {formatMoney(card.dailyLimit)} a day.
      </p>
    </WriteDialog>
  );
}
