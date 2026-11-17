"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { LIMITS } from "../../domain/limits";
import { isRunActive } from "../../domain/run";
import { SAMPLES, type SampleFile } from "../../domain/samples";
import type { MessageView, SessionSummary } from "../../domain/session";
import { ApiFailure, api, keys, messageOf } from "../api";
import {
  type Attachment,
  liveVisibility,
  sendBlocker,
  streamIsSaved,
  turnAnnouncement,
  turnFromMessage,
} from "../chat/chat-state";
import { Composer, DropZone } from "../chat/composer";
import { ChatEmptyState } from "../chat/empty-state";
import {
  AgentMessage,
  type MessageActions,
  StaffMessage,
} from "../chat/message-view";
import type { SuggestedPrompt } from "../chat/prompts";
import { SessionSidebar } from "../chat/session-sidebar";
import { SkillsPopover } from "../chat/skills-popover";
import { chatStreams } from "../chat/stream-store";
import { useAttachments } from "../chat/use-attachments";
import { useController, useHarness } from "../harness-context";
import { Badge, Button, cx, ErrorNote, Loading, useWrite } from "../ui";

const NEW_DRAFT = "new";
const draftKey = (sessionId: string | null) => sessionId ?? NEW_DRAFT;
/** How long sending stays off after a limit says no. */
const LIMIT_PAUSE_MS = 30_000;

/**
 * Chat: the Staff member's Sessions with the Agent. Each Session's stream is
 * held in `chatStreams`, above this view, so a turn started in one Session
 * keeps streaming while another is open (or another tab is).
 */
export default function ChatTab() {
  const { staff, sessionId, openSession, openRun, openTab, hrefFor, can } =
    useHarness();
  const queryClient = useQueryClient();
  const streams = useSyncExternalStore(
    chatStreams.subscribe,
    chatStreams.getSnapshot,
    chatStreams.getSnapshot,
  );

  // The Session a controller call or a click acts on, ahead of the address.
  const activeRef = useRef<string | null>(sessionId);
  useEffect(() => {
    activeRef.current = sessionId;
  }, [sessionId]);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [sampleBusy, setSampleBusy] = useState<string | null>(null);
  const [limit, setLimit] = useState<string | null>(null);
  const limitRef = useRef<string | null>(null);
  limitRef.current = limit;
  const textarea = useRef<HTMLTextAreaElement>(null);
  const sendingRef = useRef(false);

  useEffect(() => {
    if (!limit) return;
    const timer = setTimeout(() => setLimit(null), LIMIT_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [limit]);

  const attachments = useAttachments({
    onLimit: (message) =>
      setLimit(`${message} Sending is paused for a moment.`),
  });

  // Queries -------------------------------------------------------------------
  const sessionsKey = useMemo(() => [...keys.sessions, staff.id], [staff.id]);
  const sessions = useQuery({
    queryKey: sessionsKey,
    queryFn: api.sessions.list,
  });
  const messages = useQuery({
    queryKey: keys.messages(sessionId ?? ""),
    queryFn: () => api.sessions.messages(sessionId as string),
    enabled: sessionId !== null,
  });
  const runs = useQuery({
    queryKey: keys.runs(),
    queryFn: () => api.runs.list(),
    refetchInterval: (query) =>
      query.state.data?.some((run) => isRunActive(run.status)) ? 4000 : false,
  });

  const streamingIds = useMemo(
    () =>
      new Set(
        [...streams.values()]
          .filter((stream) => stream.status === "streaming")
          .map((stream) => stream.sessionId),
      ),
    [streams],
  );
  const activeRunSessionIds = useMemo(
    () =>
      new Set(
        (runs.data ?? []).flatMap((run) =>
          run.sessionId && isRunActive(run.status) ? [run.sessionId] : [],
        ),
      ),
    [runs.data],
  );

  // When a turn ends: refresh what it changed, then drop the live copy once saved.
  useEffect(
    () =>
      chatStreams.onSettled(async (stream) => {
        if (stream.errorStatus === 429 && stream.error) {
          setLimit(`${stream.error} Sending is paused for a moment.`);
        }
        void queryClient.invalidateQueries({ queryKey: keys.sessions });
        void queryClient.invalidateQueries({
          queryKey: ["harness", "runs"],
        });
        void queryClient.invalidateQueries({ queryKey: keys.sources });
        const key = keys.messages(stream.sessionId);
        await queryClient.refetchQueries({ queryKey: key });
        const count = queryClient.getQueryData<MessageView[]>(key)?.length ?? 0;
        if (
          chatStreams.get(stream.sessionId) === stream &&
          streamIsSaved(stream, count)
        ) {
          chatStreams.clear(stream.sessionId);
        }
      }),
    [queryClient],
  );

  const stream = sessionId ? streams.get(sessionId) : undefined;
  const history = messages.data;
  const historyCount = history ? history.length : (stream?.baseline ?? 0);
  useEffect(() => {
    if (stream && streamIsSaved(stream, historyCount)) {
      chatStreams.clear(stream.sessionId);
    }
  }, [stream, historyCount]);

  // Sessions ------------------------------------------------------------------
  const createSession = useCallback(async (): Promise<string> => {
    try {
      const session = await api.sessions.create();
      activeRef.current = session.id;
      queryClient.setQueryData<SessionSummary[]>(sessionsKey, (old) => [
        session,
        ...(old ?? []).filter((item) => item.id !== session.id),
      ]);
      void queryClient.invalidateQueries({ queryKey: keys.sessions });
      openSession(session.id);
      return session.id;
    } catch (caught) {
      if (caught instanceof ApiFailure && caught.status === 429) {
        setLimit(`${caught.message} Sending is paused for a moment.`);
      }
      throw caught;
    }
  }, [openSession, queryClient, sessionsKey]);

  const newSession = useWrite(createSession);
  const onNew = () => {
    setSidebarOpen(false);
    const emptyHere =
      activeRef.current === null ||
      (messages.data?.length === 0 && !streams.get(activeRef.current));
    if (emptyHere) {
      textarea.current?.focus();
      return;
    }
    void newSession.run();
  };

  const rename = useCallback(
    async (id: string, title: string) => {
      const session = await api.sessions.rename(id, { title });
      void queryClient.invalidateQueries({ queryKey: keys.sessions });
      return session;
    },
    [queryClient],
  );

  // Sending -------------------------------------------------------------------
  /** Sends a message in the open Session (making one if none is open). Rejects with a message to show. */
  const sendText = useCallback(
    async (raw: string): Promise<void> => {
      const text = raw.trim();
      const startKey = draftKey(activeRef.current);
      const blocker = sendBlocker({
        text,
        maxChars: LIMITS.messageChars,
        attachments: attachments.peek(startKey),
        streaming:
          activeRef.current !== null &&
          chatStreams.isStreaming(activeRef.current),
        blockedReason: limitRef.current,
      });
      if (blocker) throw new Error(blocker);
      if (sendingRef.current) throw new Error("Already sending.");
      sendingRef.current = true;
      try {
        const id = activeRef.current ?? (await createSession());
        const files = attachments
          .peek(startKey)
          .filter((item: Attachment) => item.state === "ready");
        const ids = attachments.take(startKey);
        setTexts((all) => ({ ...all, [startKey]: "" }));
        const baseline =
          queryClient.getQueryData<MessageView[]>(keys.messages(id))?.length ??
          0;
        chatStreams.start(
          id,
          { text, ...(ids.length > 0 ? { attachments: ids } : {}) },
          api.sessions.chat,
          { baseline, attachmentNames: files.map((file) => file.name) },
        );
        void queryClient.invalidateQueries({ queryKey: keys.sessions });
      } finally {
        sendingRef.current = false;
      }
    },
    [attachments, createSession, queryClient],
  );

  const retry = (id: string) => {
    const failed = chatStreams.get(id);
    if (!failed) return;
    const baseline =
      queryClient.getQueryData<MessageView[]>(keys.messages(id))?.length ?? 0;
    chatStreams.clear(id);
    chatStreams.start(id, failed.request, api.sessions.chat, {
      baseline,
      attachmentNames: failed.attachmentNames,
    });
  };

  /** Uploads files into the open draft. Rejects with the first failure's message. */
  const attachFiles = useCallback(
    (files: File[]) => {
      const id = activeRef.current;
      return attachments.add(draftKey(id), files, id);
    },
    [attachments],
  );

  const attachSample = useCallback(
    async (
      target: SampleFile | { path: string; name: string; type: string },
    ) => {
      const id = activeRef.current;
      const label = "id" in target ? target.id : target.path;
      setSampleBusy(label);
      try {
        const response = await fetch(target.path);
        if (!response.ok) {
          throw new Error(`The sample file did not load (${response.status}).`);
        }
        const blob = await response.blob();
        const file = new File([blob], target.name, {
          type: target.type || blob.type || "application/octet-stream",
        });
        await attachments.add(draftKey(id), [file], id);
      } finally {
        setSampleBusy(null);
      }
    },
    [attachments],
  );

  const onFiles = (files: File[]) => {
    setNotice(null);
    attachFiles(files).catch((caught) => setNotice(messageOf(caught)));
  };

  const onPickSample = (sample: SampleFile) => {
    setNotice(null);
    attachSample(sample).catch((caught) => setNotice(messageOf(caught)));
  };

  const onPrompt = (prompt: SuggestedPrompt) => {
    setNotice(null);
    const sample = prompt.sampleGroup
      ? SAMPLES.find((item) => item.group === prompt.sampleGroup)
      : undefined;
    void (async () => {
      try {
        if (sample) await attachSample(sample);
        await sendText(prompt.text);
      } catch (caught) {
        setNotice(messageOf(caught));
      }
    })();
  };

  const onSend = () => {
    setNotice(null);
    sendText(texts[draftKey(activeRef.current)] ?? "").catch((caught) =>
      setNotice(messageOf(caught)),
    );
  };

  // Demo mode's way in: exactly what a person clicking does. ---------------------
  useController("chat", {
    newSession: createSession,
    send: (text) => sendText(text),
    async attachFixture(pathOrId) {
      const known = SAMPLES.find(
        (sample) => sample.path === pathOrId || sample.id === pathOrId,
      );
      if (known) return attachSample(known);
      const name = pathOrId.split("/").pop() || "sample";
      return attachSample({ path: pathOrId, name, type: "" });
    },
    async waitIdle() {
      const id = activeRef.current;
      if (!id) return;
      const ended = await chatStreams.whenIdle(id);
      if (ended?.status === "failed") {
        throw new Error(ended.error ?? "The Agent could not answer.");
      }
    },
  });

  // Reading -------------------------------------------------------------------
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a different Session starts at the bottom
  useLayoutEffect(() => {
    stick.current = true;
  }, [sessionId]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: new content is what scrolls
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element && stick.current) element.scrollTop = element.scrollHeight;
  }, [
    sessionId,
    historyCount,
    stream?.turn,
    stream?.status,
    messages.isSuccess,
  ]);

  const actions: MessageActions = useMemo(
    () => ({ openRun, openTab, hrefFor }),
    [openRun, openTab, hrefFor],
  );

  const key = draftKey(sessionId);
  const text = texts[key] ?? "";
  const draftFiles = attachments.drafts[key] ?? [];
  const visible = stream ? liveVisibility(stream, historyCount) : null;
  const showEmpty =
    (sessionId === null || (messages.isSuccess && history?.length === 0)) &&
    !stream;
  const currentSession = sessions.data?.find((item) => item.id === sessionId);
  const title = currentSession?.title ?? "New session";
  const answering = stream?.status === "streaming";

  return (
    <div className="relative flex min-h-0 flex-1 bg-marble">
      <aside
        aria-label="Sessions"
        className={cx(
          "absolute inset-y-0 left-0 z-20 w-[min(20rem,85vw)] shrink-0 flex-col border-ink border-r-2 bg-marble shadow-hard-md md:static md:flex md:w-72 md:shadow-none",
          sidebarOpen ? "flex" : "hidden",
        )}
      >
        <div className="flex items-center justify-between border-ink border-b-2 px-3 py-2 md:hidden">
          <span className="eyebrow font-bold">Sessions</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSidebarOpen(false)}
          >
            Close
          </Button>
        </div>
        <SessionSidebar
          sessions={sessions.data}
          loading={sessions.isPending}
          error={sessions.isError ? messageOf(sessions.error) : null}
          onRetry={() => void sessions.refetch()}
          activeId={sessionId}
          streamingIds={streamingIds}
          activeRunSessionIds={activeRunSessionIds}
          onSelect={(id) => {
            setSidebarOpen(false);
            setNotice(null);
            openSession(id);
          }}
          onNew={onNew}
          creating={newSession.pending}
          createError={newSession.error}
          onRename={rename}
        />
      </aside>

      <DropZone
        onFiles={onFiles}
        className="flex min-h-0 min-w-0 flex-1 flex-col"
      >
        <header className="flex items-center gap-2 border-ink border-b-2 bg-paper px-3 py-2 sm:px-5">
          <Button
            size="sm"
            variant="secondary"
            className="md:hidden"
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen((open) => !open)}
          >
            Sessions
            {streamingIds.size > 0 ? (
              <span
                role="img"
                aria-label={`${streamingIds.size} answering`}
                className="hx-pulse size-2 rounded-full bg-federal-blue"
              />
            ) : null}
          </Button>
          <h2 className="min-w-0 flex-1 truncate font-mono text-xs font-bold uppercase">
            {title}
          </h2>
          {answering ? (
            <Badge tone="blue" dot>
              Answering
            </Badge>
          ) : null}
          <SkillsPopover
            onOpenSkill={(skill) => openTab("skills", { skill })}
          />
        </header>

        <output aria-live="polite" className="sr-only">
          {turnAnnouncement(stream)}
        </output>

        <div
          ref={scroller}
          onScroll={(event) => {
            const element = event.currentTarget;
            stick.current =
              element.scrollHeight - element.scrollTop - element.clientHeight <
              96;
          }}
          className="hx-scroll min-h-0 flex-1"
        >
          {showEmpty ? (
            <ChatEmptyState
              isAdmin={can("sandbox.use")}
              staffName={staff.name}
              busy={sendingRef.current || sampleBusy !== null}
              onPrompt={onPrompt}
            />
          ) : sessionId && messages.isPending && !stream ? (
            <Loading rows={3} className="mx-auto max-w-3xl p-5" />
          ) : sessionId && messages.isError && !stream ? (
            <div className="mx-auto max-w-3xl p-5">
              <ErrorNote onRetry={() => void messages.refetch()}>
                {messageOf(messages.error)}
              </ErrorNote>
            </div>
          ) : (
            <div className="mx-auto w-full max-w-3xl space-y-5 px-3 py-5 sm:px-5">
              {(history ?? []).map((message) =>
                message.role === "staff" ? (
                  <StaffMessage
                    key={message.id}
                    message={message}
                    onPreview={(id) =>
                      openTab("knowledge", { source: id, preview: "original" })
                    }
                    name={message.staff?.name ?? "Staff"}
                    initials={message.staff?.initials ?? "–"}
                  />
                ) : (
                  <AgentMessage
                    key={message.id}
                    turn={turnFromMessage(message)}
                    actions={actions}
                  />
                ),
              )}
              {stream && visible?.staff ? (
                <StaffMessage
                  text={stream.request.text}
                  name={staff.name}
                  initials={staff.initials}
                  attachments={stream.attachmentNames.map((name) => ({ name }))}
                  pending
                />
              ) : null}
              {stream && visible?.agent ? (
                <AgentMessage
                  turn={stream.turn}
                  actions={actions}
                  streaming={stream.status === "streaming"}
                  stopped={stream.status === "stopped"}
                  onRetry={
                    stream.status === "failed"
                      ? () => retry(stream.sessionId)
                      : undefined
                  }
                />
              ) : null}
            </div>
          )}
        </div>

        <Composer
          text={text}
          onText={(value) => {
            setNotice(null);
            setTexts((all) => ({ ...all, [key]: value }));
          }}
          attachments={draftFiles}
          onFiles={onFiles}
          onRemoveAttachment={(localId) => attachments.remove(key, localId)}
          onSend={onSend}
          onStop={() => sessionId && chatStreams.stop(sessionId)}
          onPickSample={onPickSample}
          sampleBusyId={sampleBusy}
          streaming={answering}
          blockedReason={limit}
          notice={<ErrorNote>{notice}</ErrorNote>}
          textareaRef={textarea}
        />
      </DropZone>
    </div>
  );
}
