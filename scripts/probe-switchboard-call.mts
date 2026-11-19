/**
 * Plays a Sample caller's clips into a real realtime Session, headless, with
 * the Back office in memory (the same pure code the app runs), and prints the
 * Call as it happened with measured latencies. For tuning the Agent's
 * instructions and the Sample scripts, and for measuring models.
 *
 *   node --env-file=.env.local scripts/probe-switchboard-call.mts <callerId> [modelId] [--quiet]
 *
 * Spends real money (a few cents a Call). Needs ffmpeg. Prints no secrets.
 */
import { execFileSync } from "node:child_process";
import { createGateway } from "ai";
import { createViteServer } from "vitest/node";

const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const server = await createViteServer({
  root,
  configFile: false,
  logLevel: "error",
  resolve: { alias: [{ find: /^@\//, replacement: `${root}/src/` }] },
  server: { middlewareMode: true, hmr: false, watch: null },
  appType: "custom",
  optimizeDeps: { noDiscovery: true, include: [] },
});
const load = (file: string) => server.ssrLoadModule(`/src/features/switchboard/domain/${file}`);
const { SAMPLE_CALLERS } = await load("samples.ts");
const { callInstructions } = await load("agent.ts");
const { DEFAULT_RULEBOOK } = await load("rules.ts");
const { runBackOfficeTool, NEW_CALL_STATE } = await load("backoffice.ts");
const { BACK_OFFICE_TOOLS } = await load("tools.ts");
const { seedRecords } = await load("world.ts");
const { realtimeCost, addUsage, realtimeModel, DEFAULT_REALTIME_MODEL } = await load("models.ts");
const { detectLanguage } = await load("hearing.ts");
const { z } = await import("zod");

const args = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const quiet = process.argv.includes("--quiet");
const caller = SAMPLE_CALLERS.find((item: { id: string }) => item.id === args[0]);
if (!caller) throw new Error(`Give a caller: ${SAMPLE_CALLERS.map((item: { id: string }) => item.id).join(", ")}`);
const modelId = args[1] ?? DEFAULT_REALTIME_MODEL;

const key = process.env.SWITCHBOARD_AI_GATEWAY_API_KEY ?? process.env.DOCUMENT_COMPLIANCE_AI_GATEWAY_API_KEY;
if (!key) throw new Error("No gateway key in the environment");
const gateway = createGateway({ apiKey: key });

const RATE = 24000;
const CHUNK_MS = 100;
const CHUNK = (RATE * CHUNK_MS) / 1000 * 2;
const clips: Buffer[] = caller.lines.map((_line: unknown, index: number) =>
  execFileSync("ffmpeg", ["-loglevel", "error", "-i", `${root}/public/switchboard/samples/${caller.id}/${index + 1}.mp3`, "-f", "s16le", "-ar", String(RATE), "-ac", "1", "-"], { maxBuffer: 64e6 }),
);

// Back office in memory.
let records = seedRecords().map((record: { kind: string; ref: string; data: unknown }, index: number) => ({ id: String(index), ...record, callId: null, createdAt: "", updatedAt: "" }));
let state = NEW_CALL_STATE;
let refSeq = 0;
const heard = { agent: "", caller: "" };

const tools = Object.entries(BACK_OFFICE_TOOLS).map(([name, tool]) => ({
  type: "function" as const,
  name,
  description: (tool as { description: string }).description,
  parameters: z.toJSONSchema((tool as { input: unknown }).input as never) as never,
}));

const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s`;
const log = (line: string) => console.log(`${at()} ${line}`);

const minted = Date.now();
const { token, url } = await gateway.experimental_realtime.getToken({ model: modelId, expiresAfterSeconds: 300 });
const model = gateway.experimental_realtime(modelId);
const config = model.getWebSocketConfig({ token, url });
const ws = new WebSocket(config.url, config.protocols);
const send = async (event: Parameters<typeof model.serializeClientEvent>[0]) => {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(await model.serializeClientEvent(event)));
};

let usage = {};
let cost = 0;
let lineIndex = 0;
let clipOffset = -1; // -1: not playing a clip
let clipEndedAt = 0;
let speechStoppedAt = 0;
let awaitingFirstAudio = false;
let responseActive = false;
let agentAudioMs = 0; // audio received for the current agent turn
let agentAudioStartedAt = 0;
let agentTurnText = "";
let lastActivity = Date.now();
let bargeTimer: ReturnType<typeof setTimeout> | null = null;
let pendingTools = 0;
let currentItem = "";
const latencies: number[] = [];
const perceived: number[] = [];
let done = false;

const playedMs = () => Math.min(agentAudioMs, Date.now() - agentAudioStartedAt);
const agentSpeaking = () => agentAudioStartedAt > 0 && playedMs() < agentAudioMs;

function startLine() {
  if (lineIndex >= clips.length) return;
  const line = caller.lines[lineIndex];
  if (agentSpeaking()) {
    log(`  ✂ BARGE-IN at ${Math.round(playedMs())}ms of the Agent's audio`);
  }
  log(`CALLER ▶ ${line.text}`);
  clipOffset = 0;
}

ws.addEventListener("open", async () => {
  log(`session open (mint+connect ${Date.now() - minted}ms) model ${modelId}`);
  await send({
    type: "session-update",
    config: {
      instructions: callInstructions(DEFAULT_RULEBOOK, true),
      voice: realtimeModel(modelId)?.voice,
      outputModalities: ["audio"],
      inputAudioFormat: { type: "audio/pcm", rate: RATE },
      outputAudioFormat: { type: "audio/pcm", rate: RATE },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      turnDetection: { type: "server-vad", threshold: 0.5, silenceDurationMs: 500, prefixPaddingMs: 300 },
      tools,
    } as never,
  });
  // The Agent greets first.
  await send({ type: "response-create" });
  lastActivity = Date.now();
});

// The microphone: 100 ms of the clip, or of silence, every 100 ms.
const mic = setInterval(() => {
  if (ws.readyState !== WebSocket.OPEN) return;
  let chunk: Buffer;
  if (clipOffset >= 0) {
    const clip = clips[lineIndex];
    chunk = clip.subarray(clipOffset, clipOffset + CHUNK);
    clipOffset += CHUNK;
    if (clipOffset >= clip.length) {
      clipOffset = -1;
      clipEndedAt = Date.now();
      lineIndex++;
      lastActivity = Date.now();
    }
    if (chunk.length < CHUNK) chunk = Buffer.concat([chunk, Buffer.alloc(CHUNK - chunk.length)]);
  } else {
    chunk = Buffer.alloc(CHUNK);
  }
  void send({ type: "input-audio-append", audio: chunk.toString("base64") });
}, CHUNK_MS);

// The script: the next line starts when the line has been quiet, or barges in.
const director = setInterval(() => {
  if (done || clipOffset >= 0) return;
  const idle = !responseActive && pendingTools === 0 && !agentSpeaking();
  if (lineIndex >= clips.length) {
    if (idle && Date.now() - lastActivity > 2500) finish("script finished");
    return;
  }
  const next = caller.lines[lineIndex];
  if (next.bargeAfterMs && agentAudioStartedAt && agentSpeaking() && !bargeTimer && playedMs() >= next.bargeAfterMs) {
    startLine();
    return;
  }
  if (idle && Date.now() - lastActivity > 900 && agentAudioStartedAt >= 0) startLine();
}, 50);

ws.addEventListener("message", async (message) => {
  const parsed = model.parseServerEvent(JSON.parse(String(message.data)));
  for (const event of Array.isArray(parsed) ? parsed : [parsed]) {
    if (!quiet && !["audio-delta", "audio-transcript-delta", "function-call-arguments-delta", "custom"].includes(event.type)) {
      // log(`    · ${event.type}`);
    }
    switch (event.type) {
      case "speech-started":
        log("    · speech-started");
        if (agentSpeaking() || responseActive) {
          const cut = Math.round(playedMs());
          if (currentItem) await send({ type: "conversation-item-truncate", itemId: currentItem, contentIndex: 0, audioEndMs: cut });
          agentAudioMs = Math.min(agentAudioMs, cut);
        }
        break;
      case "speech-stopped":
        speechStoppedAt = Date.now();
        awaitingFirstAudio = true;
        log(`    · speech-stopped (${clipEndedAt ? speechStoppedAt - clipEndedAt : "?"}ms after the clip ended)`);
        break;
      case "input-transcription-completed":
        heard.caller += `\n${event.transcript}`;
        log(`    heard caller [${detectLanguage(event.transcript)}]: ${event.transcript.trim()}`);
        break;
      case "response-created":
        responseActive = true;
        agentTurnText = "";
        break;
      case "output-item-added":
        currentItem = event.itemId;
        break;
      case "audio-delta": {
        const ms = ((event.delta.length * 3) / 4 / 2 / RATE) * 1000;
        if (awaitingFirstAudio || agentAudioMs === 0 || !agentSpeaking()) {
          if (awaitingFirstAudio && speechStoppedAt) {
            latencies.push(Date.now() - speechStoppedAt);
            if (clipEndedAt) perceived.push(Date.now() - clipEndedAt);
            log(`    ⏱ first audio ${Date.now() - speechStoppedAt}ms after speech-stopped, ${clipEndedAt ? Date.now() - clipEndedAt : "?"}ms after the Caller stopped`);
          }
          awaitingFirstAudio = false;
          agentAudioStartedAt = Date.now();
          agentAudioMs = 0;
        }
        agentAudioMs += ms;
        currentItem = event.itemId;
        break;
      }
      case "audio-transcript-delta":
        agentTurnText += event.delta;
        break;
      case "audio-transcript-done":
        heard.agent += `\n${event.transcript ?? agentTurnText}`;
        log(`AGENT  ◀ [${detectLanguage(event.transcript ?? agentTurnText)}] ${(event.transcript ?? agentTurnText).trim()}`);
        break;
      case "function-call-arguments-done": {
        pendingTools++;
        let input: unknown = {};
        try { input = JSON.parse(event.arguments || "{}"); } catch {}
        const result = runBackOfficeTool(event.name, input, {
          rulebook: DEFAULT_RULEBOOK, state, records, heard: { agent: `${heard.agent}\n${agentTurnText}`, caller: heard.caller }, refSeq, now: new Date(), overDeadline: false,
        });
        state = result.state;
        refSeq = result.refSeq;
        for (const write of result.writes) {
          const index = records.findIndex((record: { kind: string; ref: string }) => record.kind === write.kind && record.ref === write.ref);
          if (index >= 0) records[index] = { ...records[index], data: write.data };
          else records.push({ id: String(records.length), kind: write.kind, ref: write.ref, data: write.data, callId: null, createdAt: "", updatedAt: "" });
        }
        log(`  🔧 ${event.name}(${event.arguments.replace(/\s+/g, " ")}) → ${result.ok ? "ok" : result.refusal.length ? `REFUSED by ${result.refusal.map((item: { ruleId: string }) => item.ruleId).join(" + ")}` : "failed"}: ${result.summary}`);
        await send({ type: "conversation-item-create", item: { type: "function-call-output", callId: event.callId, name: event.name, output: JSON.stringify(result.output) } });
        await send({ type: "response-create" });
        pendingTools--;
        awaitingFirstAudio = false;
        break;
      }
      case "response-done":
        responseActive = false;
        lastActivity = Date.now();
        if (event.usage) {
          usage = addUsage(usage, event.usage);
          cost += realtimeCost(modelId, event.usage);
        }
        if (event.status !== "completed") log(`    · response ${event.status}`);
        break;
      case "error":
        log(`    ! error: ${event.message}`);
        break;
    }
  }
});

function finish(reason: string) {
  if (done) return;
  done = true;
  clearInterval(mic);
  clearInterval(director);
  const sorted = [...latencies].sort((a, b) => a - b);
  const mid = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  const p = [...perceived].sort((a, b) => a - b);
  console.log(JSON.stringify({
    caller: caller.id, model: modelId, reason, seconds: Math.round((Date.now() - t0) / 1000),
    firstAudioMs: { turns: sorted.length, median: mid, worst: sorted.at(-1) ?? null, all: latencies },
    perceivedMs: { median: p.length ? p[Math.floor(p.length / 2)] : null, all: perceived },
    costUsd: Number(cost.toFixed(4)), usage, state,
    created: records.filter((record: { kind: string }) => !["booking", "disruption"].includes(record.kind)).map((record: { kind: string; ref: string }) => `${record.kind}:${record.ref}`),
  }));
  ws.close();
  void server.close().then(() => process.exit(0));
}
ws.addEventListener("close", (event) => finish(`socket closed ${event.code} ${event.reason}`));
setTimeout(() => finish("timeout"), 240_000);
