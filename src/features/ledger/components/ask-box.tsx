"use client";

import { type FormEvent, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { cleanQuestion, MAX_QUESTION_LENGTH } from "../domain/presets";
import { Cat } from "./cat";
import { useLedgerDesk } from "./ledger-desk";
import { PresetChips } from "./preset-chips";

/**
 * The hero's chat with Ledger, and Ledger himself peeking up from the corner
 * of the hero. Asking pushes the chat into the dock; the page never reloads.
 */
export function AskBox() {
  const desk = useLedgerDesk();
  const [question, setQuestion] = useState("");
  if (!desk?.inHero) return null;

  function submit(text: string) {
    const clean = cleanQuestion(text);
    if (!clean || !desk || desk.pending) return;
    desk.ask(clean);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    submit(question);
  }

  return (
    <>
      <aside
        ref={desk.boxRef}
        aria-label="Chat with Ledger"
        data-testid="ask-box"
        className="outline-box relative flex flex-col bg-paper shadow-hard-lg"
      >
        <div className="flex items-center gap-3 border-ink border-b-2 bg-morning-haze px-4 py-3">
          <span className="outline-box flex size-10 shrink-0 items-end justify-center overflow-hidden rounded-full bg-paper">
            <Cat pose="idle" size={44} animate={false} />
          </span>
          <p className="font-mono text-sm font-bold tracking-[0.1em] uppercase">
            Ledger
          </p>
          <span className="ml-auto flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-ivy" />
            <span className="sr-only">Online</span>
          </span>
        </div>

        <div aria-live="polite" className="flex flex-col gap-3 p-4">
          <p className="max-w-[85%] self-start rounded-sm border-2 border-limestone bg-marble px-3 py-2">
            Hi! Ask me anything about Reljod.
          </p>
          {desk.notice ? (
            <p
              data-testid="ask-notice"
              className="max-w-[85%] self-start rounded-sm border-2 border-seal-red bg-marble px-3 py-2 text-sm"
            >
              {desk.notice}
            </p>
          ) : null}
          <div className="self-end">
            <PresetChips onPick={submit} disabled={desk.pending} align="end" />
          </div>
        </div>

        <form
          onSubmit={onSubmit}
          className="mt-auto flex gap-2 border-ink border-t-2 p-3"
        >
          <label htmlFor="ask-input" className="sr-only">
            Your question
          </label>
          <input
            id="ask-input"
            data-testid="ask-input"
            maxLength={MAX_QUESTION_LENGTH}
            value={question}
            placeholder="Message Ledger…"
            autoComplete="off"
            onChange={(event) => {
              setQuestion(event.target.value);
              desk.typing(event.target.value.length > 0);
            }}
            className="outline-box min-h-11 min-w-0 flex-1 rounded-sm bg-marble px-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-federal-blue"
          />
          <button
            type="submit"
            data-testid="ask-send"
            aria-label="Send"
            disabled={desk.pending || !cleanQuestion(question)}
            className="outline-box press inline-flex size-11 shrink-0 items-center justify-center rounded-sm bg-federal-blue text-paper disabled:opacity-50"
          >
            <Icon name="send" size={20} />
          </button>
        </form>
      </aside>

      {/* Peeks over the band below the hero: his feet stay out of sight. */}
      <div
        ref={desk.catRef}
        data-testid="hero-cat"
        data-pose={desk.pose}
        aria-hidden="true"
        className={`pointer-events-none absolute right-[max(1rem,calc(50%-36rem))] bottom-0 w-24 translate-y-[20%] sm:w-32 lg:w-[170px] [&_svg]:h-auto [&_svg]:w-full ${desk.catLeft ? "invisible" : ""}`}
      >
        <div className="lgr-body">
          <Cat pose={desk.pose} size={170} />
        </div>
      </div>
    </>
  );
}
