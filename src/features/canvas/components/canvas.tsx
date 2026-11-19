"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DemoBar, demoBarControlClass } from "@/components/demo/demo-bar";
import "./canvas.css";
import {
  API,
  type CatalogTableInfo,
  type ConversationListResponse,
  type ConversationResponse,
  type RulesResponse,
} from "../domain/api";
import {
  type ChatEvent,
  type ConversationSummary,
  type Message,
  type MessagePart,
  type MessageUsage,
  partsOf,
} from "../domain/chat";
import { LIMITS } from "../domain/limits";
import type { ViewPayload } from "../domain/payload";
import { deleteConversationAction } from "../server/actions";
import { ask, getJson } from "./api";
import { ConnectPanel } from "./connect-panel";
import { DataPanel } from "./data-panel";
import { RulesPanel } from "./rules-panel";
import { Explainer, Working } from "./stage";
import { Badge, Button, cx, inputClass, Panel } from "./ui";
import { UnderTheHood } from "./under-the-hood";
import { type BridgeLog, ViewFrame } from "./view-frame";

const TABS = [
  { id: "ask", label: "Ask" },
  { id: "data", label: "Data" },
  { id: "rules", label: "Rules" },
  { id: "hood", label: "Under the hood" },
  { id: "connect", label: "Connect" },
] as const;
type TabId = (typeof TABS)[number]["id"];

/** Starter Questions; each tends to come back as a different kind of View. */
const STARTERS = [
  {
    kind: "Line",
    text: "What did the February heatwave do to daily peak electricity load in the northern regions? Let me change the region.",
  },
  {
    kind: "Bar",
    text: "Which rail lines carried more passengers during the ferry strike of 14 to 16 May, compared with a normal week?",
  },
  {
    kind: "Table",
    text: "In which municipalities does the reported budget total not match the sum of its lines? Show the gap by fiscal year.",
  },
  {
    kind: "Stat",
    text: "Give me the headline numbers for card spend at Corvane Savings Bank branches in December against November.",
  },
];

type Turn = {
  question: string;
  events: ChatEvent[];
  usage: Omit<MessageUsage, "type"> | null;
  running: boolean;
  error: string | null;
};

const money = (value: number | null | undefined) =>
  value == null ? "–" : `$${value.toFixed(value < 0.01 ? 4 : 3)}`;

function ToolChip({ part }: { part: Extract<MessagePart, { type: "tool" }> }) {
  return (
    <details className="group border-ink/25 border-l-2 pl-2 text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-2 py-0.5">
        <span
          className={cx(
            "size-1.5 shrink-0",
            part.ok
              ? "bg-ivy"
              : part.ms === 0
                ? "animate-pulse bg-brass"
                : "bg-seal-red",
          )}
        />
        <span className="font-mono font-bold">{part.name}</span>
        <span className="min-w-0 flex-1 truncate text-ink-muted">
          {part.summary === "Did not finish" && part.ms === 0
            ? "running…"
            : part.summary}
        </span>
        {part.ms > 0 ? (
          <span className="shrink-0 font-mono text-[0.65rem] text-ink-muted">
            {part.ms} ms
          </span>
        ) : null}
      </summary>
      <pre className="mt-1 max-h-56 overflow-auto bg-marble p-2 font-mono text-[0.68rem] whitespace-pre-wrap">
        {typeof part.args.sql === "string"
          ? part.args.sql
          : JSON.stringify(part.args, null, 2)}
      </pre>
    </details>
  );
}

function Parts({ parts }: { parts: MessagePart[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      {parts.map((part, index) => {
        // biome-ignore lint/suspicious/noArrayIndexKey: parts are append-only within a turn.
        const key = index;
        if (part.type === "text")
          return (
            <p
              key={key}
              className="text-sm leading-relaxed whitespace-pre-wrap"
            >
              {part.text}
            </p>
          );
        if (part.type === "reasoning")
          return (
            <details key={key} className="text-xs text-ink-muted">
              <summary className="cursor-pointer font-mono uppercase">
                Thinking
              </summary>
              <p className="mt-1 whitespace-pre-wrap">{part.text}</p>
            </details>
          );
        if (part.type === "tool") return <ToolChip key={key} part={part} />;
        if (part.type === "skill")
          return (
            <p
              key={key}
              className="font-mono text-[0.68rem] text-ink-muted uppercase"
            >
              Skill loaded: {part.name}
            </p>
          );
        if (part.type === "notice")
          return (
            <p key={key} className="text-xs font-semibold text-seal-red">
              {part.text}
            </p>
          );
        return null;
      })}
    </div>
  );
}

export function Canvas({
  catalog,
  initialConversations,
  initialRules,
  stub = false,
}: {
  catalog: CatalogTableInfo[];
  initialConversations: ConversationSummary[] | null;
  initialRules: RulesResponse | null;
  /** The e2e suite's scripted Analyst (honoured by the server only with the bypass token). */
  stub?: boolean;
}) {
  const [tab, setTab] = useState<TabId>("ask");
  const [conversations, setConversations] = useState(
    initialConversations ?? [],
  );
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [views, setViews] = useState<ViewPayload[]>([]);
  const [turn, setTurn] = useState<Turn | null>(null);
  const [building, setBuilding] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [bridge, setBridge] = useState<BridgeLog[]>([]);
  const [deleting, setDeleting] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const canvasEnd = useRef<HTMLDivElement>(null);
  const threadEnd = useRef<HTMLDivElement>(null);

  const upsertViews = useCallback((incoming: ViewPayload[]) => {
    setViews((current) => {
      const next = [...current];
      for (const payload of incoming) {
        const at = next.findIndex((item) => item.view.id === payload.view.id);
        if (at < 0) next.push(payload);
        else if (payload.view.revision >= next[at].view.revision)
          next[at] = payload;
      }
      return next;
    });
  }, []);

  const onLog = useCallback(
    (entry: BridgeLog) =>
      setBridge((current) => [...current.slice(-199), entry]),
    [],
  );

  const refreshConversations = useCallback(async () => {
    try {
      const list = await getJson<ConversationListResponse>(API.conversations);
      setConversations(list.conversations);
    } catch {
      // The list is a convenience; the open Conversation is unaffected.
    }
  }, []);

  useEffect(() => {
    if (initialConversations === null) void refreshConversations();
  }, [initialConversations, refreshConversations]);

  const open = async (id: string | null) => {
    abort.current?.abort();
    setTurn(null);
    setBuilding(null);
    setLoadError(null);
    setConversationId(id);
    setMessages([]);
    setViews([]);
    if (!id) return;
    try {
      const loaded = await getJson<ConversationResponse>(API.conversation(id));
      setMessages(loaded.messages);
      setViews(loaded.views);
    } catch (error) {
      setLoadError((error as Error).message);
    }
  };

  const send = async (question: string) => {
    const asked = question.trim();
    if (!asked || turn?.running) return;
    setText("");
    setTab("ask");
    const controller = new AbortController();
    abort.current = controller;
    // The turn before this one joins the saved messages above it.
    if (turn) {
      const at = new Date().toISOString();
      const id = `local-${messages.length}`;
      setMessages((current) => [
        ...current,
        {
          id: `${id}-q`,
          role: "person",
          content: turn.question,
          parts: [],
          usage: null,
          createdAt: at,
        },
        {
          id: `${id}-a`,
          role: "analyst",
          content: "",
          parts: partsOf(turn.events),
          usage: turn.usage,
          createdAt: at,
        },
      ]);
    }
    const live: Turn = {
      question: asked,
      events: [],
      usage: null,
      running: true,
      error: null,
    };
    setTurn(live);
    let filedIn = conversationId;
    try {
      await ask(
        { text: asked, conversationId, stub },
        (event) => {
          if (event.type === "question") {
            filedIn = event.conversationId;
            setConversationId(event.conversationId);
          } else if (event.type === "tool.building") {
            if (event.name === "create_view") setBuilding(event.title ?? "…");
          } else if (event.type === "view") {
            setBuilding(null);
            upsertViews([event.payload]);
            requestAnimationFrame(() =>
              canvasEnd.current?.scrollIntoView({
                behavior: "smooth",
                block: "end",
              }),
            );
          } else if (event.type === "usage") {
            const { type: _type, ...usage } = event;
            live.usage = usage;
          } else if (event.type === "error") {
            live.error = event.message;
          }
          if (event.type === "tool.finished") setBuilding(null);
          live.events = [...live.events, event];
          setTurn({ ...live });
        },
        controller.signal,
      );
    } catch (error) {
      if (!controller.signal.aborted) live.error = (error as Error).message;
    }
    setBuilding(null);
    setTurn({ ...live, running: false });
    void refreshConversations();
    void filedIn;
  };

  const remove = async () => {
    if (!conversationId || deleting) return;
    if (
      !window.confirm(
        "Delete this Conversation and its Views? This cannot be undone.",
      )
    )
      return;
    setDeleting(true);
    const result = await deleteConversationAction(conversationId);
    setDeleting(false);
    if (!result.ok) {
      setLoadError(result.error);
      return;
    }
    await open(null);
    void refreshConversations();
  };

  const liveParts = useMemo(() => (turn ? partsOf(turn.events) : []), [turn]);
  // Follow the newest event, unless the person scrolled up to read.
  useEffect(() => {
    const thread = threadEnd.current;
    if (!thread || !turn) return;
    const fromBottom =
      thread.scrollHeight - thread.scrollTop - thread.clientHeight;
    if (fromBottom < 160) thread.scrollTop = thread.scrollHeight;
  }, [turn]);
  const empty = messages.length === 0 && !turn;
  const lastUsage =
    turn?.usage ??
    [...messages].reverse().find((message) => message.usage)?.usage ??
    null;

  return (
    <div className="flex min-h-dvh flex-col bg-marble">
      <DemoBar
        slug="canvas"
        name="Canvas"
        current={tab}
        panelsId="cv"
        tabs={TABS.map((item) => ({
          id: item.id,
          label: item.label,
          testId: `canvas-tab-${item.id}`,
          onSelect: () => setTab(item.id),
        }))}
      >
        <button
          type="button"
          className={demoBarControlClass}
          onClick={() => void open(null)}
        >
          New Conversation
        </button>
      </DemoBar>

      <main className="mx-auto w-full max-w-[1500px] flex-1 px-3 py-4 sm:px-5 sm:py-6">
        <div
          hidden={tab !== "ask"}
          className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]"
        >
          <Panel
            eyebrow="The Analyst"
            title={
              conversations.find((item) => item.id === conversationId)?.title ??
              "New Conversation"
            }
            bodyClassName="flex min-h-0 flex-1 flex-col"
            className="flex min-h-[24rem] min-w-0 flex-col overflow-hidden xl:sticky xl:top-4 xl:h-[calc(100dvh-7rem)]"
            actions={
              conversationId ? (
                <Button
                  size="sm"
                  variant="ghost"
                  pending={deleting}
                  pendingLabel="Deleting…"
                  onClick={remove}
                >
                  Delete
                </Button>
              ) : null
            }
          >
            <div className="flex min-h-0 flex-1 flex-col">
              {conversations.length > 0 ? (
                <label className="flex items-center gap-2 border-ink/20 border-b px-4 py-2 text-xs">
                  <span className="eyebrow shrink-0 text-ink-muted">Open</span>
                  <select
                    className={cx(inputClass, "h-8 py-0 text-xs")}
                    value={conversationId ?? ""}
                    onChange={(event) => void open(event.target.value || null)}
                  >
                    <option value="">New Conversation</option>
                    {conversations.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title} ({item.views})
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <div
                ref={threadEnd}
                className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 [overflow-wrap:anywhere]"
                data-testid="thread"
              >
                {empty ? (
                  <div className="space-y-3">
                    <p className="text-sm leading-relaxed">
                      Ask about the open data of the fictional Republic of
                      Meridia: a year of grid load, weather, air quality, ferry
                      and rail ridership, harbour calls, municipal budgets, a
                      household survey and a bank&apos;s card spend. About a
                      million rows, answered with a chart you can adjust and
                      check.
                    </p>
                    <ul className="space-y-2">
                      {STARTERS.map((starter) => (
                        <li key={starter.kind}>
                          <button
                            type="button"
                            onClick={() => void send(starter.text)}
                            className="outline-box press flex w-full items-start gap-2 rounded-sm bg-paper p-2.5 text-left text-sm"
                          >
                            <Badge tone="blue">{starter.kind}</Badge>
                            <span>{starter.text}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {loadError ? (
                  <p role="alert" className="text-sm text-seal-red">
                    {loadError}
                  </p>
                ) : null}
                {messages.map((message) =>
                  message.role === "person" ? (
                    <p
                      key={message.id}
                      className="outline-box rounded-sm bg-morning-haze p-2.5 text-sm font-medium"
                    >
                      {message.content}
                    </p>
                  ) : (
                    <Parts key={message.id} parts={message.parts} />
                  ),
                )}
                {turn ? (
                  <>
                    <p className="outline-box rounded-sm bg-morning-haze p-2.5 text-sm font-medium">
                      {turn.question}
                    </p>
                    <Parts parts={liveParts} />
                    {turn.running ? (
                      <p
                        className="flex items-center gap-2 font-mono text-[0.68rem] text-ink-muted uppercase"
                        aria-live="polite"
                      >
                        <span className="size-1.5 animate-pulse bg-federal-blue" />
                        {building
                          ? `Building View: ${building}`
                          : "The Analyst is working"}
                      </p>
                    ) : null}
                    {turn.error ? (
                      <p
                        role="alert"
                        className="text-sm font-semibold text-seal-red"
                      >
                        {turn.error}
                      </p>
                    ) : null}
                  </>
                ) : null}
              </div>
              {lastUsage ? (
                <p
                  className="border-ink/20 border-t px-4 py-1.5 font-mono text-[0.65rem] text-ink-muted"
                  data-testid="usage"
                >
                  {lastUsage.model} · {lastUsage.turns} turns ·{" "}
                  {lastUsage.inputTokens.toLocaleString("en")} in /{" "}
                  {lastUsage.outputTokens.toLocaleString("en")} out ·{" "}
                  {money(lastUsage.costUsd)} · sandbox{" "}
                  {(lastUsage.sandboxMs / 1000).toFixed(1)} s
                </p>
              ) : null}
              <form
                className="flex items-end gap-2 border-ink border-t-2 p-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void send(text);
                }}
              >
                <textarea
                  aria-label="Your Question"
                  className={cx(inputClass, "min-h-11 flex-1 resize-none")}
                  rows={2}
                  maxLength={LIMITS.questionChars}
                  placeholder="Ask about the data…"
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void send(text);
                    }
                  }}
                />
                {turn?.running ? (
                  <Button
                    variant="danger"
                    onClick={() => abort.current?.abort()}
                  >
                    Stop
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={!text.trim()}
                  >
                    Ask
                  </Button>
                )}
              </form>
            </div>
          </Panel>

          <section
            aria-label="Views"
            className="flex min-w-0 flex-col gap-5"
            data-testid="views"
          >
            {views.length === 0 && !turn?.running ? (
              <Explainer
                onTry={empty ? () => void send(STARTERS[0].text) : undefined}
              />
            ) : null}
            {views.map((payload) => (
              <ViewFrame
                key={payload.view.id}
                payload={payload}
                onLinked={upsertViews}
                onLog={onLog}
              />
            ))}
            {turn?.running ? (
              <Working
                parts={liveParts}
                building={building}
                compact={views.length > 0 && !building}
              />
            ) : null}
            <div ref={canvasEnd} />
          </section>
        </div>

        {tab === "data" ? <DataPanel catalog={catalog} /> : null}
        {tab === "rules" ? <RulesPanel initial={initialRules} /> : null}
        {tab === "hood" ? (
          <UnderTheHood
            conversationId={conversationId}
            bridge={bridge}
            usage={lastUsage}
          />
        ) : null}
        {tab === "connect" ? <ConnectPanel /> : null}
      </main>
    </div>
  );
}
