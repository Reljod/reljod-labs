/**
 * Probe: can this project's AI Gateway key hold a realtime speech-to-speech
 * session, and how fast is each model? Text in, audio + tool call out.
 *
 *   node --env-file=.env.local scripts/probe-switchboard-realtime.mts [model ...]
 *
 * Spends a few cents. Prints timings only, never the key or a token.
 */
import { createGateway } from "ai";

const key =
  process.env.SWITCHBOARD_AI_GATEWAY_API_KEY ??
  process.env.DOCUMENT_COMPLIANCE_AI_GATEWAY_API_KEY;
if (!key) throw new Error("No gateway key in the environment");
const gateway = createGateway({ apiKey: key });

const models = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["openai/gpt-realtime-mini", "openai/gpt-realtime-2.1", "google/gemini-3.8-live"];

const tools = [
  {
    type: "function" as const,
    name: "find_booking",
    description: "Look up a Meridia Rail booking by its reference.",
    parameters: {
      type: "object" as const,
      properties: { reference: { type: "string" as const } },
      required: ["reference"],
    },
  },
];

async function probe(modelId: string, text: string) {
  const started = Date.now();
  const { token, url } = await gateway.experimental_realtime.getToken({
    model: modelId,
    expiresAfterSeconds: 120,
  });
  const minted = Date.now();
  const model = gateway.experimental_realtime(modelId);
  const config = model.getWebSocketConfig({ token, url });
  const ws = new WebSocket(config.url, config.protocols);
  const out: Record<string, unknown> = { model: modelId, mintMs: minted - started };
  const seen = new Map<string, number>();
  let sent = 0;
  let audioBytes = 0;
  let transcript = "";
  let toolDone = false;

  const send = async (event: Parameters<typeof model.serializeClientEvent>[0]) =>
    ws.send(JSON.stringify(await model.serializeClientEvent(event)));

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      out.timeout = true;
      resolve();
    }, 30000);
    ws.addEventListener("open", async () => {
      out.openMs = Date.now() - minted;
      await send({
        type: "session-update",
        config: {
          instructions:
            "You are the Meridia Rail phone agent. Answer in the caller's language, briefly. Use find_booking before talking about a booking.",
          voice: process.env.PROBE_VOICE,
          outputModalities: ["audio"],
          inputAudioFormat: { type: "audio/pcm", rate: 24000 },
          outputAudioFormat: { type: "audio/pcm", rate: 24000 },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          turnDetection: { type: "server-vad" },
          tools,
        } as never,
      });
      await send({
        type: "conversation-item-create",
        item: { type: "text-message", role: "user", text },
      });
      await send({ type: "response-create" });
      sent = Date.now();
    });
    ws.addEventListener("message", async (message) => {
      const parsed = model.parseServerEvent(JSON.parse(String(message.data)));
      for (const event of Array.isArray(parsed) ? parsed : [parsed]) {
        if (!seen.has(event.type)) seen.set(event.type, Date.now() - (sent || minted));
        if (event.type === "audio-delta") audioBytes += (event.delta.length * 3) / 4;
        if (event.type === "audio-transcript-delta") transcript += event.delta;
        if (event.type === "error") out.error = event.message;
        if (event.type === "function-call-arguments-done") {
          out.toolCall = `${event.name}(${event.arguments})`;
          out.toolCallMs = Date.now() - sent;
          await send({
            type: "conversation-item-create",
            item: {
              type: "function-call-output",
              callId: event.callId,
              name: event.name,
              output: JSON.stringify({
                reference: "MR-7K2Q9F",
                train: "IC 418 Port Calder to Vessin, 14:05",
                status: "delayed 40 minutes, signalling fault at Arden Junction",
              }),
            },
          });
          await send({ type: "response-create" });
          toolDone = true;
          seen.delete("audio-delta");
          sent = Date.now();
        }
        if (event.type === "response-done") {
          out.usage = event.usage;
          if (toolDone || !out.toolCall) {
            if (audioBytes > 0 || event.status !== "completed") {
              out.status = event.status;
              clearTimeout(timer);
              resolve();
            }
          }
        }
      }
    });
    ws.addEventListener("error", () => {
      out.socketError = true;
      clearTimeout(timer);
      resolve();
    });
    ws.addEventListener("close", (event) => {
      out.close = `${event.code} ${event.reason}`.trim();
      clearTimeout(timer);
      resolve();
    });
  });
  out.firstAudioAfterToolMs = seen.get("audio-delta");
  out.audioSeconds = Math.round((audioBytes / 2 / 24000) * 10) / 10;
  out.transcript = transcript;
  out.events = [...seen.keys()].join(",");
  ws.close();
  return out;
}

for (const modelId of models) {
  for (const text of [
    "Hi, my booking is MR-7K2Q9F. Is my train delayed?",
    "Kumusta, yung booking ko MR-7K2Q9F, late ba yung tren ko?",
  ]) {
    try {
      console.log(JSON.stringify(await probe(modelId, text)));
    } catch (error) {
      console.log(JSON.stringify({ model: modelId, failed: String(error).slice(0, 300) }));
    }
  }
}
process.exit(0);
