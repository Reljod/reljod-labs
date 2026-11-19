"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useId, useState } from "react";
import { formatMoney } from "../../domain/money";
import type { CardView } from "../../domain/views";
import {
  Button,
  cx,
  ErrorNote,
  Field,
  inputClass,
  Panel,
  segmentClass,
  segmentsClass,
} from "../ui";
import { useCommand } from "../use-bank";
import { CARD_CATEGORIES, type CardCategory } from "./format";
import { amountOf, GateLine, MoneyField, selectClass, useGate } from "./shared";

/**
 * A card terminal to simulate a purchase. The bank authorises it (a Hold on
 * the money) or declines it with a code, and the screen answers like a
 * terminal would.
 */

type PurchaseResult = {
  authorisationId: string;
  status: "authorised" | "declined";
  declineCode: string | null;
  declineReason: string | null;
};

export function CardTerminal({ card }: { card: CardView }) {
  const id = useId();
  const gate = useGate("card.manage");
  const purchase = useCommand<PurchaseResult>();
  const [merchant, setMerchant] = useState("Harbour Market");
  const [category, setCategory] = useState<CardCategory>("groceries");
  const [amountText, setAmountText] = useState("24.80");
  const [channel, setChannel] = useState<"in_store" | "online">("in_store");
  const [problem, setProblem] = useState<string | null>(null);
  const amount = amountOf(amountText);
  const reduce = useReducedMotion();
  const result =
    purchase.outcome?.status === "done" ? purchase.outcome.result : null;

  const pay = () => {
    if (merchant.trim().length < 2)
      return setProblem("Give the merchant's name.");
    if (!amount) return setProblem("Give the amount.");
    setProblem(null);
    purchase.reset();
    void purchase.run("card_purchase", {
      cardId: card.id,
      merchant: merchant.trim(),
      category,
      amount,
      channel,
    });
  };

  return (
    <Panel
      title="Card terminal"
      eyebrow={`Simulate a purchase · card ending ${card.lastFour}`}
    >
      <form
        className="grid gap-3 md:grid-cols-[1fr_15rem]"
        onSubmit={(event) => {
          event.preventDefault();
          pay();
        }}
      >
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Merchant" htmlFor={`${id}-merchant`}>
              <input
                id={`${id}-merchant`}
                className={inputClass}
                maxLength={80}
                value={merchant}
                onChange={(event) => setMerchant(event.target.value)}
              />
            </Field>
            <Field label="Category" htmlFor={`${id}-category`}>
              <select
                id={`${id}-category`}
                className={selectClass}
                value={category}
                onChange={(event) =>
                  setCategory(event.target.value as CardCategory)
                }
              >
                {CARD_CATEGORIES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <MoneyField
            id={`${id}-amount`}
            label="Amount"
            value={amountText}
            onChange={setAmountText}
            testId="bank-card-terminal-amount"
          />
          <fieldset className={segmentsClass} aria-label="Where">
            {(["in_store", "online"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={channel === option}
                className={segmentClass(channel === option)}
                onClick={() => setChannel(option)}
              >
                {option === "in_store" ? "In store" : "Online"}
              </button>
            ))}
          </fieldset>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="submit"
              variant="primary"
              pending={purchase.pending}
              pendingLabel="Authorising…"
              disabled={Boolean(gate)}
              data-testid="bank-card-terminal-submit"
            >
              Tap to pay {amount ? formatMoney(amount) : ""}
            </Button>
            <GateLine reason={gate} />
          </div>
          {problem ? <ErrorNote>{problem}</ErrorNote> : null}
          <ErrorNote>{purchase.error}</ErrorNote>
        </div>
        <div
          className="outline-box flex min-h-36 flex-col justify-between rounded-sm bg-ink p-3 font-mono text-paper"
          aria-live="polite"
          data-testid="bank-card-terminal-result"
        >
          <p className="text-[0.65rem] tracking-[0.2em] text-paper/70 uppercase">
            Tidewater · terminal
          </p>
          <AnimatePresence mode="wait" initial={false}>
            {purchase.pending ? (
              <motion.p
                key="wait"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-sm"
              >
                Authorising…
              </motion.p>
            ) : result ? (
              <motion.div
                key={result.authorisationId}
                initial={reduce ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                <p
                  className={cx(
                    "text-2xl font-bold tracking-[0.1em]",
                    result.status === "authorised"
                      ? "text-morning-haze"
                      : "text-brass",
                  )}
                >
                  {result.status === "authorised" ? "APPROVED" : "DECLINED"}
                </p>
                {result.status === "declined" ? (
                  <p className="mt-1 text-xs">
                    Code {result.declineCode}: {result.declineReason}
                  </p>
                ) : (
                  <p className="mt-1 text-xs">
                    The money is held until the purchase settles.
                  </p>
                )}
              </motion.div>
            ) : (
              <motion.p
                key="idle"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-sm text-paper/80"
              >
                Ready. Present card.
              </motion.p>
            )}
          </AnimatePresence>
          <p className="text-right text-xs text-paper/70">
            {maskLine(card.lastFour)}
          </p>
        </div>
      </form>
    </Panel>
  );
}

const maskLine = (lastFour: string) => `CARD •••• ${lastFour}`;
