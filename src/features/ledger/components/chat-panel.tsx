"use client";

import { type FormEvent, type Ref, useEffect, useRef, useState } from "react";
import { cleanQuestion, MAX_QUESTION_LENGTH } from "../domain/presets";
import { PresetChips } from "./preset-chips";

export type ChatMessage = {
  id: string;
  role: "visitor" | "ledger";
  text: string;
  /** Ledger's reply to a stored Build can replay it. */
  buildIndex?: number;
  notFound?: boolean;
};

type ChatPanelProps = {
  messages: ChatMessage[];
  busy: boolean;
  notice: string | null;
  onAsk: (question: string) => void;
  onReplay: (buildIndex: number) => void;
  /** Ledger sits on this edge when he isn't working. */
  homeRef: Ref<HTMLDivElement>;
};

export function ChatPanel({
  messages,
  busy,
  notice,
  onAsk,
  onReplay,
  homeRef,
}: ChatPanelProps) {
  const [question, setQuestion] = useState("");
  const listRef = useRef<HTMLOListElement>(null);
  const last = messages.at(-1);

  // biome-ignore lint/correctness/useExhaustiveDependencies: follow every new or growing message
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [last?.text, messages.length]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const clean = cleanQuestion(question);
    if (!clean || busy) return;
    onAsk(clean);
    setQuestion("");
  }

  return (
    <section
      aria-label="Chat with Ledger"
      className="flex min-h-0 flex-col border-ink border-t-2"
    >
      <div
        ref={homeRef}
        className="flex items-center justify-between gap-3 border-ink border-b-2 bg-morning-haze px-4 py-3"
      >
        <p className="eyebrow font-bold">Ledger</p>
        <p className="eyebrow text-ink-muted">
          {busy ? "Building…" : "Front desk"}
        </p>
      </div>
      <ol
        ref={listRef}
        aria-live="polite"
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto bg-paper p-3"
      >
        {notice ? (
          <li
            data-testid="notice"
            className="outline-box rounded-sm bg-limestone p-3 text-sm"
          >
            {notice}
          </li>
        ) : null}
        {messages.map((message) => (
          <li
            key={message.id}
            data-testid="chat-message"
            data-role={message.role}
            className={`max-w-[90%] rounded-sm border-2 p-3 text-sm ${
              message.role === "visitor"
                ? "self-end border-ink bg-federal-blue text-paper"
                : "self-start border-limestone bg-marble"
            }`}
          >
            <p>{message.text || "…"}</p>
            {message.notFound ? (
              <div className="mt-3" data-testid="not-found">
                <PresetChips onPick={onAsk} disabled={busy} />
              </div>
            ) : null}
            {message.buildIndex !== undefined && !message.notFound ? (
              <button
                type="button"
                data-testid="replay-build"
                disabled={busy}
                onClick={() => onReplay(message.buildIndex as number)}
                className="eyebrow mt-2 font-bold text-federal-blue underline disabled:opacity-50"
              >
                Watch Ledger build it
              </button>
            ) : null}
          </li>
        ))}
      </ol>
      <form
        onSubmit={submit}
        className="flex gap-2 border-ink border-t-2 bg-paper p-3"
      >
        <label htmlFor="chat-input" className="sr-only">
          Ask Ledger a follow-up
        </label>
        <input
          id="chat-input"
          data-testid="chat-input"
          value={question}
          maxLength={MAX_QUESTION_LENGTH}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={busy ? "Ledger is building…" : "Ask a follow-up"}
          className="outline-box min-h-11 min-w-0 flex-1 rounded-sm bg-marble px-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-federal-blue"
        />
        <button
          type="submit"
          data-testid="chat-send"
          disabled={busy || !cleanQuestion(question)}
          className="outline-box press min-h-11 rounded-sm bg-federal-blue px-4 font-mono text-sm font-bold tracking-[0.1em] text-paper uppercase disabled:opacity-50"
        >
          Ask
        </button>
      </form>
    </section>
  );
}
