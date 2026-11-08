"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { type LogLine, Terminal } from "@/components/ui/terminal";
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
  /** What Ledger is doing, line by line. */
  log: LogLine[];
  sessionId: string;
};

export function ChatPanel({
  messages,
  busy,
  notice,
  onAsk,
  onReplay,
  log,
  sessionId,
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
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex items-center justify-between gap-3 border-ink border-b-2 bg-morning-haze px-4 py-3">
        <p className="font-mono text-sm font-bold tracking-[0.1em] uppercase">
          Ledger
        </p>
        <span className="flex items-center gap-1.5">
          <span
            className={`size-2 rounded-full ${busy ? "animate-pulse bg-brass" : "bg-ivy"}`}
          />
          <span className="sr-only">{busy ? "Building" : "Online"}</span>
        </span>
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
                data-testid="replay-message"
                aria-label="Watch Ledger build this answer"
                disabled={busy}
                onClick={() => onReplay(message.buildIndex as number)}
                className="mt-2 inline-flex size-8 items-center justify-center text-federal-blue hover:bg-paper disabled:opacity-50"
              >
                <Icon name="replay" size={18} />
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
          placeholder={busy ? "Ledger is building…" : "Message Ledger…"}
          className="outline-box min-h-11 min-w-0 flex-1 rounded-sm bg-marble px-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-federal-blue"
        />
        <button
          type="submit"
          data-testid="chat-send"
          aria-label="Send"
          disabled={busy || !cleanQuestion(question)}
          className="outline-box press inline-flex size-11 shrink-0 items-center justify-center rounded-sm bg-federal-blue text-paper disabled:opacity-50"
        >
          <Icon name="send" size={20} />
        </button>
      </form>
      <div className="border-ink border-t-2 p-2">
        <Terminal
          title={`ledger@reljod:~/ask/${sessionId.slice(0, 8)}`}
          lines={log}
          live={busy}
          bodyClassName="h-36 sm:h-44"
        />
      </div>
    </section>
  );
}
