"use client";

import { useState } from "react";
import { formatDate } from "../../domain/dates";
import { formatMoney } from "../../domain/money";
import { formatAccountNumber } from "../../domain/numbers";
import type { CardView, CustomerDetail } from "../../domain/views";
import { Button, cx, Empty } from "../ui";
import { CardActivity } from "./card-activity";
import {
  CardLimitsDialog,
  CardStatusDialog,
  IssueCardDialog,
} from "./card-dialogs";
import { CardFace } from "./card-face";
import { CardTerminal } from "./card-terminal";
import { GateLine, useGate } from "./shared";

/** Cards: each debit card drawn, its controls, a terminal to try it, and its activity. */

type Dialog =
  | { name: "issue" }
  | { name: "limits"; card: CardView }
  | { name: "status"; card: CardView; status: CardView["status"] };

export function CardsSection({
  detail,
  live,
}: {
  detail: CustomerDetail;
  live: boolean;
}) {
  const gate = useGate("card.manage");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const cards = detail.cards;
  const selected =
    cards.find((card) => card.id === picked) ??
    cards.find((card) => card.status !== "cancelled") ??
    cards[0];
  const hasCurrent = detail.accounts.some(
    (account) => account.kind === "current" && account.status === "open",
  );
  const close = () => setDialog(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          disabled={Boolean(gate) || !hasCurrent}
          title={
            gate ??
            (hasCurrent ? undefined : "A card needs an open current account.")
          }
          onClick={() => setDialog({ name: "issue" })}
          data-testid="bank-card-issue"
        >
          + Issue a card
        </Button>
        <GateLine
          reason={
            gate ??
            (hasCurrent ? null : "A card needs an open current account.")
          }
        />
      </div>

      {cards.length === 0 ? (
        <div className="outline-box rounded-sm bg-paper">
          <Empty title="No cards yet">
            Issue a debit card on a current account, then try it at the
            terminal.
          </Empty>
        </div>
      ) : (
        <div
          className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3"
          data-testid="bank-cards"
        >
          {cards.map((card) => {
            const isSelected = card.id === selected?.id;
            const cancelled = card.status === "cancelled";
            return (
              <div
                key={card.id}
                className={cx(
                  "outline-box space-y-3 rounded-sm p-3 shadow-hard-sm",
                  isSelected ? "bg-morning-haze" : "bg-paper",
                )}
              >
                <button
                  type="button"
                  className="block w-full text-left"
                  aria-pressed={isSelected}
                  aria-label={`Show the card ending ${card.lastFour}`}
                  onClick={() => setPicked(card.id)}
                >
                  <CardFace card={card} />
                </button>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <dt className="text-ink-muted">Account</dt>
                  <dd className="text-right font-mono">
                    {formatAccountNumber(card.accountNumber)}
                  </dd>
                  <dt className="text-ink-muted">One purchase</dt>
                  <dd className="text-right font-mono tabular-nums">
                    {formatMoney(card.perTransactionLimit)}
                  </dd>
                  <dt className="text-ink-muted">A day</dt>
                  <dd className="text-right font-mono tabular-nums">
                    {formatMoney(card.dailyLimit)}
                  </dd>
                  <dt className="text-ink-muted">Online</dt>
                  <dd className="text-right">
                    {card.onlineEnabled ? "On" : "Off"}
                  </dd>
                  <dt className="text-ink-muted">Issued</dt>
                  <dd className="text-right">{formatDate(card.issuedOn)}</dd>
                </dl>
                {cancelled ? null : (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={Boolean(gate)}
                      title={gate ?? undefined}
                      onClick={() =>
                        setDialog({
                          name: "status",
                          card,
                          status:
                            card.status === "frozen" ? "active" : "frozen",
                        })
                      }
                      data-testid="bank-card-freeze"
                    >
                      {card.status === "frozen" ? "Unfreeze" : "Freeze"}
                    </Button>
                    <Button
                      size="sm"
                      disabled={Boolean(gate)}
                      title={gate ?? undefined}
                      onClick={() => setDialog({ name: "limits", card })}
                    >
                      Limits
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={Boolean(gate)}
                      title={gate ?? undefined}
                      onClick={() =>
                        setDialog({ name: "status", card, status: "cancelled" })
                      }
                    >
                      Cancel
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {selected ? (
        <div className="grid gap-4 2xl:grid-cols-2">
          <CardTerminal key={selected.id} card={selected} />
          <CardActivity card={selected} live={live} />
        </div>
      ) : null}

      {dialog?.name === "issue" ? (
        <IssueCardDialog accounts={detail.accounts} onClose={close} />
      ) : null}
      {dialog?.name === "limits" ? (
        <CardLimitsDialog card={dialog.card} onClose={close} />
      ) : null}
      {dialog?.name === "status" ? (
        <CardStatusDialog
          card={dialog.card}
          status={dialog.status}
          onClose={close}
        />
      ) : null}
    </div>
  );
}
