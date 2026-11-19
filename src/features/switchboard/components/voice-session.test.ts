import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionGrantView, ToolResponse } from "../domain/api";
import type { SampleCaller } from "../domain/samples";
import { type VoiceHandlers, VoiceSession } from "./voice-session";

type FakeSource = {
  buffer: { duration: number } | null;
  onended: (() => void) | null;
  connect: ReturnType<typeof vi.fn>;
  start: (when?: number) => void;
  stop: () => void;
};

class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.OPEN;
  sent: Record<string, unknown>[] = [];
  private listeners = new Map<string, Set<(event: unknown) => void>>();

  constructor(
    public url: string,
    public protocols?: string | string[],
  ) {
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => this.emit("open", {}));
  }

  addEventListener(type: string, fn: (event: unknown) => void) {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
  }

  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  close() {
    this.readyState = 3;
  }

  emit(type: string, event: unknown) {
    for (const fn of this.listeners.get(type) ?? []) fn(event);
  }

  async receive(event: Record<string, unknown>) {
    this.emit("message", { data: JSON.stringify(event) });
    await Promise.resolve();
    await Promise.resolve();
  }
}

class FakeAudioContext {
  currentTime = 1;
  state: AudioContextState = "running";
  activeSources: FakeSource[] = [];
  constructor(public options?: AudioContextOptions) {}
  async resume() {
    this.state = "running";
  }
  async close() {
    this.state = "closed";
  }
  createGain() {
    return { gain: { value: 1 }, connect: vi.fn(() => this.createAnalyser()) };
  }
  createAnalyser() {
    return {
      fftSize: 256,
      connect: vi.fn(),
      getByteTimeDomainData: vi.fn(),
    };
  }
  createBuffer(_channels: number, length: number, sampleRate: number) {
    return {
      duration: length / sampleRate,
      copyToChannel: vi.fn(),
      getChannelData: () => new Float32Array(length),
    };
  }
  createBufferSource(): FakeSource {
    const source: FakeSource = {
      buffer: null,
      onended: null,
      connect: vi.fn(),
      start: () => {
        this.activeSources.push(source);
      },
      stop: () => {
        this.activeSources = this.activeSources.filter((s) => s !== source);
        source.onended?.();
      },
    };
    return source;
  }
  async decodeAudioData() {
    const samples = new Float32Array(2400); // 100 ms at 24 kHz
    return {
      sampleRate: 24000,
      getChannelData: () => samples,
    };
  }
  finishAllAudio() {
    const copy = [...this.activeSources];
    this.activeSources = [];
    for (const source of copy) source.onended?.();
  }
}

const GRANT: SessionGrantView = {
  token: "vcst_test",
  url: "wss://example.test/realtime",
  model: "openai/gpt-realtime-2.1",
  mintMs: 20,
  config: {
    instructions: "Test",
    voice: "marin",
    tools: [],
    sampleRate: 24000,
  },
};

const pcmBase64 = (ms: number) => {
  const bytes = new Uint8Array(((24000 * ms) / 1000) * 2);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
};

function makeHandlers() {
  const log: { kind: string; data: unknown }[] = [];
  const handlers: VoiceHandlers = {
    onCaller: (text, via) => log.push({ kind: "caller", data: { text, via } }),
    onAgentPartial: (text) => log.push({ kind: "partial", data: text }),
    onAgentTurn: (turn) => log.push({ kind: "agent", data: turn }),
    onBargeIn: (playedMs) => log.push({ kind: "barge", data: playedMs }),
    onTool: (name, state) => log.push({ kind: "tool", data: { name, state } }),
    onSpeaking: (who) => log.push({ kind: "speaking", data: who }),
    onLog: () => {},
    onUsage: () => {},
    onSampleLine: (index) => log.push({ kind: "sampleLine", data: index }),
    onError: (message) => log.push({ kind: "error", data: message }),
    onOver: (reason) => log.push({ kind: "over", data: reason }),
    callTool: vi.fn(async () => ({
      ok: true,
      output: { ok: true },
      summary: "Checked",
      events: [],
      over: null,
    })),
    report: vi.fn(),
  };
  return { handlers, log };
}

describe("VoiceSession", () => {
  let ctx: FakeAudioContext;
  const origWindow = globalThis.window;
  const origWs = globalThis.WebSocket;
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    ctx = new FakeAudioContext();
    (globalThis as unknown as { window: unknown }).window = {
      AudioContext: class {
        constructor() {
          // biome-ignore lint/correctness/noConstructorReturn: test fake shares one controllable instance.
          return ctx;
        }
      },
    };
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async () => ({
      arrayBuffer: async () => new ArrayBuffer(8),
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as unknown as { window: unknown }).window = origWindow;
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = origWs;
    (globalThis as unknown as { fetch: unknown }).fetch = origFetch;
  });

  it("plays the next response after a post-response-done barge-in", async () => {
    const { handlers, log } = makeHandlers();
    const session = new VoiceSession(GRANT, handlers, null);
    await session.open(false);
    const ws = FakeWebSocket.instances[0];

    // Turn 1: server sends 2000ms audio and finishes generating immediately.
    await ws.receive({ type: "response-created", responseId: "resp_1" });
    await ws.receive({
      type: "audio-transcript-delta",
      responseId: "resp_1",
      itemId: "item_1",
      delta: "Let me check the timetable for you today.",
    });
    await ws.receive({
      type: "audio-delta",
      responseId: "resp_1",
      itemId: "item_1",
      delta: pcmBase64(2000),
    });
    await ws.receive({
      type: "response-done",
      responseId: "resp_1",
      status: "completed",
    });

    // Caller interrupts at 600ms while buffered audio is still playing.
    ctx.currentTime = 1.62; // 1.02 start + 0.60s
    await ws.receive({ type: "speech-started" });
    await vi.advanceTimersByTimeAsync(10);

    const agentIdx = log.findIndex((e) => e.kind === "agent");
    const bargeIdx = log.findIndex((e) => e.kind === "barge");
    expect(agentIdx, JSON.stringify(log)).toBeGreaterThanOrEqual(0);
    expect(bargeIdx).toBeGreaterThan(agentIdx);
    expect(log[agentIdx].data).toMatchObject({
      text: "Let me check the timetable for you today.",
      interrupted: true,
      playedMs: 600,
    });
    expect(log[bargeIdx].data).toBe(600);
    expect(
      ws.sent.some(
        (e) =>
          e.type === "conversation-item-truncate" &&
          e.itemId === "item_1" &&
          e.audioEndMs === 600,
      ),
    ).toBe(true);

    // Caller finishes speaking, and Turn 2 arrives. Audio MUST play!
    await ws.receive({ type: "speech-stopped" });
    await ws.receive({ type: "response-created", responseId: "resp_2" });
    await ws.receive({
      type: "audio-transcript-delta",
      responseId: "resp_2",
      itemId: "item_2",
      delta: "Yes, the 15:05 is on time.",
    });
    await ws.receive({
      type: "audio-delta",
      responseId: "resp_2",
      itemId: "item_2",
      delta: pcmBase64(1000),
    });
    expect(ctx.activeSources.length).toBe(1);

    await ws.receive({
      type: "response-done",
      responseId: "resp_2",
      status: "completed",
    });
    ctx.currentTime += 1.2;
    ctx.finishAllAudio();

    const agentTurns = log.filter((e) => e.kind === "agent");
    expect(agentTurns).toHaveLength(2);
    expect(agentTurns[1].data).toMatchObject({
      text: "Yes, the 15:05 is on time.",
      interrupted: false,
    });

    session.close();
  });

  it("cancels an active response on barge-in and ignores trailing deltas", async () => {
    const { handlers, log } = makeHandlers();
    const session = new VoiceSession(GRANT, handlers, null);
    await session.open(false);
    const ws = FakeWebSocket.instances[0];

    await ws.receive({ type: "response-created", responseId: "resp_1" });
    await ws.receive({
      type: "audio-transcript-delta",
      responseId: "resp_1",
      itemId: "item_1",
      delta: "One moment, I am",
    });
    await ws.receive({
      type: "audio-delta",
      responseId: "resp_1",
      itemId: "item_1",
      delta: pcmBase64(2000),
    });

    // Barge-in at 500ms while responseActive is still true.
    ctx.currentTime = 1.52;
    await ws.receive({ type: "speech-started" });
    await vi.advanceTimersByTimeAsync(10);

    expect(ws.sent.some((e) => e.type === "response-cancel")).toBe(true);
    // Late chunks for resp_1 must be dropped.
    await ws.receive({
      type: "audio-delta",
      responseId: "resp_1",
      itemId: "item_1",
      delta: pcmBase64(500),
    });
    await ws.receive({
      type: "audio-transcript-delta",
      responseId: "resp_1",
      itemId: "item_1",
      delta: " checking now.",
    });
    await ws.receive({
      type: "response-done",
      responseId: "resp_1",
      status: "cancelled",
    });
    expect(ctx.activeSources.length).toBe(0);

    const agentTurns = log.filter((e) => e.kind === "agent");
    expect(agentTurns).toHaveLength(1);
    expect(agentTurns[0].data).toMatchObject({
      text: "One moment, I am",
      interrupted: true,
      playedMs: 500,
    });

    session.close();
  });

  it("waits through a slow tool call in sample mode without cutting the Agent off", async () => {
    const sample: SampleCaller = {
      id: "lena",
      name: "Lena",
      title: "Test",
      shows: [],
      bookingRef: null,
      voice: "Kore",
      style: "calm",
      lines: [{ text: "Line 1" }, { text: "Line 2" }],
    };
    const { handlers, log } = makeHandlers();
    let resolveTool!: () => void;
    handlers.callTool = vi.fn(
      () =>
        new Promise<ToolResponse>((resolve) => {
          resolveTool = () =>
            resolve({
              ok: true,
              output: { delay: 75 },
              summary: "Delayed 75m",
              events: [],
              over: null,
            });
        }),
    );

    const session = new VoiceSession(GRANT, handlers, sample);
    await session.open(false);
    const ws = FakeWebSocket.instances[0];

    const sessionUpdate = ws.sent.find((e) => e.type === "session-update");
    expect(
      (sessionUpdate?.config as { turnDetection?: { type: string } })
        ?.turnDetection?.type,
    ).toBe("disabled");

    // Greeting completes.
    await ws.receive({ type: "response-created", responseId: "resp_greet" });
    await ws.receive({
      type: "audio-transcript-delta",
      responseId: "resp_greet",
      itemId: "item_g",
      delta: "Meridia Rail.",
    });
    await ws.receive({
      type: "audio-delta",
      responseId: "resp_greet",
      itemId: "item_g",
      delta: pcmBase64(500),
    });
    await ws.receive({
      type: "response-done",
      responseId: "resp_greet",
      status: "completed",
    });
    ctx.currentTime += 0.6;
    ctx.finishAllAudio();

    // After 950ms quiet, line 1 starts.
    await vi.advanceTimersByTimeAsync(1000);
    expect(log.some((e) => e.kind === "sampleLine" && e.data === 0)).toBe(true);

    // Line 1 is 100ms long -> finishes on next feeder tick and commits.
    await vi.advanceTimersByTimeAsync(200);
    expect(ws.sent.some((e) => e.type === "input-audio-commit")).toBe(true);

    // Agent speaks "One moment" and triggers a slow tool call (> 900ms).
    await ws.receive({ type: "response-created", responseId: "resp_tool_1" });
    await ws.receive({
      type: "audio-transcript-delta",
      responseId: "resp_tool_1",
      itemId: "item_t1",
      delta: "One moment.",
    });
    await ws.receive({
      type: "audio-delta",
      responseId: "resp_tool_1",
      itemId: "item_t1",
      delta: pcmBase64(300),
    });
    await ws.receive({
      type: "function-call-arguments-done",
      responseId: "resp_tool_1",
      itemId: "item_fc",
      callId: "call_1",
      name: "get_disruptions",
      arguments: "{}",
    });
    await ws.receive({
      type: "response-done",
      responseId: "resp_tool_1",
      status: "completed",
    });
    ctx.currentTime += 0.4;
    ctx.finishAllAudio();

    // Wait 1500ms while tool is still running: Line 2 MUST NOT start!
    await vi.advanceTimersByTimeAsync(1500);
    expect(log.some((e) => e.kind === "sampleLine" && e.data === 1)).toBe(
      false,
    );

    // Tool resolves; we wait 500ms BEFORE server sends response-created: Line 2 still waits!
    resolveTool();
    await vi.advanceTimersByTimeAsync(500);
    expect(log.some((e) => e.kind === "sampleLine" && e.data === 1)).toBe(
      false,
    );

    // Post-tool response plays and finishes.
    await ws.receive({ type: "response-created", responseId: "resp_tool_2" });
    await ws.receive({
      type: "audio-transcript-delta",
      responseId: "resp_tool_2",
      itemId: "item_t2",
      delta: "Delayed 75 minutes.",
    });
    await ws.receive({
      type: "audio-delta",
      responseId: "resp_tool_2",
      itemId: "item_t2",
      delta: pcmBase64(500),
    });
    await ws.receive({
      type: "response-done",
      responseId: "resp_tool_2",
      status: "completed",
    });
    ctx.currentTime += 0.6;
    ctx.finishAllAudio();

    // After 950ms quiet, Line 2 finally starts, with zero barge-ins!
    await vi.advanceTimersByTimeAsync(1000);
    expect(log.some((e) => e.kind === "sampleLine" && e.data === 1)).toBe(true);
    expect(log.some((e) => e.kind === "barge")).toBe(false);

    session.close();
  });

  it("cuts the Agent off at bargeAfterMs in sample mode and still plays the reply", async () => {
    const sample: SampleCaller = {
      id: "tomas",
      name: "Tomas",
      title: "Barge",
      shows: [],
      bookingRef: null,
      voice: "Fenrir",
      style: "angry",
      lines: [{ text: "Line 1" }, { text: "Interrupt!", bargeAfterMs: 800 }],
    };
    const { handlers, log } = makeHandlers();
    const session = new VoiceSession(GRANT, handlers, sample);
    await session.open(false);
    const ws = FakeWebSocket.instances[0];

    // Greeting completes.
    await ws.receive({ type: "response-created", responseId: "resp_g" });
    await ws.receive({
      type: "audio-delta",
      responseId: "resp_g",
      itemId: "item_g",
      delta: pcmBase64(200),
    });
    await ws.receive({
      type: "response-done",
      responseId: "resp_g",
      status: "completed",
    });
    ctx.currentTime += 0.3;
    ctx.finishAllAudio();

    // Line 1 plays and commits.
    await vi.advanceTimersByTimeAsync(1200);
    // Agent gives a 3-second answer.
    await ws.receive({ type: "response-created", responseId: "resp_long" });
    await ws.receive({
      type: "audio-transcript-delta",
      responseId: "resp_long",
      itemId: "item_long",
      delta: "I can offer you another train later today if",
    });
    await ws.receive({
      type: "audio-delta",
      responseId: "resp_long",
      itemId: "item_long",
      delta: pcmBase64(3000),
    });

    // Advance playback to 850ms (>= bargeAfterMs: 800).
    ctx.currentTime += 0.87;
    await vi.advanceTimersByTimeAsync(100);

    expect(log.some((e) => e.kind === "barge")).toBe(true);
    expect(log.some((e) => e.kind === "sampleLine" && e.data === 1)).toBe(true);
    expect(ws.sent.some((e) => e.type === "response-cancel")).toBe(true);

    // Finish Line 2 and verify next Agent reply plays audio.
    await vi.advanceTimersByTimeAsync(200);
    await ws.receive({ type: "response-created", responseId: "resp_after" });
    await ws.receive({
      type: "audio-delta",
      responseId: "resp_after",
      itemId: "item_after",
      delta: pcmBase64(500),
    });
    expect(ctx.activeSources.length).toBeGreaterThan(0);

    session.close();
  });
});
