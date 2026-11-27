"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import {
  type FormEvent,
  Fragment,
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { CatalogCard } from "../domain/api";
import {
  type AssistantEvent,
  type CitedFact,
  MAX_MESSAGE_LENGTH,
  type Proposal,
  type ThreadMessage,
  type ThreadSummary,
  type TrailStep,
  type Walk,
} from "../domain/chat";
import { handleOf, splitCitations } from "../domain/citations";
import { ROOT_KEY } from "../domain/graph";
import { describeStep } from "../domain/traversal";
import {
  ask as askDesk,
  createThread,
  decideProposal,
  keys,
  threadQuery,
} from "./api";
import { CertaintyDot } from "./certainty";
import { Icon, type IconName } from "./icons";
import { Portrait } from "./portrait";
import { MessagesSkeleton } from "./skeletons";

/**
 * The desk: a chat over the whole book, or one client. Answers walk the
 * graphs through the Client Manager MCP server; every fact they use is a
 * chip that opens it. With Research on, it searches the web and puts what it
 * found in a card to pick from.
 */

type Pending = {
  /** Null until the server has made the chat. */
  threadId: string | null;
  question: string;
  research: boolean;
  trail: TrailStep[];
  text: string;
  proposal: Proposal | null;
  buildId: string | null;
  cited: CitedFact[];
  messageId: string | null;
  done: boolean;
  error: string | null;
  startedAt: number;
};

const TOOL: Record<string, { icon: IconName; title: string }> = {
  list_clients: { icon: "people", title: "Clients" },
  client_profile: { icon: "profile", title: "Profile" },
  search: { icon: "search", title: "Search" },
  expand: { icon: "walk", title: "Walk" },
  connect: { icon: "link", title: "Connect" },
  browse_category: { icon: "branch", title: "Browse" },
  read_facts: { icon: "read", title: "Read" },
  list_documents: { icon: "doc", title: "Documents" },
  read_document: { icon: "doc", title: "Document" },
  research_brief: { icon: "spark", title: "Brief" },
  add_facts: { icon: "add", title: "Add" },
  build_status: { icon: "spark", title: "Build" },
  web_search: { icon: "globe", title: "Web" },
  propose_facts: { icon: "check", title: "Findings" },
};

const GENERAL = [
  "Who has a liquidity event coming up?",
  "Which clients need an estate plan review?",
  "Who should I call this week, and why?",
  "Compare risk appetite across my book",
];

export function Chat({
  threadId,
  initialThread = null,
  loadedAt = 0,
  scope,
  cards,
  seed,
  onScope,
  onThreadCreated,
  onOpenFact,
  onOpenClient,
  onShowWalk,
}: {
  threadId: string | null;
  /** The page's server read of this Thread, when it opened on it. */
  initialThread?: {
    thread: ThreadSummary;
    messages: ThreadMessage[];
  } | null;
  loadedAt?: number;
  scope: string | null;
  cards: CatalogCard[];
  /** A question handed in from elsewhere (a client's "Ask"), asked once. */
  seed: { id: number; text: string; research: boolean } | null;
  onScope: (clientId: string | null) => void;
  onThreadCreated: (thread: ThreadSummary) => void;
  onOpenFact: (clientId: string, key: string) => void;
  onOpenClient: (clientId: string) => void;
  onShowWalk: (clientId: string, walks: Walk[]) => void;
}) {
  const queryClient = useQueryClient();
  const thread = useQuery({
    ...threadQuery(threadId ?? "none"),
    enabled: !!threadId,
    ...(initialThread
      ? { initialData: initialThread, initialDataUpdatedAt: loadedAt }
      : {}),
  });
  const messages = threadId ? (thread.data?.messages ?? []) : [];
  const [pending, setPending] = useState<Pending | null>(null);
  const [research, setResearch] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const scoped = cards.find((card) => card.id === scope) ?? null;
  // A question in a chat that doesn't exist yet shows at once; it moves to
  // the new chat's id the moment the server makes it.
  const showPending = pending && pending.threadId === threadId ? pending : null;
  const busy = !!showPending && !showPending.done;

  const handleClient = useCallback(
    (handle: string | null) =>
      handle
        ? cards.find((card) => handleOf(card.id) === handle)
        : (scoped ?? undefined),
    [cards, scoped],
  );

  // Follow the answer as it grows, unless the person scrolled up to read.
  const pinned = useRef(true);
  const tail = `${messages.length}-${showPending?.text.length ?? 0}-${showPending?.trail.length ?? 0}-${!!showPending?.proposal}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: follow new and growing messages
  useEffect(() => {
    const element = list.current;
    if (!element || !pinned.current) return;
    element.scrollTo({
      top: element.scrollHeight,
      behavior: busy ? "auto" : "smooth",
    });
  }, [tail]);

  const askOnce = useCallback(
    async (question: string, asResearch: boolean) => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      pinned.current = true;
      let id = threadId;
      // The question is on screen before any request goes out.
      let current: Pending = {
        threadId: id,
        question,
        research: asResearch,
        trail: [],
        text: "",
        proposal: null,
        buildId: null,
        cited: [],
        messageId: null,
        done: false,
        error: null,
        startedAt: Date.now(),
      };
      setPending(current);
      // Tokens arrive faster than frames: draw at most once per frame.
      let frame = 0;
      const flush = () => {
        frame = 0;
        setPending(current);
      };
      const update = (patch: Partial<Pending>, now = false) => {
        current = { ...current, ...patch };
        if (now) {
          cancelAnimationFrame(frame);
          flush();
        } else if (!frame) {
          frame = requestAnimationFrame(flush);
        }
      };
      try {
        if (!id) {
          const created = await createThread({ clientId: scope });
          id = created.id;
          queryClient.setQueryData(keys.thread(id), {
            thread: created,
            messages: [],
          });
          update({ threadId: id }, true);
          onThreadCreated(created);
        }
        const onEvent = (event: AssistantEvent) => {
          switch (event.type) {
            case "thread":
              queryClient.setQueryData<ThreadSummary[]>(
                keys.threads,
                (threads) => [
                  event.thread,
                  ...(threads ?? []).filter(
                    (item) => item.id !== event.thread.id,
                  ),
                ],
              );
              break;
            case "tool":
              update({
                trail: [
                  ...current.trail,
                  {
                    callId: event.callId,
                    tool: event.name,
                    input: event.input,
                  },
                ],
              });
              break;
            case "tool-result":
              update({
                trail: current.trail.map((step) =>
                  step.callId === event.callId
                    ? {
                        ...step,
                        ok: event.ok,
                        summary: event.summary,
                        walks: event.walks,
                        web: event.web,
                      }
                    : step,
                ),
              });
              break;
            case "text":
              update({ text: current.text + event.delta });
              break;
            case "proposal":
              update({ proposal: event.proposal });
              break;
            case "build":
              update({ buildId: event.buildId });
              void queryClient.invalidateQueries({
                queryKey: keys.client(event.clientId),
              });
              void queryClient.invalidateQueries({ queryKey: keys.catalog });
              break;
            case "error":
              update({ error: event.message });
              break;
            case "done":
              update({ cited: event.cited, messageId: event.messageId });
              break;
          }
        };
        await askDesk(id, { text: question, research: asResearch }, onEvent, {
          signal: controller.signal,
        });
        update({ done: true }, true);
      } catch (failure) {
        update(
          {
            done: true,
            error: controller.signal.aborted
              ? "Stopped."
              : failure instanceof Error
                ? failure.message
                : "Something went wrong.",
          },
          true,
        );
      }
      if (!id) return;
      const finished = current;
      if (!finished.error && finished.messageId) {
        // Hand the finished turn to the thread as it is, in the same frame
        // the live one goes away: no refetch, no flicker. The refetch after
        // only fills in what the server saved.
        const at = new Date(finished.startedAt).toISOString();
        queryClient.setQueryData<{
          thread: ThreadSummary;
          messages: ThreadMessage[];
        }>(keys.thread(id), (data) =>
          data
            ? {
                ...data,
                messages: [
                  ...data.messages,
                  {
                    id: `${finished.messageId}-q`,
                    role: "user",
                    content: finished.question,
                    research: finished.research,
                    trail: [],
                    cited: [],
                    proposal: null,
                    buildId: null,
                    clientId: scope,
                    createdAt: at,
                  },
                  {
                    id: finished.messageId as string,
                    role: "assistant",
                    content: finished.text,
                    research: finished.research,
                    trail: finished.trail,
                    cited: finished.cited,
                    proposal: finished.proposal,
                    buildId: finished.buildId,
                    clientId: scope,
                    createdAt: at,
                  },
                ],
              }
            : data,
        );
        setPending((value) => (value === finished ? null : value));
      }
      void queryClient.invalidateQueries({ queryKey: keys.thread(id) });
      void queryClient.invalidateQueries({ queryKey: keys.threads });
    },
    [onThreadCreated, queryClient, scope, threadId],
  );

  // Set before the first await, so a double click or a double Enter cannot
  // send the question twice before `busy` re-renders.
  const asking = useRef(false);
  const ask = useCallback(
    async (text: string, asResearch: boolean) => {
      const question = text.trim();
      if (!question || busy || asking.current) return;
      asking.current = true;
      try {
        await askOnce(question, asResearch);
      } finally {
        asking.current = false;
      }
    },
    [busy, askOnce],
  );

  // A question handed in from a client's dashboard or a suggestion.
  const seen = useRef<number | null>(null);
  useEffect(() => {
    if (!seed || seen.current === seed.id) return;
    seen.current = seed.id;
    if (seed.research) setResearch(true);
    if (seed.text) void ask(seed.text, seed.research);
  }, [seed, ask]);

  const stop = useCallback(() => abort.current?.abort(), []);
  useEffect(() => {
    if (!busy) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      stop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, stop]);

  // Opening a Thread whose messages are not here yet: its shape, not the
  // empty "ask about your book" screen.
  const opening = !!threadId && thread.isPending && !showPending;
  const empty = messages.length === 0 && !showPending && !opening;
  const suggestions = scoped?.persona?.questions?.length
    ? scoped.persona.questions.slice(0, 4)
    : GENERAL;

  const factProps = { handleClient, onOpenFact };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-ink border-b-2 bg-paper px-4 py-2">
        <ScopePicker
          cards={cards}
          scope={scope}
          onScope={onScope}
          locked={busy}
        />
        {thread.data?.thread.title && threadId ? (
          <p className="min-w-0 flex-1 truncate text-right font-mono text-xs font-bold text-ink-muted uppercase">
            {thread.data.thread.title}
          </p>
        ) : null}
      </div>

      <div
        ref={list}
        onScroll={(event) => {
          const element = event.currentTarget;
          pinned.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            120;
        }}
        className="cm-scroll min-h-0 flex-1 overflow-y-auto"
      >
        {opening ? (
          <MessagesSkeleton />
        ) : empty ? (
          <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center gap-6 px-6 py-10 text-center">
            {scoped ? (
              <Portrait name={scoped.name} url={scoped.portraitUrl} size="md" />
            ) : (
              <span className="flex -space-x-3">
                {cards.slice(0, 4).map((card) => (
                  <Portrait
                    key={card.id}
                    name={card.name}
                    url={card.portraitUrl}
                    size="sm"
                  />
                ))}
              </span>
            )}
            <h2 className="font-mono text-2xl leading-tight font-bold uppercase sm:text-3xl">
              {scoped
                ? `What do you want to know about ${scoped.name.split(" ")[0]}?`
                : "Ask about your book"}
            </h2>
            <div className="flex flex-wrap justify-center gap-2">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={busy}
                  onClick={() => void ask(suggestion, false)}
                  className="outline-box press rounded-sm bg-paper px-3 py-1.5 text-sm hover:bg-morning-haze disabled:opacity-50"
                >
                  {suggestion}
                </button>
              ))}
              {scoped && !scoped.isSample ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void ask(`Research ${scoped.name}`, true)}
                  className="outline-box press flex items-center gap-1.5 rounded-sm bg-morning-haze px-3 py-1.5 text-sm text-federal-blue disabled:opacity-50"
                >
                  <Icon name="globe" className="size-3.5" />
                  Research {scoped.name.split(" ")[0]} on the web
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6">
            {messages.map((message) =>
              message.role === "user" ? (
                <UserBubble
                  key={message.id}
                  text={message.content}
                  research={message.research}
                />
              ) : (
                <AnswerBlock
                  key={message.id}
                  text={message.content}
                  trail={message.trail}
                  cited={message.cited}
                  proposal={message.proposal}
                  messageId={message.id}
                  threadId={threadId}
                  cards={cards}
                  done
                  onOpenClient={onOpenClient}
                  onShowWalk={onShowWalk}
                  {...factProps}
                />
              ),
            )}
            {showPending ? (
              <>
                <UserBubble
                  text={showPending.question}
                  research={showPending.research}
                  live
                />
                <AnswerBlock
                  text={showPending.text}
                  trail={showPending.trail}
                  cited={showPending.cited}
                  proposal={showPending.proposal}
                  messageId={null}
                  threadId={threadId}
                  cards={cards}
                  done={showPending.done}
                  error={showPending.error}
                  startedAt={showPending.startedAt}
                  onOpenClient={onOpenClient}
                  onShowWalk={onShowWalk}
                  {...factProps}
                />
              </>
            ) : null}
          </div>
        )}
      </div>

      <Composer
        busy={busy}
        research={research}
        canResearch
        placeholder={
          scoped ? `Ask about ${scoped.name}…` : "Ask about any client…"
        }
        onResearch={setResearch}
        onSend={(text) => void ask(text, research)}
        onStop={stop}
      />
    </div>
  );
}

function ScopePicker({
  cards,
  scope,
  onScope,
  locked,
}: {
  cards: CatalogCard[];
  scope: string | null;
  onScope: (clientId: string | null) => void;
  locked: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const current = cards.find((card) => card.id === scope);
  const visible = cards.filter((card) =>
    card.name.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  return (
    <div className="relative">
      <button
        type="button"
        disabled={locked}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label="Which clients this chat asks about"
        className="outline-box press flex items-center gap-2 rounded-sm bg-paper py-1 pr-3 pl-1 text-sm font-medium disabled:opacity-60"
      >
        {current ? (
          <Portrait name={current.name} url={current.portraitUrl} size="xs" />
        ) : (
          <span className="flex size-7 items-center justify-center rounded-full bg-ink text-paper">
            <Icon name="people" className="size-3.5" />
          </span>
        )}
        {current?.name ?? "All clients"}
        <Icon
          name="chevron"
          className={`size-3 transition-transform ${open ? "-rotate-90" : "rotate-90"}`}
        />
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="outline-box absolute top-full left-0 z-30 mt-1.5 w-72 overflow-hidden rounded-sm bg-paper shadow-hard-md"
          >
            <input
              // biome-ignore lint/a11y/noAutofocus: the menu opens to type into
              autoFocus
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter clients"
              className="w-full border-ink border-b-2 px-3 py-2 text-sm focus:outline-none"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setOpen(false);
                }
              }}
            />
            <ul className="cm-scroll max-h-72 overflow-y-auto py-1">
              <li>
                <button
                  type="button"
                  onClick={() => {
                    onScope(null);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-morning-haze ${!scope ? "font-semibold" : ""}`}
                >
                  <span className="flex size-7 items-center justify-center rounded-full bg-ink text-paper">
                    <Icon name="people" className="size-3.5" />
                  </span>
                  All clients
                  {!scope ? (
                    <Icon name="check" className="ml-auto size-3.5" />
                  ) : null}
                </button>
              </li>
              {visible.map((card) => (
                <li key={card.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onScope(card.id);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-morning-haze ${scope === card.id ? "font-semibold" : ""}`}
                  >
                    <Portrait
                      name={card.name}
                      url={card.portraitUrl}
                      size="xs"
                    />
                    <span className="min-w-0 flex-1 truncate">{card.name}</span>
                    {scope === card.id ? (
                      <Icon name="check" className="size-3.5" />
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

const UserBubble = memo(function UserBubble({
  text,
  research,
  live = false,
}: {
  text: string;
  research: boolean;
  /** Only a question just sent slides in; saved ones are simply there. */
  live?: boolean;
}) {
  return (
    <motion.div
      initial={live ? { opacity: 0, y: 6 } : false}
      animate={{ opacity: 1, y: 0 }}
      className="flex justify-end"
    >
      <p className="outline-box max-w-[85%] rounded-sm bg-ink px-4 py-2.5 text-[0.95rem] whitespace-pre-wrap text-paper shadow-[3px_3px_0_var(--color-federal-blue)]">
        {research ? (
          <Icon
            name="globe"
            className="mr-1.5 inline size-3.5 align-[-2px] text-clear-sky"
          />
        ) : null}
        {text}
      </p>
    </motion.div>
  );
});

type FactProps = {
  handleClient: (handle: string | null) => CatalogCard | undefined;
  onOpenFact: (clientId: string, key: string) => void;
};

/** Memoized: while an answer streams, the finished ones above it do not re-render. */
const AnswerBlock = memo(function AnswerBlock({
  text,
  trail,
  cited,
  proposal,
  messageId,
  threadId,
  cards,
  done,
  error,
  startedAt,
  onOpenClient,
  onShowWalk,
  handleClient,
  onOpenFact,
}: {
  text: string;
  trail: TrailStep[];
  cited: CitedFact[];
  proposal: Proposal | null;
  messageId: string | null;
  threadId: string | null;
  cards: CatalogCard[];
  done: boolean;
  error?: string | null;
  startedAt?: number;
  onOpenClient: (clientId: string) => void;
  onShowWalk: (clientId: string, walks: Walk[]) => void;
} & FactProps) {
  const web = trail.flatMap((step) => step.web ?? []);
  const sources = [
    ...new Map(web.map((item) => [item.url, item])).values(),
  ].slice(0, 8);
  return (
    <motion.div
      initial={startedAt ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      className="space-y-3"
    >
      {trail.length > 0 ? (
        <Trail
          trail={trail}
          cards={cards}
          done={done}
          onShowWalk={onShowWalk}
        />
      ) : null}
      {text ? (
        <div
          className={`space-y-2 text-[0.95rem] leading-relaxed ${done ? "" : "cm-streaming"}`}
        >
          <Rich
            text={text}
            cited={cited}
            handleClient={handleClient}
            onOpenFact={onOpenFact}
          />
        </div>
      ) : !done ? (
        <Thinking since={startedAt ?? Date.now()} />
      ) : null}
      {sources.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {sources.map((item) => (
            <li key={item.url}>
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                title={item.title}
                className="flex max-w-56 items-center gap-1.5 rounded-sm border border-ink bg-paper px-2 py-0.5 font-mono text-[0.7rem] text-ink-muted hover:bg-morning-haze hover:text-federal-blue"
              >
                <Favicon url={item.url} />
                <span className="truncate">{domainOf(item.url)}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {proposal ? (
        <ProposalCard
          proposal={proposal}
          messageId={messageId}
          threadId={threadId}
          readOnly={
            cards.find((card) => card.id === proposal.clientId)?.isSample ??
            false
          }
          onOpenClient={onOpenClient}
        />
      ) : null}
      {error ? <p className="text-sm text-seal-red">{error}</p> : null}
    </motion.div>
  );
});

function Thinking({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <p className="flex items-center gap-2 font-mono text-xs text-ink-muted">
      <span className="cm-spin text-brass" aria-hidden="true">
        ✻
      </span>
      <span className="cm-text-shimmer">Thinking</span>
      <span>{Math.max(0, Math.round((now - since) / 1000))}s</span>
    </p>
  );
}

/** The tool calls behind an answer: a row of icons, unfolding to each step. */
function Trail({
  trail,
  cards,
  done,
  onShowWalk,
}: {
  trail: TrailStep[];
  cards: CatalogCard[];
  done: boolean;
  onShowWalk: (clientId: string, walks: Walk[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const walks = trail.flatMap((step) => step.walks ?? []);
  const clients = [...new Set(walks.map((walk) => walk.clientId))];
  return (
    <div className="text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex items-center gap-1.5 rounded-sm border border-ink bg-marble px-2 py-1 text-ink-muted hover:bg-paper hover:text-ink"
        >
          <Icon
            name="chevron"
            className={`size-3 transition-transform ${open ? "rotate-90" : ""}`}
          />
          {trail.map((step) => {
            const meta = TOOL[step.tool] ?? {
              icon: "spark" as IconName,
              title: step.tool,
            };
            const running = step.ok === undefined && !done;
            return (
              <span
                key={step.callId}
                title={meta.title}
                className={`flex size-5 items-center justify-center rounded-full ${step.ok === false ? "bg-seal-red/15 text-seal-red" : running ? "cm-pulse bg-brass/30 text-ink" : "bg-paper text-ink"}`}
              >
                <Icon name={meta.icon} className="size-3" />
              </span>
            );
          })}
        </button>
        {clients.map((clientId) => {
          const card = cards.find((item) => item.id === clientId);
          if (!card) return null;
          return (
            <button
              key={clientId}
              type="button"
              onClick={() =>
                onShowWalk(
                  clientId,
                  walks.filter((walk) => walk.clientId === clientId),
                )
              }
              title={`Show the walk on ${card.name}'s map`}
              className="flex items-center gap-1.5 rounded-sm border border-ink bg-paper py-0.5 pr-2 pl-0.5 text-xs text-ink-muted hover:bg-morning-haze hover:text-federal-blue"
            >
              <Portrait name={card.name} url={card.portraitUrl} size="xs" />
              <Icon name="map" className="size-3" />
            </button>
          );
        })}
      </div>
      <AnimatePresence>
        {open ? (
          <motion.ol
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="mt-2 space-y-1 overflow-hidden border-ink/10 border-l-2 pl-3"
          >
            {trail.map((step) => (
              <TrailLine key={step.callId} step={step} cards={cards} />
            ))}
          </motion.ol>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function TrailLine({ step, cards }: { step: TrailStep; cards: CatalogCard[] }) {
  const meta = TOOL[step.tool] ?? {
    icon: "spark" as IconName,
    title: step.tool,
  };
  const label = (key: string) =>
    key === ROOT_KEY
      ? "the client"
      : (key.split(":")[1]?.replace(/-/g, " ") ?? key);
  const walks = step.walks ?? [];
  const query = (step.input as { query?: string | string[] } | null)?.query;
  return (
    <li className="flex items-start gap-2 text-xs">
      <Icon
        name={meta.icon}
        className={`mt-0.5 size-3 ${step.ok === false ? "text-seal-red" : "text-ink-muted"}`}
      />
      <div className="min-w-0 flex-1">
        <span className="font-semibold">{meta.title}</span>{" "}
        {walks.length > 0 ? (
          <span className="text-ink-muted">
            {walks
              .map((walk) => {
                const card = cards.find((item) => item.id === walk.clientId);
                const line = describeStep(walk.step, label);
                return `${card && walks.length > 1 ? `${card.name}: ` : ""}${line.title}, ${line.detail}`;
              })
              .join(" · ")}
          </span>
        ) : query ? (
          <span className="text-ink-muted">
            “{Array.isArray(query) ? query.join("”, “") : query}”
          </span>
        ) : step.summary ? (
          <span className="text-ink-muted">{step.summary}</span>
        ) : null}
      </div>
    </li>
  );
}

const domainOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

function Favicon({ url }: { url: string }) {
  const domain = domainOf(url);
  return (
    <span className="flex size-3.5 shrink-0 items-center justify-center rounded-full bg-federal-blue font-mono text-[0.5rem] font-bold text-paper uppercase">
      {domain[0]}
    </span>
  );
}

/** Paragraphs, lists, bold, code, links and fact chips: what the answers use. */
function Rich({
  text,
  cited,
  handleClient,
  onOpenFact,
}: { text: string; cited: CitedFact[] } & FactProps) {
  const blocks: ReactNode[] = [];
  let items: { at: number; text: string }[] = [];
  const flush = (key: string) => {
    if (items.length === 0) return;
    blocks.push(
      <ul key={key} className="ml-5 list-disc space-y-1 marker:text-stone">
        {items.map((item) => (
          <li key={item.at}>
            {inline(
              item.text,
              `${key}-${item.at}`,
              cited,
              handleClient,
              onOpenFact,
            )}
          </li>
        ))}
      </ul>,
    );
    items = [];
  };
  // Keys are character offsets: an answer's text never reorders.
  let offset = 0;
  for (const line of text.split("\n")) {
    const at = offset;
    offset += line.length + 1;
    const bullet = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (bullet) {
      items.push({ at, text: bullet[1] ?? "" });
      continue;
    }
    flush(`l-${at}`);
    if (!line.trim()) continue;
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    blocks.push(
      heading ? (
        <p key={`p-${at}`} className="font-semibold">
          {inline(heading[1] ?? "", `h-${at}`, cited, handleClient, onOpenFact)}
        </p>
      ) : (
        <p key={`p-${at}`}>
          {inline(line, `p-${at}`, cited, handleClient, onOpenFact)}
        </p>
      ),
    );
  }
  flush("end");
  return <>{blocks}</>;
}

const INLINE =
  /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|https?:\/\/[^\s)]+)/g;

function inline(
  text: string,
  key: string,
  cited: CitedFact[],
  handleClient: FactProps["handleClient"],
  onOpenFact: FactProps["onOpenFact"],
): ReactNode {
  return splitCitations(text).map((part, index) => {
    const id = `${key}-${index}`;
    if (part.kind === "cite") {
      const card = handleClient(part.handle);
      const fact = cited.find(
        (item) => item.key === part.key && (!card || item.clientId === card.id),
      );
      return (
        <FactChip
          key={id}
          label={fact?.label ?? readable(part.key, card?.name)}
          client={card}
          onClick={card ? () => onOpenFact(card.id, part.key) : undefined}
        />
      );
    }
    return (
      <Fragment key={id}>
        {part.text.split(INLINE).map((piece, pieceIndex) => {
          const pieceId = `${id}-${pieceIndex}`;
          if (piece.startsWith("**") && piece.endsWith("**"))
            return <strong key={pieceId}>{piece.slice(2, -2)}</strong>;
          if (piece.startsWith("`") && piece.endsWith("`"))
            return (
              <code
                key={pieceId}
                className="rounded-[2px] bg-limestone/60 px-1 font-mono text-[0.88em]"
              >
                {piece.slice(1, -1)}
              </code>
            );
          const link = piece.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
          if (link || /^https?:\/\//.test(piece)) {
            const href = link?.[2] ?? piece;
            return (
              <a
                key={pieceId}
                href={href}
                target="_blank"
                rel="noreferrer"
                className="text-federal-blue underline decoration-federal-blue/30 underline-offset-2 hover:decoration-federal-blue"
              >
                {link?.[1] ?? domainOf(href)}
              </a>
            );
          }
          return <Fragment key={pieceId}>{piece}</Fragment>;
        })}
      </Fragment>
    );
  });
}

const readable = (key: string, clientName?: string) =>
  key === ROOT_KEY
    ? (clientName ?? "client")
    : (key.split(":")[1] ?? key)
        .replace(/-/g, " ")
        .replace(/^\w/, (char) => char.toUpperCase());

function FactChip({
  label,
  client,
  onClick,
}: {
  label: string;
  client: CatalogCard | undefined;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={client ? `${client.name} · open this fact` : label}
      className="mx-0.5 inline-flex max-w-[16rem] items-center gap-1 rounded-sm border border-federal-blue/40 bg-morning-haze/60 px-1.5 align-[1px] text-[0.72rem] leading-5 font-medium text-federal-blue hover:border-federal-blue hover:bg-morning-haze"
    >
      <span className="truncate">{label}</span>
    </button>
  );
}

function ProposalCard({
  proposal: initial,
  messageId,
  threadId,
  readOnly,
  onOpenClient,
}: {
  proposal: Proposal;
  messageId: string | null;
  threadId: string | null;
  readOnly: boolean;
  onOpenClient: (clientId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [proposal, setProposal] = useState(initial);
  useEffect(() => setProposal(initial), [initial]);
  const [picked, setPicked] = useState<Set<string>>(
    () =>
      new Set(
        initial.facts
          .filter((fact) => fact.certainty !== "low")
          .map((fact) => fact.id),
      ),
  );
  const [busy, setBusy] = useState<"add" | "dismiss" | null>(null);
  // Set at once, so a double click cannot send the decision twice.
  const deciding = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const open = proposal.status === "open";

  const decide = async (action: "add" | "dismiss") => {
    if (!messageId || !threadId || deciding.current) return;
    deciding.current = true;
    setBusy(action);
    setError(null);
    try {
      const { proposal: next } = await decideProposal(threadId, messageId, {
        action,
        factIds: [...picked],
      });
      setProposal(next);
      void queryClient.invalidateQueries({ queryKey: keys.thread(threadId) });
      if (action === "add") {
        void queryClient.invalidateQueries({
          queryKey: keys.client(proposal.clientId),
        });
        void queryClient.invalidateQueries({ queryKey: keys.catalog });
        onOpenClient(proposal.clientId);
      }
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "That didn't work.",
      );
    } finally {
      deciding.current = false;
      setBusy(null);
    }
  };

  return (
    <div
      className={`outline-box cm-reveal overflow-hidden rounded-sm bg-paper shadow-hard-md ${proposal.status === "dismissed" ? "opacity-60" : ""}`}
      data-testid="proposal-card"
    >
      <div className="flex items-center gap-2 border-ink border-b-2 px-3 py-2">
        <Icon name="globe" className="size-4 text-federal-blue" />
        <button
          type="button"
          onClick={() => onOpenClient(proposal.clientId)}
          className="min-w-0 flex-1 truncate text-left font-mono text-sm font-bold uppercase hover:underline"
        >
          {proposal.clientName}
        </button>
        <span className="font-mono text-xs text-stone">
          {open
            ? `${picked.size}/${proposal.facts.length}`
            : proposal.status === "added"
              ? `+${proposal.added.length}`
              : "×"}
        </span>
      </div>
      <ul className="divide-y divide-ink/10">
        {proposal.facts.map((fact) => {
          const chosen = open
            ? picked.has(fact.id)
            : proposal.added.includes(fact.id);
          return (
            <li key={fact.id}>
              <label
                className={`flex items-start gap-3 px-3 py-2.5 ${open ? "cursor-pointer hover:bg-marble/60" : ""} ${!open && !chosen ? "opacity-45" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={chosen}
                  disabled={!open || readOnly}
                  onChange={() =>
                    setPicked((set) => {
                      const next = new Set(set);
                      if (next.has(fact.id)) next.delete(fact.id);
                      else next.add(fact.id);
                      return next;
                    })
                  }
                  className="mt-1 size-4 shrink-0 accent-federal-blue"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm leading-snug">
                    {fact.text}
                  </span>
                  {fact.sourceUrl ? (
                    <a
                      href={fact.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(event) => event.stopPropagation()}
                      className="mt-1 inline-flex max-w-full items-center gap-1 text-xs text-ink-muted hover:text-federal-blue"
                    >
                      <Favicon url={fact.sourceUrl} />
                      <span className="truncate">
                        {fact.sourceTitle || domainOf(fact.sourceUrl)}
                      </span>
                    </a>
                  ) : null}
                </span>
                <CertaintyDot
                  certainty={fact.certainty}
                  className="mt-1 size-3"
                />
              </label>
            </li>
          );
        })}
      </ul>
      {open ? (
        <div className="flex items-center gap-2 border-ink border-t-2 bg-marble/50 px-3 py-2">
          {readOnly ? (
            <p className="text-xs text-ink-muted">Samples are read-only.</p>
          ) : (
            <button
              type="button"
              disabled={!!busy || picked.size === 0 || !messageId}
              aria-busy={busy === "add"}
              onClick={() => void decide("add")}
              className="outline-box press eyebrow flex items-center gap-1.5 rounded-sm bg-federal-blue px-3 py-1.5 font-bold text-paper disabled:opacity-40"
            >
              <Icon name="add" className="size-3.5" />
              {busy === "add" ? "Adding…" : `Add ${picked.size}`}
            </button>
          )}
          <button
            type="button"
            disabled={!!busy || !messageId}
            aria-busy={busy === "dismiss"}
            onClick={() => void decide("dismiss")}
            className="outline-box press eyebrow rounded-sm bg-paper px-3 py-1.5 disabled:opacity-40"
          >
            {busy === "dismiss" ? "Dismissing…" : "Dismiss"}
          </button>
          {error ? (
            <p className="ml-auto text-xs text-seal-red">{error}</p>
          ) : null}
        </div>
      ) : proposal.status === "added" ? (
        <button
          type="button"
          onClick={() => onOpenClient(proposal.clientId)}
          className="flex w-full items-center gap-2 border-ink border-t-2 bg-ivy/10 px-3 py-2 text-left text-sm text-ivy hover:bg-ivy/20"
        >
          <Icon name="check" className="size-3.5" />
          Building into {proposal.clientName}'s file
          <Icon name="chevron" className="ml-auto size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

function Composer({
  busy,
  research,
  canResearch,
  placeholder,
  onResearch,
  onSend,
  onStop,
}: {
  busy: boolean;
  research: boolean;
  canResearch: boolean;
  placeholder: string;
  onResearch: (value: boolean) => void;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: grow with the text
  useEffect(() => {
    const element = area.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 200)}px`;
  }, [text]);
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (busy || !text.trim()) return;
    onSend(text);
    setText("");
  };
  return (
    <form onSubmit={submit} className="px-4 pt-2 pb-4">
      <div
        className={`mx-auto max-w-3xl rounded-sm border-2 bg-paper shadow-hard-md transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-federal-blue ${research ? "border-federal-blue" : "border-ink"}`}
      >
        <label htmlFor="cm-input" className="sr-only">
          Message
        </label>
        <textarea
          id="cm-input"
          ref={area}
          rows={1}
          value={text}
          maxLength={MAX_MESSAGE_LENGTH}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder={
            research ? "Who should I research, and what for?" : placeholder
          }
          className="block w-full resize-none bg-transparent px-4 pt-3 pb-1 text-[0.95rem] focus:outline-none"
        />
        <div className="flex items-center gap-2 px-2 pb-2">
          {canResearch ? (
            <button
              type="button"
              onClick={() => onResearch(!research)}
              aria-pressed={research}
              title="Search the web and propose new facts"
              className={`outline-box press eyebrow flex items-center gap-1.5 rounded-sm px-2.5 py-1 ${research ? "bg-federal-blue text-paper" : "bg-paper"}`}
            >
              <Icon name="globe" className="size-3.5" />
              Research
            </button>
          ) : null}
          {busy ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop"
              title="Stop (Esc)"
              className="outline-box press ml-auto grid size-8 place-items-center rounded-sm bg-seal-red text-paper"
            >
              <Icon name="stop" className="size-3.5" />
            </button>
          ) : (
            <button
              type="submit"
              aria-label="Send"
              disabled={!text.trim()}
              className="outline-box press ml-auto grid size-8 place-items-center rounded-sm bg-federal-blue text-paper disabled:opacity-35"
            >
              <Icon name="send" className="size-4" />
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
