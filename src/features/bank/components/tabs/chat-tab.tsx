"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ChatEvent,
  MessagePart,
  MessageView,
  SessionSummary,
} from "../../domain/chat";
import { commandDef } from "../../domain/commands";
import { LIMITS } from "../../domain/limits";
import type { ConfirmationView } from "../../domain/views";
import { createSessionAction, deleteSessionAction } from "../../server/actions";
import { chatApi, messageOf, type SessionDetail } from "../api";
import { ResultCard } from "../chat/result-card";
import { Badge, Button, ErrorNote, inputClass, Markdown, Spinner } from "../ui";
import { useBank } from "../use-bank";

const EXAMPLES = [
  "What can Mara spend right now, and why is it less than her balance?",
  "Transfer MRF 25 from Mara's everyday account to Joren",
  "Pay Tavi's supplier Old Mill Supplies MRF 180",
  "Chart Mara's spending by month",
  "Freeze Mara's card",
  "I want savings goals with a target and a progress bar",
];

type ToolPart = Extract<MessagePart, { type: "tool" }>;
type Live = {
  text: string;
  reasoning: string;
  tools: (ToolPart & { running: boolean })[];
  usage: string | null;
};
const EMPTY: Live = { text: "", reasoning: "", tools: [], usage: null };

function ToolRow({
  tool,
  running,
  confirmations,
  onDecided,
}: {
  tool: ToolPart;
  running?: boolean;
  confirmations: ConfirmationView[];
  onDecided: () => void;
}) {
  return (
    <div
      data-testid="bank-chat-tool"
      data-tool={tool.name}
      data-ok={String(tool.ok)}
      className="flex flex-col gap-2"
    >
      <details className="text-xs">
        <summary className="press flex cursor-pointer items-center gap-2">
          {running ? (
            <Spinner />
          ) : (
            <Badge tone={tool.ok ? "green" : "red"}>
              {tool.ok ? "ok" : "refused"}
            </Badge>
          )}
          <span className="font-semibold">
            {commandDef(tool.name)?.title ?? tool.name}
          </span>
          <span className="text-ink/70">{tool.summary}</span>
        </summary>
        <pre className="tb-scroll-x mt-1 overflow-x-auto rounded-sm border border-ink/20 bg-marble p-2">
          {tool.name}({JSON.stringify(tool.args, null, 1)})
        </pre>
      </details>
      {!running && tool.ok ? (
        <ResultCard
          name={tool.name}
          data={tool.data}
          confirmations={confirmations}
          onDecided={onDecided}
        />
      ) : null}
    </div>
  );
}

function Message({
  message,
  confirmations,
  onDecided,
}: {
  message: MessageView;
  confirmations: ConfirmationView[];
  onDecided: () => void;
}) {
  const { openTab } = useBank();
  const person = message.role === "person";
  return (
    <li
      data-testid="bank-chat-message"
      data-role={message.role}
      className={
        person
          ? "outline-box ml-auto max-w-[85%] rounded-sm bg-ink px-3 py-2 text-paper text-sm"
          : "flex flex-col gap-2 text-sm"
      }
    >
      {person ? (
        message.content
      ) : (
        <>
          {message.parts.map((part, index) =>
            part.type === "tool" ? (
              <ToolRow
                key={part.id}
                tool={part}
                confirmations={confirmations}
                onDecided={onDecided}
              />
            ) : part.type === "reasoning" ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: parts are an ordered, immutable list.
              <details key={index} className="text-ink/60 text-xs">
                <summary className="press cursor-pointer">Thinking</summary>
                <p className="mt-1 whitespace-pre-wrap">{part.text}</p>
              </details>
            ) : (
              <div
                key={part.requestId}
                className="outline-box rounded-sm bg-paper p-3"
              >
                <p className="eyebrow">The bank learned this</p>
                {part.prUrl?.startsWith("https://") ? (
                  <a
                    className="press text-xs underline"
                    href={part.prUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Pull request #{part.prNumber}
                  </a>
                ) : null}
                <button
                  type="button"
                  className="press ml-3 font-semibold text-xs underline"
                  onClick={() => openTab("growth")}
                >
                  See the growth rings
                </button>
              </div>
            ),
          )}
          {message.content ? <Markdown text={message.content} /> : null}
          {message.model ? (
            <p
              data-testid="bank-chat-usage"
              className="text-ink/60 text-xs tabular-nums"
            >
              {message.model} · {message.inputTokens ?? 0} in,{" "}
              {message.outputTokens ?? 0} out
              {message.costUsd !== null
                ? ` · $${message.costUsd.toFixed(4)}`
                : ""}
            </p>
          ) : null}
        </>
      )}
    </li>
  );
}

/** The Teller: one agent that reaches the bank only through the bank's MCP server. */
export function ChatTab() {
  const {
    customerId,
    sessionId: addressed,
    openTab,
    refresh,
    activeStaff,
  } = useBank();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [current, setCurrent] = useState<string | null>(addressed);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const end = useRef<HTMLDivElement | null>(null);

  const loadSessions = useCallback(async () => {
    try {
      setSessions((await chatApi.sessions()).sessions);
    } catch (caught) {
      setError(messageOf(caught));
    }
  }, []);
  const openId = useRef(current);
  openId.current = current;
  const [armed, setArmed] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const loadDetail = useCallback(async (id: string) => {
    try {
      const next = await chatApi.session(id);
      // An answer for a conversation that is no longer open is dropped.
      if (openId.current === id) setDetail(next);
      return next;
    } catch (caught) {
      setError(messageOf(caught));
      return null;
    }
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);
  useEffect(() => {
    setDetail(null);
    if (current) void loadDetail(current);
  }, [current, loadDetail]);

  // While a request waits for the person, keep its card current.
  const waiting =
    detail?.confirmations.some((item) => item.status === "pending") ?? false;
  useEffect(() => {
    if (!waiting || !current || live) return;
    const timer = setInterval(() => void loadDetail(current), 4000);
    return () => clearInterval(timer);
  }, [waiting, current, live, loadDetail]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when the conversation grows.
  useEffect(() => {
    // Never on the empty state: its first lines must stay in view on a phone.
    if (detail?.messages.length || live) {
      end.current?.scrollIntoView({ block: "end" });
    }
  }, [detail?.messages.length, live?.text, live?.tools.length]);

  const open = (id: string | null) => {
    setCurrent(id);
    setError(null);
    openTab("chat", { session: id });
  };

  const onDecided = useCallback(() => {
    if (current) void loadDetail(current);
    refresh();
  }, [current, loadDetail, refresh]);

  const send = async (message: string) => {
    const words = message.trim();
    if (!words || busy.current) return;
    busy.current = true;
    setError(null);
    setText("");
    setSent(words);
    setLive(EMPTY);
    try {
      let id = current;
      if (!id) {
        const made = await createSessionAction(customerId);
        if (!made.ok) throw new Error(made.error);
        id = made.session.id;
        setSessions((before) => [made.session, ...before]);
        openId.current = id;
        setCurrent(id);
        openTab("chat", { session: id });
      }
      abort.current = new AbortController();
      const onEvent = (event: ChatEvent) =>
        setLive((before) => {
          const now = before ?? EMPTY;
          switch (event.type) {
            case "text.delta":
              return { ...now, text: now.text + event.text };
            case "reasoning.delta":
              return { ...now, reasoning: now.reasoning + event.text };
            case "tool.started":
              return {
                ...now,
                tools: [
                  ...now.tools,
                  {
                    type: "tool",
                    id: event.id,
                    name: event.name,
                    args: event.args,
                    ok: true,
                    summary: "",
                    data: null,
                    running: true,
                  },
                ],
              };
            case "tool.finished":
              return {
                ...now,
                tools: now.tools.map((tool) =>
                  tool.id === event.id
                    ? {
                        ...tool,
                        ok: event.ok,
                        summary: event.summary,
                        data: event.data,
                        running: false,
                      }
                    : tool,
                ),
              };
            case "usage":
              return {
                ...now,
                usage: `${event.model} · ${event.inputTokens} in, ${event.outputTokens} out${event.costUsd !== null ? ` · $${event.costUsd.toFixed(4)}` : ""}`,
              };
            case "error":
              setError(event.message);
              return now;
            default:
              return now;
          }
        });
      await chatApi.send(id, words, onEvent, { signal: abort.current.signal });
      await loadDetail(id);
      void loadSessions();
      refresh();
    } catch (caught) {
      if (!abort.current?.signal.aborted) setError(messageOf(caught));
      if (current) await loadDetail(current);
    } finally {
      busy.current = false;
      abort.current = null;
      setLive(null);
      setSent(null);
    }
  };

  const remove = async (id: string) => {
    if (removing) return;
    setRemoving(id);
    try {
      const done = await deleteSessionAction(id);
      if (!done.ok) return setError(done.error);
      setSessions((before) => before.filter((item) => item.id !== id));
      if (current === id) open(null);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setRemoving(null);
      setArmed(null);
    }
  };

  const confirmations = detail?.confirmations ?? [];
  const messages = detail?.messages ?? [];
  const pendingCount = confirmations.filter(
    (item) => item.status === "pending",
  ).length;
  const empty = !current || (detail !== null && messages.length === 0 && !live);

  return (
    <div className="flex h-full min-h-0">
      <aside className="hidden w-64 shrink-0 flex-col gap-2 overflow-y-auto border-ink border-r-2 p-3 md:flex">
        <Button
          data-testid="bank-chat-new"
          disabled={Boolean(live)}
          variant="secondary"
          onClick={() => open(null)}
        >
          New conversation
        </Button>
        <ul data-testid="bank-chat-sessions" className="flex flex-col gap-1.5">
          {sessions.map((session) => (
            <li key={session.id} className="flex items-stretch gap-1">
              <button
                type="button"
                onClick={() => open(session.id)}
                // Not while a reply streams: it would draw into the other conversation.
                disabled={Boolean(live)}
                aria-current={session.id === current}
                className={`outline-box press min-w-0 flex-1 truncate rounded-sm px-2 py-1.5 text-left text-xs ${session.id === current ? "bg-ink text-paper" : "bg-paper"}`}
              >
                {session.title}
              </button>
              <button
                type="button"
                aria-label={
                  armed === session.id
                    ? `Confirm deleting ${session.title}`
                    : `Delete ${session.title}`
                }
                aria-busy={removing === session.id}
                disabled={Boolean(live) || removing !== null}
                className="press px-1 text-ink/60 text-xs disabled:opacity-40"
                onBlur={() => setArmed(null)}
                onClick={() =>
                  // Two clicks: the first asks, the second deletes.
                  armed === session.id
                    ? void remove(session.id)
                    : setArmed(session.id)
                }
              >
                {removing === session.id
                  ? "…"
                  : armed === session.id
                    ? "Delete?"
                    : "×"}
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-ink border-b-2 bg-paper px-3 py-2 text-xs sm:px-5">
          <span className="font-semibold text-sm">
            {detail?.session.title ?? "The Teller"}
          </span>
          <span className="text-ink/70">
            Asking as {activeStaff.name}. The Teller can ask; you confirm.
          </span>
          <button
            type="button"
            className="press ml-auto underline md:hidden"
            onClick={() => open(null)}
          >
            New
          </button>
        </div>
        <div className="tb-scroll min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-3 py-5 sm:px-5">
            {empty ? (
              <div className="flex flex-col gap-3">
                <p className="eyebrow">One agent, one MCP server</p>
                <p className="text-sm">
                  The Teller reaches the bank only through the bank's MCP
                  server: the same commands as the app, the same Rules and
                  limits. It can read anything and ask for anything. A sensitive
                  change waits for your click. If the bank cannot do what you
                  ask, say so: the Teller raises it and the bank builds it.
                </p>
                <div className="flex flex-wrap gap-2">
                  {EXAMPLES.map((example) => (
                    <button
                      key={example}
                      type="button"
                      data-testid="bank-chat-example"
                      className="outline-box press rounded-sm bg-paper px-2.5 py-1.5 text-left text-xs"
                      onClick={() => void send(example)}
                    >
                      {example}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <ul
              data-testid="bank-chat-messages"
              className="flex flex-col gap-4"
              aria-busy={Boolean(live)}
            >
              {messages.map((message) => (
                <Message
                  key={message.id}
                  message={message}
                  confirmations={confirmations}
                  onDecided={onDecided}
                />
              ))}
              {live &&
              sent &&
              !messages.some(
                (message) =>
                  message.role === "person" &&
                  message.content === sent &&
                  message === messages.at(-1),
              ) ? (
                <li className="outline-box ml-auto max-w-[85%] rounded-sm bg-ink px-3 py-2 text-paper text-sm">
                  {sent}
                </li>
              ) : null}
              {live ? (
                <li className="flex flex-col gap-2 text-sm" aria-live="polite">
                  {live.reasoning ? (
                    <p className="whitespace-pre-wrap text-ink/60 text-xs">
                      {live.reasoning.slice(-400)}
                    </p>
                  ) : null}
                  {live.tools.map((tool) => (
                    <ToolRow
                      key={tool.id}
                      tool={tool}
                      running={tool.running}
                      confirmations={confirmations}
                      onDecided={onDecided}
                    />
                  ))}
                  {live.text ? (
                    <Markdown text={live.text} />
                  ) : live.tools.length === 0 ? (
                    <Spinner />
                  ) : null}
                  {live.usage ? (
                    <p className="text-ink/60 text-xs">{live.usage}</p>
                  ) : null}
                </li>
              ) : null}
            </ul>
            <div ref={end} />
          </div>
        </div>
        <div className="border-ink border-t-2 bg-paper p-3">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
            {pendingCount > 0 ? (
              <p className="font-semibold text-xs">
                {pendingCount} request{pendingCount === 1 ? "" : "s"} waiting
                for your confirmation above.
              </p>
            ) : null}
            {error ? <ErrorNote>{error}</ErrorNote> : null}
            <div className="flex items-end gap-2">
              <textarea
                data-testid="bank-chat-input"
                aria-label="Message the Teller"
                className={`${inputClass} min-h-12 flex-1 resize-none`}
                rows={2}
                maxLength={LIMITS.messageChars}
                placeholder="Ask the Teller to do anything the bank can do"
                value={text}
                disabled={Boolean(live)}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send(text);
                  }
                }}
              />
              {live ? (
                <Button
                  data-testid="bank-chat-stop"
                  variant="secondary"
                  onClick={() => abort.current?.abort()}
                >
                  Stop
                </Button>
              ) : (
                <Button
                  data-testid="bank-chat-send"
                  disabled={!text.trim()}
                  onClick={() => void send(text)}
                >
                  Send
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
