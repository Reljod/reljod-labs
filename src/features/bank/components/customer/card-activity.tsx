"use client";

import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { formatDate } from "../../domain/dates";
import { formatMoney } from "../../domain/money";
import type { CardAuthView, CardView } from "../../domain/views";
import { Badge, Button, ErrorNote, Loading, Panel } from "../ui";
import { useCommand, useRead } from "../use-bank";
import { AUTH_TONE } from "./format";
import { Money, OutcomeNote, useGate } from "./shared";
import { WriteDialog } from "./write-dialog";

/** A card's authorisations, newest first, with Settle now and Reverse on the open ones. */
export function CardActivity({
  card,
  live,
}: {
  card: CardView;
  live: boolean;
}) {
  const activity = useRead<{ card: CardView; activity: CardAuthView[] }>(
    "list_card_activity",
    { cardId: card.id },
    { refetchMs: live ? 6_000 : false },
  );
  const [reversing, setReversing] = useState<CardAuthView | null>(null);
  const gate = useGate("card.manage");
  const reduce = useReducedMotion();
  const rows = activity.data?.activity ?? [];

  return (
    <Panel
      title="Card activity"
      eyebrow={`Card ending ${card.lastFour}`}
      bodyClassName=""
    >
      <p className="border-ink/15 border-b px-4 py-2 text-xs text-ink-muted">
        End-of-day settles authorised purchases; a travel pre-authorisation is
        never sent in and expires.
      </p>
      {activity.error ? (
        <ErrorNote className="m-4" onRetry={() => void activity.refetch()}>
          {activity.error.message}
        </ErrorNote>
      ) : null}
      {!activity.data && !activity.error ? (
        <div className="p-4">
          <span className="sr-only" aria-live="polite">
            Loading card activity
          </span>
          <Loading rows={3} />
        </div>
      ) : activity.data && rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-ink-muted">
          No purchases yet. Try the terminal.
        </p>
      ) : (
        <ul
          className="divide-y divide-ink/10"
          aria-busy={activity.isFetching || undefined}
          data-testid="bank-card-activity"
        >
          {rows.map((row) => (
            <motion.li
              key={row.id}
              initial={reduce ? false : { opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              className="grid gap-2 px-4 py-2.5 sm:grid-cols-[1fr_auto]"
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <motion.span
                    key={row.status}
                    initial={reduce ? false : { opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="inline-flex"
                  >
                    <Badge tone={AUTH_TONE[row.status]}>{row.status}</Badge>
                  </motion.span>
                  <span className="truncate font-bold">{row.merchant}</span>
                  <Money minor={row.amount} className="text-sm" />
                </p>
                <p className="text-xs text-ink-muted">
                  {row.category} ·{" "}
                  {row.channel === "online" ? "online" : "in store"} ·{" "}
                  {formatDate(row.authorisedOn)}
                  {row.settledOn
                    ? ` · settled ${formatDate(row.settledOn)}`
                    : ""}
                </p>
                {row.status === "declined" ? (
                  <p className="text-xs text-seal-red">
                    Code {row.declineCode}: {row.declineReason}
                  </p>
                ) : null}
              </div>
              {row.status === "authorised" ? (
                <div className="flex items-start gap-2">
                  <SettleButton authorisationId={row.id} />
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={Boolean(gate)}
                    title={gate ?? undefined}
                    onClick={() => setReversing(row)}
                  >
                    Reverse
                  </Button>
                </div>
              ) : null}
            </motion.li>
          ))}
        </ul>
      )}
      {reversing ? (
        <ReverseAuthDialog
          auth={reversing}
          onClose={() => setReversing(null)}
        />
      ) : null}
    </Panel>
  );
}

function SettleButton({ authorisationId }: { authorisationId: string }) {
  const gate = useGate("card.manage");
  const settle = useCommand();
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        pending={settle.pending}
        pendingLabel="Settling…"
        disabled={Boolean(gate)}
        title={
          gate ??
          "The merchant sends it in now: the hold is captured and the money posts."
        }
        onClick={() =>
          void settle.run("settle_card_purchase", { authorisationId })
        }
        data-testid="bank-card-settle"
      >
        Settle now
      </Button>
      <OutcomeNote
        outcome={null}
        error={settle.error}
        className="max-w-xs text-xs"
      />
    </div>
  );
}

function ReverseAuthDialog({
  auth,
  onClose,
}: {
  auth: CardAuthView;
  onClose: () => void;
}) {
  const gate = useGate("card.manage");
  return (
    <WriteDialog
      title="Reverse a card authorisation"
      submit="Reverse it"
      pendingLabel="Reversing…"
      danger
      gate={gate}
      onClose={onClose}
      build={() => ({
        name: "reverse_card_purchase",
        input: { authorisationId: auth.id },
      })}
    >
      <p className="text-ink-muted">
        {auth.merchant} cancels the purchase of {formatMoney(auth.amount)}: the
        hold is released and nothing posts. It cannot be settled afterwards.
      </p>
    </WriteDialog>
  );
}
