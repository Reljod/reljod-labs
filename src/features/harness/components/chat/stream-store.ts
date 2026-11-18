import type { ChatRequest } from "../../domain/api";
import type { ChatEvent } from "../../domain/chat-events";
import {
  applyChatEvent,
  beginStream,
  failStream,
  type SessionStream,
  stopStream,
} from "./chat-state";

/** Opens one chat turn; `api.sessions.chat` is the real one. */
export type OpenChat = (
  sessionId: string,
  request: ChatRequest,
  signal: AbortSignal,
) => AsyncIterable<ChatEvent>;

type Listener = () => void;

/** Runs a flush later: once per animation frame in a browser, at once elsewhere. */
export type Schedule = (flush: () => void) => void;

const nextFrame: Schedule = (flush) => {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => flush());
  } else {
    flush();
  }
};

/**
 * The streams of every Session, held above the Session view. Starting a turn
 * in Session A and switching to Session B leaves A streaming here; coming
 * back reads its live state. One module-level instance (`chatStreams`)
 * outlives the tab's re-renders; tabs stay mounted, so it also outlives a
 * change of tab. A Session has one turn at a time.
 *
 * It is a plain external store (`subscribe` / `getSnapshot`) for
 * `useSyncExternalStore`: every change replaces the snapshot Map. A turn's
 * streamed events tell the subscribers at most once per animation frame (a
 * model streams far more deltas than a screen draws frames); a start, a stop,
 * the end of a turn and a clear tell them at once.
 */
export class StreamStore {
  private entries: ReadonlyMap<string, SessionStream> = new Map();
  private readonly controllers = new Map<string, AbortController>();
  private readonly listeners = new Set<Listener>();
  private readonly settledListeners = new Set<
    (stream: SessionStream) => void
  >();
  private readonly idleWaiters = new Map<
    string,
    Set<(stream: SessionStream) => void>
  >();

  private flushPending = false;

  constructor(private readonly schedule: Schedule = nextFrame) {}

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): ReadonlyMap<string, SessionStream> => this.entries;

  get(sessionId: string): SessionStream | undefined {
    return this.entries.get(sessionId);
  }

  isStreaming(sessionId: string): boolean {
    return this.entries.get(sessionId)?.status === "streaming";
  }

  streamingIds(): string[] {
    return [...this.entries.values()]
      .filter((stream) => stream.status === "streaming")
      .map((stream) => stream.sessionId);
  }

  /** Called whenever a turn ends, however it ends. Returns the unsubscribe. */
  onSettled(listener: (stream: SessionStream) => void) {
    this.settledListeners.add(listener);
    return () => {
      this.settledListeners.delete(listener);
    };
  }

  /**
   * Begins a turn in a Session. Returns null, and does nothing, when that
   * Session is already answering. Otherwise resolves with the stream as it
   * ended (done, failed or stopped); it never rejects.
   */
  start(
    sessionId: string,
    request: ChatRequest,
    open: OpenChat,
    options: { baseline?: number; attachmentNames?: string[] } = {},
  ): Promise<SessionStream> | null {
    if (this.isStreaming(sessionId)) return null;
    const controller = new AbortController();
    this.controllers.set(sessionId, controller);
    this.set(sessionId, beginStream(sessionId, request, options));
    return this.drive(sessionId, request, open, controller);
  }

  /** Aborts the Session's turn. The partial answer stays on screen, marked stopped. */
  stop(sessionId: string) {
    const controller = this.controllers.get(sessionId);
    if (!controller) return;
    controller.abort();
    this.update(sessionId, stopStream);
  }

  /** Drops a Session's stream (its turn is saved, or the person retries). An active stream is stopped first. */
  clear(sessionId: string) {
    if (this.isStreaming(sessionId)) this.stop(sessionId);
    const last = this.entries.get(sessionId);
    this.controllers.delete(sessionId);
    const waiters = this.idleWaiters.get(sessionId);
    this.idleWaiters.delete(sessionId);
    if (last) for (const wake of waiters ?? []) wake(last);
    if (!last) return;
    const next = new Map(this.entries);
    next.delete(sessionId);
    this.entries = next;
    this.emit();
  }

  /** Resolves, with how it ended, once the Session is not answering. At once when it is not. */
  whenIdle(sessionId: string): Promise<SessionStream | undefined> {
    const stream = this.entries.get(sessionId);
    if (!stream || stream.status !== "streaming")
      return Promise.resolve(stream);
    return new Promise((resolve) => {
      const waiters = this.idleWaiters.get(sessionId) ?? new Set();
      waiters.add(resolve);
      this.idleWaiters.set(sessionId, waiters);
    });
  }

  private async drive(
    sessionId: string,
    request: ChatRequest,
    open: OpenChat,
    controller: AbortController,
  ): Promise<SessionStream> {
    // A turn that was stopped and replaced must not touch its successor.
    const mine = () => this.controllers.get(sessionId) === controller;
    try {
      for await (const event of open(sessionId, request, controller.signal)) {
        if (controller.signal.aborted || !mine()) break;
        const last = event.type === "done" || event.type === "error";
        this.update(sessionId, (stream) => applyChatEvent(stream, event), {
          soon: !last,
        });
        if (last) break;
      }
      if (!mine()) return this.entries.get(sessionId) as SessionStream;
      if (controller.signal.aborted) {
        this.update(sessionId, stopStream);
      } else {
        this.update(sessionId, (stream) =>
          failStream(stream, "The answer stopped early. Try again."),
        );
      }
    } catch (caught) {
      if (!mine()) return this.entries.get(sessionId) as SessionStream;
      if (controller.signal.aborted) {
        this.update(sessionId, stopStream);
      } else {
        const message =
          caught instanceof Error && caught.message
            ? caught.message
            : "That didn't work. Try again.";
        const code = (caught as { status?: unknown } | null)?.status;
        const status = typeof code === "number" ? code : null;
        this.update(sessionId, (stream) => failStream(stream, message, status));
      }
    }
    this.controllers.delete(sessionId);
    const ended = this.entries.get(sessionId) as SessionStream;
    for (const listener of this.settledListeners) {
      try {
        listener(ended);
      } catch {
        // A listener that throws must not stop the others or the waiters.
      }
    }
    const waiters = this.idleWaiters.get(sessionId);
    this.idleWaiters.delete(sessionId);
    for (const wake of waiters ?? []) wake(ended);
    return ended;
  }

  private update(
    sessionId: string,
    change: (stream: SessionStream) => SessionStream,
    options: { soon?: boolean } = {},
  ) {
    const current = this.entries.get(sessionId);
    if (!current) return;
    const next = change(current);
    if (next !== current) this.set(sessionId, next, options);
  }

  private set(
    sessionId: string,
    stream: SessionStream,
    options: { soon?: boolean } = {},
  ) {
    const next = new Map(this.entries);
    next.set(sessionId, stream);
    this.entries = next;
    if (options.soon) this.emitSoon();
    else this.emit();
  }

  /** Tells the subscribers on the next frame, once however many changes land before it. */
  private emitSoon() {
    if (this.flushPending) return;
    this.flushPending = true;
    this.schedule(() => {
      if (this.flushPending) this.emit();
    });
  }

  private emit() {
    // A change told at once also carries any that were waiting for a frame.
    this.flushPending = false;
    for (const listener of this.listeners) listener();
  }
}

/** The one store the Chat tab uses. */
export const chatStreams = new StreamStore();
