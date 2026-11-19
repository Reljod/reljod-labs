"use client";

import { createGateway } from "ai";
import type { SessionGrantView, ToolResponse } from "../domain/api";
import type { ReportedEvent, TurnLatency } from "../domain/contract";
import type { RealtimeUsage } from "../domain/models";
import { type SampleCaller, sampleClipPath } from "../domain/samples";

/**
 * The voice Line in the browser: one realtime speech-to-speech Session over
 * a WebSocket to Vercel AI Gateway, opened with the short-lived client secret
 * the server minted (ADR 0029). Audio goes browser to gateway and back; every
 * tool call the model asks for is passed to the server, which decides.
 *
 * It owns the microphone (or a Sample caller's clips fed in its place), the
 * speaker, Barge-in, and the clock that measures time to first audio.
 */

const CHUNK_MS = 100;
/** The silence server turn detection waits for before it calls a Turn over. */
export const VAD_SILENCE_MS = 500;

export type VoiceMode = "mic" | "sample" | "listen";

export type VoiceHandlers = {
  /** Something for the transcript; `partial` items are replaced by id. */
  onCaller(text: string, via: "voice" | "sample" | "text"): void;
  onAgentPartial(text: string): void;
  onAgentTurn(turn: {
    text: string;
    interrupted: boolean;
    playedMs?: number;
    latency?: TurnLatency;
  }): void;
  onBargeIn(playedMs: number): void;
  onTool(name: string, state: "start" | "end", response?: ToolResponse): void;
  onSpeaking(who: "caller" | "agent" | null): void;
  onLog(entry: { ms: number; type: string; note?: string }): void;
  onUsage(usage: RealtimeUsage): void;
  onSampleLine(index: number | null): void;
  onError(message: string): void;
  /** The Session is over (socket closed, the server said the Call is over, or the script finished). */
  onOver(reason: string): void;
  /** Sends a tool call to the server's bridge. */
  callTool(input: {
    toolCallId: string;
    name: string;
    arguments: string;
    saying: string;
    hearing: string;
  }): Promise<ToolResponse>;
  report(events: ReportedEvent[]): void;
};

const toBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
};

const fromBase64 = (text: string) => {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
};

function floatToPcm(samples: Float32Array) {
  const out = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index++) {
    const value = Math.max(-1, Math.min(1, samples[index]));
    out[index] = value < 0 ? value * 0x8000 : value * 0x7fff;
  }
  return new Uint8Array(out.buffer);
}

function resampleLinear(
  samples: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate === toRate || samples.length === 0) return samples;
  const length = Math.max(1, Math.round((samples.length * toRate) / fromRate));
  const out = new Float32Array(length);
  const ratio = fromRate / toRate;
  for (let index = 0; index < length; index++) {
    const pos = index * ratio;
    const low = Math.floor(pos);
    const high = Math.min(samples.length - 1, low + 1);
    const frac = pos - low;
    out[index] = samples[low] * (1 - frac) + samples[high] * frac;
  }
  return out;
}

export class VoiceSession {
  private ws: WebSocket | null = null;
  private ctx: AudioContext | null = null;
  private codec: ReturnType<
    ReturnType<typeof createGateway>["experimental_realtime"]
  >;
  private micStream: MediaStream | null = null;
  private micNode: ScriptProcessorNode | null = null;
  private feeder: ReturnType<typeof setInterval> | null = null;
  private director: ReturnType<typeof setInterval> | null = null;
  private analyserIn: AnalyserNode | null = null;
  private analyserOut: AnalyserNode | null = null;
  private outGain: GainNode | null = null;
  private sources = new Set<AudioBufferSourceNode>();
  private clipSources = new Set<AudioBufferSourceNode>();
  private started = performance.now();
  private closed = false;

  // Turn detection: sample callers use manual commits when supported so
  // natural pauses inside a pre-recorded clip never split a line in two.
  private vadEnabled = true;

  // The Agent's current Turn.
  private nextPlayAt = 0;
  private turnStartedAt = 0; // ctx time the current audio batch started playing
  private turnAudioMs = 0;
  private turnText = "";
  private turnInterrupted = false;
  private turnPlayedMs: number | undefined;
  private turnLatency: TurnLatency | undefined;
  private currentItem = "";
  private activeResponseId: string | null = null;
  private cancelledResponseId: string | null = null;
  private responseActive = false;
  private greeted = false;
  private callerSpeaking = false;
  private awaitingResponse = false;
  private awaitingToolResponse = false;
  private turnSeq = 0;
  private pendingTools = 0;
  private toolMs = 0;

  // The clock.
  private speechStoppedAt = 0;
  private awaitingFirstAudio = false;
  private lastActivity = performance.now();

  // What has been said, for the Checks that read the transcript.
  private heardCaller = "";
  private audioInMs = 0;
  private audioOutMs = 0;

  // A Sample caller.
  private clips: Float32Array[] = [];
  private clipIndex = 0;
  private clipOffset = -1;
  private startingLine = false;
  private typed: string[] = [];

  mode: VoiceMode = "listen";

  constructor(
    private grant: SessionGrantView,
    private handlers: VoiceHandlers,
    private sample: SampleCaller | null,
  ) {
    // The codec only turns events into the provider's wire format; no key is involved.
    this.codec = createGateway({
      apiKey: "unused-in-the-browser",
    }).experimental_realtime(grant.model);
  }

  private ms() {
    return Math.round(performance.now() - this.started);
  }

  private log(type: string, note?: string) {
    this.handlers.onLog({ ms: this.ms(), type, note });
  }

  private async send(event: Record<string, unknown>) {
    if (this.closed || this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify(await this.codec.serializeClientEvent(event as never)),
    );
  }

  /** How loud each side is right now, 0 to 1, for the orb. */
  levels() {
    const level = (analyser: AnalyserNode | null) => {
      if (!analyser) return 0;
      const data = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const value of data) peak = Math.max(peak, Math.abs(value - 128));
      return Math.min(1, peak / 90);
    };
    return { caller: level(this.analyserIn), agent: level(this.analyserOut) };
  }

  private playedMs() {
    if (!this.ctx || !this.turnStartedAt || this.turnAudioMs <= 0) return 0;
    return Math.max(
      0,
      Math.min(
        this.turnAudioMs,
        (this.ctx.currentTime - this.turnStartedAt) * 1000,
      ),
    );
  }

  private agentSpeaking() {
    return (
      this.sources.size > 0 &&
      this.turnAudioMs > 0 &&
      this.playedMs() < this.turnAudioMs - 20
    );
  }

  private audioClockRunning() {
    return this.ctx?.state === "running";
  }

  /**
   * Opens the Session. `wantMic` asks for the microphone (only ever called
   * from a button press); when it is refused the Session still opens, to
   * listen and type.
   */
  async open(
    wantMic: boolean,
  ): Promise<{ connectMs: number; mic: "on" | "refused" | "off" }> {
    const rate = this.grant.config.sampleRate;
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    this.ctx = new Ctx({ sampleRate: rate });
    await this.ctx.resume();
    this.outGain = this.ctx.createGain();
    this.analyserOut = this.ctx.createAnalyser();
    this.analyserOut.fftSize = 256;
    this.outGain.connect(this.analyserOut).connect(this.ctx.destination);
    this.analyserIn = this.ctx.createAnalyser();
    this.analyserIn.fftSize = 256;

    let mic: "on" | "refused" | "off" = "off";
    if (this.sample) {
      this.mode = "sample";
      this.clips = await Promise.all(
        this.sample.lines.map(async (_line, index) => {
          const response = await fetch(
            sampleClipPath(this.sample?.id ?? "", index),
          );
          const decoded = await (this.ctx as AudioContext).decodeAudioData(
            await response.arrayBuffer(),
          );
          return resampleLinear(
            decoded.getChannelData(0),
            decoded.sampleRate,
            rate,
          );
        }),
      );
    } else if (wantMic) {
      try {
        this.micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
          },
        });
        mic = "on";
        this.mode = "mic";
      } catch {
        mic = "refused";
      }
    }

    // OpenAI realtime models support manual turn control (`disabled`), so a
    // sample clip with natural mid-sentence pauses is never split in half.
    this.vadEnabled = !this.sample || this.grant.model.startsWith("google/");

    const connectStarted = performance.now();
    const socket = await this.codec.getWebSocketConfig?.({
      token: this.grant.token,
      url: this.grant.url,
    } as never);
    if (!socket) throw new Error("This model has no realtime socket.");
    const ws = new WebSocket(socket.url, socket.protocols);
    this.ws = ws;
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener(
        "error",
        () => reject(new Error("The line could not connect.")),
        {
          once: true,
        },
      );
    });
    const connectMs = Math.round(performance.now() - connectStarted);
    this.started = performance.now();
    this.log("session.open", `${this.grant.model}, socket in ${connectMs} ms`);

    ws.addEventListener(
      "message",
      (message) => void this.onMessage(String(message.data)),
    );
    ws.addEventListener("close", () => {
      if (!this.closed) this.handlers.onOver("The line dropped.");
    });

    await this.send({
      type: "session-update",
      config: {
        instructions: this.grant.config.instructions,
        voice: this.grant.config.voice,
        outputModalities: ["audio"],
        inputAudioFormat: { type: "audio/pcm", rate },
        outputAudioFormat: { type: "audio/pcm", rate },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        turnDetection: this.vadEnabled
          ? {
              type: "server-vad",
              threshold: 0.5,
              silenceDurationMs: this.sample ? 1200 : VAD_SILENCE_MS,
              prefixPaddingMs: 300,
            }
          : { type: "disabled" },
        tools: this.grant.config.tools,
      },
    });
    // The Agent greets first.
    this.awaitingResponse = true;
    await this.send({ type: "response-create" });

    if (this.micStream) this.startMic();
    else this.startFeeder();
    if (this.sample) this.startDirector();
    return { connectMs, mic };
  }

  private startMic() {
    const ctx = this.ctx as AudioContext;
    const rate = this.grant.config.sampleRate;
    const source = ctx.createMediaStreamSource(this.micStream as MediaStream);
    source.connect(this.analyserIn as AnalyserNode);
    // ScriptProcessor is old but everywhere, and a worklet needs a second file.
    this.micNode = ctx.createScriptProcessor(2048, 1, 1);
    this.micNode.onaudioprocess = (event) => {
      const raw = event.inputBuffer.getChannelData(0);
      const samples =
        ctx.sampleRate === rate
          ? raw
          : resampleLinear(raw, ctx.sampleRate, rate);
      this.audioInMs += (samples.length / rate) * 1000;
      void this.send({
        type: "input-audio-append",
        audio: toBase64(floatToPcm(samples)),
      });
    };
    source.connect(this.micNode);
    const mute = ctx.createGain();
    mute.gain.value = 0;
    this.micNode.connect(mute).connect(ctx.destination);
  }

  /** No microphone: feeds a Sample caller's clip (or silence when VAD is on). */
  private startFeeder() {
    const rate = this.grant.config.sampleRate;
    const chunk = Math.round((rate * CHUNK_MS) / 1000);
    this.feeder = setInterval(() => {
      if (this.closed) return;
      if (this.clipOffset >= 0) {
        const clip = this.clips[this.clipIndex];
        const out = new Float32Array(chunk);
        out.set(clip.subarray(this.clipOffset, this.clipOffset + chunk));
        this.clipOffset += chunk;
        this.audioInMs += CHUNK_MS;
        void this.send({
          type: "input-audio-append",
          audio: toBase64(floatToPcm(out)),
        });
        if (this.clipOffset >= clip.length) {
          this.clipOffset = -1;
          this.clipIndex++;
          this.callerSpeaking = false;
          this.lastActivity = performance.now();
          this.handlers.onSampleLine(null);
          if (!this.vadEnabled) {
            this.awaitingResponse = true;
            this.speechStoppedAt = performance.now();
            this.awaitingFirstAudio = true;
            void this.commitSampleTurn();
          } else {
            this.awaitingResponse = true;
          }
        }
        return;
      }
      if (this.vadEnabled) {
        const silence = new Float32Array(chunk);
        void this.send({
          type: "input-audio-append",
          audio: toBase64(floatToPcm(silence)),
        });
      }
    }, CHUNK_MS);
  }

  private async commitSampleTurn() {
    await this.send({ type: "input-audio-commit" });
    await this.send({ type: "response-create" });
  }

  private async startLine(bargeIn = false) {
    if (this.closed || this.startingLine || this.clipOffset >= 0) return;
    const clip = this.clips[this.clipIndex];
    if (!clip) return;
    this.startingLine = true;
    this.callerSpeaking = true;
    try {
      if (bargeIn) await this.interruptAgent();
      if (!this.vadEnabled) await this.send({ type: "input-audio-clear" });
      if (this.closed) return;
      const ctx = this.ctx as AudioContext;
      this.handlers.onSampleLine(this.clipIndex);
      this.handlers.onSpeaking("caller");
      this.log("sample.line", `line ${this.clipIndex + 1}`);
      // Heard in the room too, so the visitor follows the Call.
      const buffer = ctx.createBuffer(1, clip.length, ctx.sampleRate);
      buffer.copyToChannel(clip as Float32Array<ArrayBuffer>, 0);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.value = 0.9;
      source.connect(gain);
      gain.connect(this.analyserIn as AnalyserNode);
      gain.connect(ctx.destination);
      source.start();
      this.clipSources.add(source);
      source.onended = () => {
        this.clipSources.delete(source);
        if (!this.agentSpeaking() && !this.callerSpeaking)
          this.handlers.onSpeaking(null);
      };
      this.clipOffset = 0;
    } finally {
      this.startingLine = false;
    }
  }

  /** The Sample caller's script: the next line when the line is quiet, or a Barge-in. */
  private startDirector() {
    this.director = setInterval(() => {
      if (
        this.closed ||
        this.startingLine ||
        this.clipOffset >= 0 ||
        !this.sample
      )
        return;
      const waitingForAgent =
        this.responseActive ||
        this.pendingTools > 0 ||
        this.awaitingToolResponse ||
        this.awaitingResponse ||
        this.callerSpeaking;
      const idle = !waitingForAgent && !this.agentSpeaking();
      const quietFor = performance.now() - this.lastActivity;
      if (this.clipIndex >= this.clips.length) {
        if (idle && quietFor > 2500)
          this.handlers.onOver("The Caller hung up.");
        return;
      }
      const next = this.sample.lines[this.clipIndex];
      if (
        next.bargeAfterMs &&
        this.pendingTools === 0 &&
        !this.awaitingToolResponse &&
        !this.awaitingResponse &&
        this.agentSpeaking() &&
        this.playedMs() >= next.bargeAfterMs
      ) {
        void this.startLine(true);
        return;
      }
      if (idle && this.greeted && quietFor > 900) void this.startLine(false);
    }, 50);
  }

  private play(pcm: Uint8Array) {
    const ctx = this.ctx as AudioContext;
    const samples = new Int16Array(
      pcm.buffer,
      pcm.byteOffset,
      Math.floor(pcm.byteLength / 2),
    );
    if (samples.length === 0) return;
    if (this.sources.size === 0) {
      this.turnAudioMs = 0;
      this.nextPlayAt = 0;
      this.turnStartedAt = 0;
    }
    const buffer = ctx.createBuffer(
      1,
      samples.length,
      this.grant.config.sampleRate,
    );
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < samples.length; index++)
      channel[index] = samples[index] / 0x8000;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.outGain as GainNode);
    const at = Math.max(ctx.currentTime + 0.02, this.nextPlayAt);
    if (this.turnAudioMs === 0) this.turnStartedAt = at;
    source.start(at);
    this.nextPlayAt = at + buffer.duration;
    this.turnAudioMs += buffer.duration * 1000;
    this.audioOutMs += buffer.duration * 1000;
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      if (this.sources.size === 0) {
        this.turnAudioMs = 0;
        this.turnStartedAt = 0;
        this.nextPlayAt = 0;
        this.lastActivity = performance.now();
        if (!this.callerSpeaking) this.handlers.onSpeaking(null);
        if (
          !this.responseActive &&
          this.pendingTools === 0 &&
          !this.awaitingToolResponse &&
          !this.awaitingResponse
        ) {
          this.closeTurn();
        }
      }
    };
  }

  private stopAgentAudio() {
    // A Sample caller's own clip keeps playing: only the Agent is cut.
    for (const source of this.sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Already ended.
      }
    }
    this.sources.clear();
    this.nextPlayAt = 0;
    this.turnAudioMs = 0;
    this.turnStartedAt = 0;
  }

  /** Cuts off the Agent's current speech and records the Barge-in. */
  private async interruptAgent() {
    const played = Math.round(this.playedMs());
    const audioTotal = Math.floor(this.turnAudioMs);
    const wasResponseActive = this.responseActive;
    const itemId = this.currentItem;

    // Update turn state synchronously before any await so late chunks from the
    // cancelled response cannot sneak in during the microtask yield.
    this.turnSeq++;
    this.stopAgentAudio();
    this.turnPlayedMs = played;
    this.awaitingToolResponse = false;
    this.awaitingResponse = false;
    if (wasResponseActive) {
      this.turnInterrupted = true;
      this.cancelledResponseId = this.activeResponseId;
    }
    if (played > 0) {
      this.closeTurn(true);
      this.log("barge_in", `cut at ${played} ms`);
      this.handlers.onBargeIn(played);
      this.handlers.report([
        { type: "barge_in", atMs: this.ms(), playedMs: played },
      ]);
    } else {
      // Audio was only scheduled in the future and had not reached the speaker yet.
      this.turnText = "";
      this.turnPlayedMs = undefined;
      this.turnLatency = undefined;
      this.toolMs = 0;
    }
    if (!wasResponseActive) this.turnInterrupted = false;

    if (wasResponseActive) await this.send({ type: "response-cancel" });
    if (itemId) {
      await this.send({
        type: "conversation-item-truncate",
        itemId,
        contentIndex: 0,
        audioEndMs: Math.max(0, Math.min(played, audioTotal || played)),
      });
    }
  }

  private closeTurn(interrupted = this.turnInterrupted) {
    const text = this.turnText.trim();
    if (text) {
      const turn = {
        text,
        interrupted,
        playedMs: interrupted ? this.turnPlayedMs : undefined,
        latency: this.turnLatency
          ? {
              ...this.turnLatency,
              ...(this.toolMs ? { toolMs: this.toolMs } : {}),
            }
          : undefined,
      };
      this.handlers.onAgentTurn(turn);
      this.handlers.report([{ type: "turn.agent", atMs: this.ms(), ...turn }]);
    }
    this.turnText = "";
    this.turnInterrupted = false;
    this.turnPlayedMs = undefined;
    this.turnLatency = undefined;
    this.toolMs = 0;
  }

  private async onMessage(raw: string) {
    if (this.closed) return;
    let parsed: unknown;
    try {
      parsed = await this.codec.parseServerEvent(JSON.parse(raw));
    } catch {
      return;
    }
    for (const event of (Array.isArray(parsed) ? parsed : [parsed]) as Record<
      string,
      unknown
    >[]) {
      if (this.closed) return;
      const type = String(event.type);
      switch (type) {
        case "speech-started": {
          this.log(type);
          this.callerSpeaking = true;
          this.handlers.onSpeaking("caller");
          if (
            this.agentSpeaking() ||
            (this.responseActive && this.turnAudioMs > 0)
          ) {
            await this.interruptAgent();
          }
          break;
        }
        case "speech-stopped":
          this.callerSpeaking = false;
          this.speechStoppedAt = performance.now();
          this.awaitingFirstAudio = true;
          this.awaitingResponse = true;
          this.log(type);
          if (!this.agentSpeaking()) this.handlers.onSpeaking(null);
          break;
        case "input-transcription-completed": {
          const text = String(event.transcript ?? "").trim();
          if (!text) break;
          this.heardCaller += `\n${text}`;
          const via = this.mode === "sample" ? "sample" : "voice";
          this.log(type, text.slice(0, 80));
          this.handlers.onCaller(text, via);
          this.handlers.report([
            { type: "turn.caller", text, via, atMs: this.ms() },
          ]);
          break;
        }
        case "response-created":
          this.activeResponseId = String(event.responseId ?? "") || null;
          this.cancelledResponseId = null;
          this.responseActive = true;
          this.awaitingResponse = false;
          this.awaitingToolResponse = false;
          this.turnInterrupted = false;
          this.greeted = true;
          this.turnSeq++;
          this.log(type);
          break;
        case "output-item-added":
          this.currentItem = String(event.itemId ?? "");
          break;
        case "audio-delta": {
          if (
            this.turnInterrupted ||
            (event.responseId && event.responseId === this.cancelledResponseId)
          )
            break;
          if (this.awaitingFirstAudio && this.speechStoppedAt) {
            const firstAudioMs = Math.round(
              performance.now() - this.speechStoppedAt,
            );
            this.turnLatency = {
              firstAudioMs,
              detectMs: this.vadEnabled ? VAD_SILENCE_MS : 0,
            };
            this.log(
              "first-audio",
              `${firstAudioMs} ms after the Caller's Turn ended`,
            );
          }
          this.awaitingFirstAudio = false;
          if (event.itemId) this.currentItem = String(event.itemId);
          this.play(fromBase64(String(event.delta ?? "")));
          this.handlers.onSpeaking("agent");
          break;
        }
        case "audio-transcript-delta":
          if (
            this.turnInterrupted ||
            (event.responseId && event.responseId === this.cancelledResponseId)
          )
            break;
          this.turnText += String(event.delta ?? "");
          this.handlers.onAgentPartial(this.turnText);
          break;
        case "function-call-arguments-done": {
          const name = String(event.name ?? "");
          const callId = String(event.callId ?? "");
          const myTurnSeq = this.turnSeq;
          this.pendingTools++;
          this.log("tool.call", name);
          this.handlers.onTool(name, "start");
          const before = performance.now();
          let output: Record<string, unknown> = {
            error: "The Back office did not answer.",
          };
          let over = false;
          try {
            const response = await this.handlers.callTool({
              toolCallId: callId,
              name,
              arguments: String(event.arguments ?? "{}"),
              saying: this.turnText,
              hearing: this.heardCaller,
            });
            output = response.output;
            over = response.over !== null;
            this.handlers.onTool(name, "end", response);
            this.log(
              "tool.result",
              `${name}: ${response.summary}`.slice(0, 150),
            );
          } catch (error) {
            this.handlers.onTool(name, "end");
            this.log(
              "tool.error",
              error instanceof Error ? error.message : "failed",
            );
          }
          this.toolMs += Math.round(performance.now() - before);
          this.pendingTools--;
          if (this.closed) break;
          if (over) {
            this.handlers.onOver("The server ended the Call.");
            break;
          }
          const shouldContinue =
            this.pendingTools === 0 &&
            myTurnSeq === this.turnSeq &&
            !this.callerSpeaking;
          if (shouldContinue) this.awaitingToolResponse = true;
          await this.send({
            type: "conversation-item-create",
            item: {
              type: "function-call-output",
              callId,
              name,
              output: JSON.stringify(output),
            },
          });
          if (
            shouldContinue &&
            this.pendingTools === 0 &&
            myTurnSeq === this.turnSeq &&
            !this.callerSpeaking
          ) {
            await this.send({ type: "response-create" });
          } else if (shouldContinue) {
            this.awaitingToolResponse = false;
          }
          break;
        }
        case "response-done": {
          const responseId = String(event.responseId ?? "") || null;
          this.responseActive = false;
          this.lastActivity = performance.now();
          this.log(type, String(event.status ?? ""));
          if (responseId && responseId === this.cancelledResponseId) {
            this.cancelledResponseId = null;
            this.turnInterrupted = false;
          }
          // A Turn that only called a tool carries on in the next response;
          // otherwise close once buffered audio has finished playing.
          if (
            this.pendingTools === 0 &&
            !this.awaitingToolResponse &&
            (!this.agentSpeaking() || !this.audioClockRunning())
          ) {
            this.closeTurn();
          }
          const usage = event.usage as RealtimeUsage | undefined;
          if (usage) {
            this.handlers.onUsage(usage);
            this.handlers.report([{ type: "usage", usage }]);
          }
          const next = this.typed.shift();
          if (next) void this.say(next);
          break;
        }
        case "error": {
          const message = String(
            event.message ?? "The line reported an error.",
          );
          this.awaitingResponse = false;
          this.awaitingToolResponse = false;
          this.log("error", message.slice(0, 150));
          // A truncate that lost a race with the audio's end is not worth showing.
          if (!/already shorter|no active response|not found/i.test(message))
            this.handlers.report([
              { type: "session.error", message: message.slice(0, 300) },
            ]);
          break;
        }
        default:
          break;
      }
    }
  }

  /** A typed Turn, said into the same Session. */
  async say(text: string) {
    if (this.responseActive) {
      this.typed.push(text);
      return;
    }
    if (this.agentSpeaking()) await this.interruptAgent();
    this.heardCaller += `\n${text}`;
    this.handlers.onCaller(text, "text");
    this.handlers.report([
      { type: "turn.caller", text, via: "text", atMs: this.ms() },
    ]);
    this.speechStoppedAt = performance.now();
    this.awaitingFirstAudio = true;
    this.awaitingResponse = true;
    await this.send({
      type: "conversation-item-create",
      item: { type: "text-message", role: "user", text },
    });
    await this.send({ type: "response-create" });
  }

  stats() {
    return {
      audioInSeconds: Math.round(this.audioInMs / 100) / 10,
      audioOutSeconds: Math.round(this.audioOutMs / 100) / 10,
    };
  }

  /** Hangs up: the socket, the microphone, the speaker. */
  close() {
    if (this.closed) return;
    this.closed = true;
    this.closeTurn();
    if (this.feeder) clearInterval(this.feeder);
    if (this.director) clearInterval(this.director);
    this.micNode?.disconnect();
    for (const track of this.micStream?.getTracks() ?? []) track.stop();
    for (const source of [...this.sources, ...this.clipSources]) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Already ended.
      }
    }
    this.sources.clear();
    this.clipSources.clear();
    try {
      this.ws?.close();
    } catch {
      // Already closed.
    }
    void this.ctx?.close();
  }
}
