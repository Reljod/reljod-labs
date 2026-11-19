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

  // The Agent's current Turn.
  private nextPlayAt = 0;
  private turnStartedAt = 0; // ctx time the Turn's first audio plays
  private turnAudioMs = 0;
  private turnText = "";
  private turnInterrupted = false;
  private turnPlayedMs: number | undefined;
  private turnLatency: TurnLatency | undefined;
  private currentItem = "";
  private responseActive = false;
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
    if (this.ws?.readyState !== WebSocket.OPEN) return;
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
    if (!this.ctx || !this.turnStartedAt) return 0;
    return Math.max(
      0,
      Math.min(
        this.turnAudioMs,
        (this.ctx.currentTime - this.turnStartedAt) * 1000,
      ),
    );
  }

  private agentSpeaking() {
    return this.turnAudioMs > 0 && this.playedMs() < this.turnAudioMs - 20;
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
          return decoded.getChannelData(0);
        }),
      );
    } else if (wantMic) {
      try {
        this.micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            channelCount: 1,
          },
        });
        mic = "on";
        this.mode = "mic";
      } catch {
        mic = "refused";
      }
    }

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
        turnDetection: {
          type: "server-vad",
          threshold: 0.5,
          silenceDurationMs: VAD_SILENCE_MS,
          prefixPaddingMs: 300,
        },
        tools: this.grant.config.tools,
      },
    });
    // The Agent greets first.
    await this.send({ type: "response-create" });

    if (this.micStream) this.startMic();
    else this.startFeeder();
    if (this.sample) this.startDirector();
    return { connectMs, mic };
  }

  private startMic() {
    const ctx = this.ctx as AudioContext;
    const source = ctx.createMediaStreamSource(this.micStream as MediaStream);
    source.connect(this.analyserIn as AnalyserNode);
    // ScriptProcessor is old but everywhere, and a worklet needs a second file.
    this.micNode = ctx.createScriptProcessor(2048, 1, 1);
    this.micNode.onaudioprocess = (event) => {
      const samples = event.inputBuffer.getChannelData(0);
      this.audioInMs += (samples.length / ctx.sampleRate) * 1000;
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

  /** No microphone: the line still carries audio, a Sample caller's clip or silence, so turn detection works. */
  private startFeeder() {
    const rate = this.grant.config.sampleRate;
    const chunk = Math.round((rate * CHUNK_MS) / 1000);
    this.feeder = setInterval(() => {
      const out = new Float32Array(chunk);
      if (this.clipOffset >= 0) {
        const clip = this.clips[this.clipIndex];
        out.set(clip.subarray(this.clipOffset, this.clipOffset + chunk));
        this.clipOffset += chunk;
        this.audioInMs += CHUNK_MS;
        if (this.clipOffset >= clip.length) {
          this.clipOffset = -1;
          this.clipIndex++;
          this.lastActivity = performance.now();
          this.handlers.onSampleLine(null);
        }
      }
      void this.send({
        type: "input-audio-append",
        audio: toBase64(floatToPcm(out)),
      });
    }, CHUNK_MS);
  }

  private startLine() {
    const ctx = this.ctx as AudioContext;
    const clip = this.clips[this.clipIndex];
    if (!clip) return;
    this.handlers.onSampleLine(this.clipIndex);
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
    source.onended = () => this.clipSources.delete(source);
    this.clipOffset = 0;
  }

  /** The Sample caller's script: the next line when the line is quiet, or a Barge-in. */
  private startDirector() {
    this.director = setInterval(() => {
      if (this.closed || this.clipOffset >= 0 || !this.sample) return;
      const idle =
        !this.responseActive &&
        this.pendingTools === 0 &&
        !this.agentSpeaking();
      const quietFor = performance.now() - this.lastActivity;
      if (this.clipIndex >= this.clips.length) {
        if (idle && quietFor > 2500)
          this.handlers.onOver("The Caller hung up.");
        return;
      }
      const next = this.sample.lines[this.clipIndex];
      if (
        next.bargeAfterMs &&
        this.agentSpeaking() &&
        this.playedMs() >= next.bargeAfterMs
      ) {
        this.startLine();
        return;
      }
      if (idle && quietFor > 900 && this.turnStartedAt > 0) this.startLine();
    }, 50);
  }

  private play(pcm: Uint8Array) {
    const ctx = this.ctx as AudioContext;
    const samples = new Int16Array(
      pcm.buffer,
      pcm.byteOffset,
      Math.floor(pcm.byteLength / 2),
    );
    const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
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
      if (!this.agentSpeaking()) this.handlers.onSpeaking(null);
    };
  }

  private stopAgentAudio() {
    // A Sample caller's own clip keeps playing: only the Agent is cut.
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // Already ended.
      }
    }
    this.nextPlayAt = 0;
  }

  private closeTurn() {
    const text = this.turnText.trim();
    if (text) {
      const turn = {
        text,
        interrupted: this.turnInterrupted,
        playedMs: this.turnPlayedMs,
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
      const type = String(event.type);
      switch (type) {
        case "speech-started": {
          this.log(type);
          this.handlers.onSpeaking("caller");
          if (this.agentSpeaking()) {
            // Barge-in: the Caller spoke over the Agent. Stop the speaker now
            // and tell the model how much of its answer was really heard.
            const played = Math.round(this.playedMs());
            this.stopAgentAudio();
            if (this.currentItem)
              await this.send({
                type: "conversation-item-truncate",
                itemId: this.currentItem,
                contentIndex: 0,
                audioEndMs: Math.max(
                  0,
                  Math.min(played, Math.floor(this.turnAudioMs)),
                ),
              });
            this.turnAudioMs = played;
            this.turnInterrupted = true;
            this.turnPlayedMs = played;
            this.log("barge_in", `cut at ${played} ms`);
            this.handlers.onBargeIn(played);
            this.handlers.report([
              { type: "barge_in", atMs: this.ms(), playedMs: played },
            ]);
          }
          break;
        }
        case "speech-stopped":
          this.speechStoppedAt = performance.now();
          this.awaitingFirstAudio = true;
          this.log(type);
          this.handlers.onSpeaking(null);
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
          this.responseActive = true;
          this.log(type);
          break;
        case "output-item-added":
          this.currentItem = String(event.itemId ?? "");
          break;
        case "audio-delta": {
          if (this.turnInterrupted) break;
          if (this.awaitingFirstAudio && this.speechStoppedAt) {
            const firstAudioMs = Math.round(
              performance.now() - this.speechStoppedAt,
            );
            this.turnLatency = { firstAudioMs, detectMs: VAD_SILENCE_MS };
            this.log(
              "first-audio",
              `${firstAudioMs} ms after the Caller's Turn ended`,
            );
          }
          if (this.awaitingFirstAudio || !this.agentSpeaking()) {
            if (!this.agentSpeaking()) {
              this.turnAudioMs = 0;
              this.nextPlayAt = 0;
            }
          }
          this.awaitingFirstAudio = false;
          if (event.itemId) this.currentItem = String(event.itemId);
          this.play(fromBase64(String(event.delta ?? "")));
          this.handlers.onSpeaking("agent");
          break;
        }
        case "audio-transcript-delta":
          this.turnText += String(event.delta ?? "");
          this.handlers.onAgentPartial(this.turnText);
          break;
        case "function-call-arguments-done": {
          const name = String(event.name ?? "");
          const callId = String(event.callId ?? "");
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
          if (over) {
            this.handlers.onOver("The server ended the Call.");
            break;
          }
          await this.send({
            type: "conversation-item-create",
            item: {
              type: "function-call-output",
              callId,
              name,
              output: JSON.stringify(output),
            },
          });
          await this.send({ type: "response-create" });
          break;
        }
        case "response-done": {
          this.responseActive = false;
          this.lastActivity = performance.now();
          this.log(type, String(event.status ?? ""));
          // A Turn that only called a tool carries on in the next response.
          if (this.pendingTools === 0) this.closeTurn();
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
    if (this.agentSpeaking()) this.stopAgentAudio();
    this.heardCaller += `\n${text}`;
    this.handlers.onCaller(text, "text");
    this.handlers.report([
      { type: "turn.caller", text, via: "text", atMs: this.ms() },
    ]);
    this.speechStoppedAt = performance.now();
    this.awaitingFirstAudio = true;
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
      try {
        source.stop();
      } catch {
        // Already ended.
      }
    }
    try {
      this.ws?.close();
    } catch {
      // Already closed.
    }
    void this.ctx?.close();
  }
}
