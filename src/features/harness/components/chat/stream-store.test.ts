import { describe, expect, it } from "vitest";
import type { ChatEvent } from "../../domain/chat-events";
import { type OpenChat, StreamStore } from "./stream-store";

/** A chat the test pushes events into by hand. */
function manual() {
  const queue: ChatEvent[] = [];
  let wake: (() => void) | null = null;
  let ended = false;
  let fail: Error | null = null;
  const open: OpenChat = async function* (_id, _request, signal) {
    signal.addEventListener("abort", () => {
      fail = Object.assign(new Error("aborted"), { name: "AbortError" });
      wake?.();
    });
    for (;;) {
      if (fail) throw fail;
      const next = queue.shift();
      if (next) {
        yield next;
        continue;
      }
      if (ended) return;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  };
  return {
    open,
    push(event: ChatEvent) {
      queue.push(event);
      wake?.();
    },
    end() {
      ended = true;
      wake?.();
    },
    breakWith(error: Error) {
      fail = error;
      wake?.();
    },
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("StreamStore", () => {
  it("keeps two Sessions streaming at once", async () => {
    const store = new StreamStore();
    const a = manual();
    const b = manual();
    const doneA = store.start("a", { text: "one" }, a.open);
    const doneB = store.start("b", { text: "two" }, b.open);
    expect(store.streamingIds().sort()).toEqual(["a", "b"]);

    a.push({ type: "text.delta", text: "A1" });
    b.push({ type: "text.delta", text: "B1" });
    await tick();
    expect(store.get("a")?.turn.text).toBe("A1");
    expect(store.get("b")?.turn.text).toBe("B1");

    a.push({ type: "done", messageId: "ma" });
    expect((await doneA)?.status).toBe("done");
    expect(store.isStreaming("a")).toBe(false);
    expect(store.isStreaming("b")).toBe(true);

    b.push({ type: "text.delta", text: "B2" });
    b.push({ type: "done", messageId: "mb" });
    expect((await doneB)?.turn.text).toBe("B1B2");
  });

  it("refuses a second turn in a Session that is answering", async () => {
    const store = new StreamStore();
    const a = manual();
    store.start("a", { text: "one" }, a.open);
    expect(store.start("a", { text: "two" }, a.open)).toBeNull();
    a.push({ type: "done", messageId: "m" });
    await store.whenIdle("a");
  });

  it("notifies subscribers with a new snapshot on every change", async () => {
    const store = new StreamStore();
    const a = manual();
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });
    const before = store.getSnapshot();
    store.start("a", { text: "x" }, a.open);
    expect(store.getSnapshot()).not.toBe(before);
    expect(calls).toBeGreaterThan(0);
    a.push({ type: "done", messageId: "m" });
    await store.whenIdle("a");
  });

  it("stops a turn and keeps the partial text", async () => {
    const store = new StreamStore();
    const a = manual();
    const settled: string[] = [];
    store.onSettled((stream) => settled.push(stream.status));
    const done = store.start("a", { text: "x" }, a.open);
    a.push({ type: "text.delta", text: "partial" });
    await tick();
    store.stop("a");
    const ended = await done;
    expect(ended?.status).toBe("stopped");
    expect(ended?.turn.text).toBe("partial");
    expect(settled).toEqual(["stopped"]);
  });

  it("fails with the message and status of a refusal", async () => {
    const store = new StreamStore();
    const refused: OpenChat = () => ({
      [Symbol.asyncIterator]() {
        return {
          next: () =>
            Promise.reject(
              Object.assign(new Error("That's the limit."), { status: 429 }),
            ),
        };
      },
    });
    const ended = await store.start("a", { text: "x" }, refused);
    expect(ended).toMatchObject({
      status: "failed",
      error: "That's the limit.",
      errorStatus: 429,
    });
  });

  it("fails when the stream ends without done", async () => {
    const store = new StreamStore();
    const a = manual();
    const done = store.start("a", { text: "x" }, a.open);
    a.push({ type: "text.delta", text: "half" });
    a.end();
    expect((await done)?.status).toBe("failed");
  });

  it("lets whenIdle resolve at once for a quiet Session and on settle for a busy one", async () => {
    const store = new StreamStore();
    expect(await store.whenIdle("none")).toBeUndefined();
    const a = manual();
    store.start("a", { text: "x" }, a.open);
    let idle = false;
    const waiting = store.whenIdle("a").then((stream) => {
      idle = true;
      return stream;
    });
    await tick();
    expect(idle).toBe(false);
    a.push({ type: "done", messageId: "m" });
    expect((await waiting)?.status).toBe("done");
  });

  it("clear drops the entry; a replaced turn cannot touch its successor", async () => {
    const store = new StreamStore();
    const first = manual();
    store.start("a", { text: "1" }, first.open);
    store.clear("a");
    expect(store.get("a")).toBeUndefined();

    const second = manual();
    store.start("a", { text: "2" }, second.open);
    first.push({ type: "text.delta", text: "stale" });
    await tick();
    expect(store.get("a")?.turn.text).toBe("");
    second.push({ type: "done", messageId: "m" });
    await store.whenIdle("a");
  });
});

describe("StreamStore notifications", () => {
  /** A scheduler the test flushes by hand, standing in for animation frames. */
  function frames() {
    const queue: (() => void)[] = [];
    return {
      schedule: (flush: () => void) => {
        queue.push(flush);
      },
      flush() {
        for (const run of queue.splice(0)) run();
      },
      get waiting() {
        return queue.length;
      },
    };
  }

  it("tells subscribers about streamed text once per frame, with the latest state", async () => {
    const frame = frames();
    const store = new StreamStore(frame.schedule);
    const a = manual();
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });
    store.start("a", { text: "x" }, a.open);
    const afterStart = calls;
    expect(afterStart).toBe(1);

    a.push({ type: "text.delta", text: "one " });
    a.push({ type: "text.delta", text: "two " });
    a.push({ type: "text.delta", text: "three" });
    await tick();
    // The state is current at once; the subscribers wait for the frame.
    expect(store.get("a")?.turn.text).toBe("one two three");
    expect(calls).toBe(afterStart);
    expect(frame.waiting).toBe(1);

    frame.flush();
    expect(calls).toBe(afterStart + 1);
    expect(store.getSnapshot().get("a")?.turn.text).toBe("one two three");

    a.push({ type: "done", messageId: "m" });
    await store.whenIdle("a");
  });

  it("tells subscribers at once when a turn ends, without waiting for a frame", async () => {
    const frame = frames();
    const store = new StreamStore(frame.schedule);
    const a = manual();
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });
    store.start("a", { text: "x" }, a.open);
    a.push({ type: "text.delta", text: "partial" });
    await tick();
    const before = calls;
    a.push({ type: "done", messageId: "m" });
    await store.whenIdle("a");
    expect(calls).toBeGreaterThan(before);
    expect(store.getSnapshot().get("a")?.status).toBe("done");
    // The frame that was pending has nothing left to tell.
    frame.flush();
    const settled = calls;
    frame.flush();
    expect(calls).toBe(settled);
  });
});
