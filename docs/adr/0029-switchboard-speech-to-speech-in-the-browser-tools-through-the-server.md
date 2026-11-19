# 0029. Switchboard: speech to speech in the browser, tools through the server

Date: 2026-11-19. Status: accepted.

## Context

Switchboard is a phone line you can interrupt. That needs true speech to speech (one model hears and speaks), not a transcribe, think, speak cascade, or Barge-in and sub-second answers are lost. Vercel AI Gateway serves realtime models over a WebSocket (`experimental_realtime` in AI SDK 7). A Vercel Function cannot hold a WebSocket open for a caller, and the gateway key must never reach the browser.

The agent must also follow Rules it cannot talk around, and the same Back office must serve the voice Session, a text box and an outside MCP client.

## Decision

1. **The realtime Session lives in the browser.** The server starts the Call, mints a one-minute client secret (`gateway.experimental_realtime.getToken`) and writes the Session's setup (instructions from the Call's Rulebook, the tool list). The browser opens the socket with the secret and streams PCM16 at 24 kHz both ways (`components/voice-session.ts`).
2. **Every tool call goes back through the server.** When the model asks for a tool, the browser posts the call to `POST /api/switchboard/calls/[id]/tools`, which runs `callTool`: the Call's row lock, the pure `runBackOfficeTool` (Rules checked by code), the Record writes and two Events in one transaction. The MCP server's tools and the text Line call the same `callTool`. The browser can refuse to forward a call. It cannot make one pass identity, a limit or the clock; the one thing it supplies is what was said (see below), which the Disclosure and flagged-mention checks read.
3. **One Agent, two Lines.** The text Line runs the same instructions and tools a Turn at a time on the server with a language model (`server/line.ts`). It serves visitors without a microphone, the MCP tool `caller_says`, and the end-to-end test (where the model is replaced by canned Turns, `domain/stub.ts`; the tool calls stay real).
4. **Default model `openai/gpt-realtime-2.1`**, with Gemini 3.8 Live and GPT-Realtime mini selectable. Measured on 2026-11-19 with the project's key, synthetic callers fed as audio: time to first audio after turn detection, median 0.94 s over one five-Turn call from Node (0.84 to 1.66 s) and 0.65 to 1.6 s across four other callers; 1.34 s on the first Turn of the live Playwright run in headless Chrome. Turn detection waits 500 ms of silence before that, which the caller also feels; the page shows both. A two-minute call cost about $0.17. This is "about a second", not "well under" on every Turn; the page reports each Turn's number rather than a claim.
5. **In-call writes are POST routes, not server actions.** A browser sends its server actions one at a time; a live Call has a tool call, transcript reports and a hang-up in flight together.

## What is honest about this

- **The transcript of a voice Call is reported by the browser** (`POST …/events`): what the Session transcribed, the Barge-ins, the latencies, the usage. The server cannot hear the socket. It is the Owner's own account of their own Call. It feeds the Checks that read the transcript (a Disclosure said before a tool) and the Scorecard; a visitor who forges it (the reported Turns, or the `saying` and `hearing` sent with a tool call) can get past a Disclosure or flagged-mention check on their own Call and fool their own Scorecard, in their own copy of the Back office. A production line would transcribe on the server side of the socket (a relay) instead; here the trade is stated rather than hidden. No Record changes except through `callTool`, and identity, limits and the clock never depend on the transcript.
- **Cost is computed on the server** from the usage the browser reports, at list price, and caps the Call. A browser that under-reports usage is bounded by the Call's length instead (below).
- **The hard cut-off is on what the server controls.** At the deadline the Call's Workflow marks it `cut_off`; from then on every tool call and report is refused and the page hangs up. The server cannot close a socket it does not hold: a modified client could keep talking to the model until the provider's own session limit, with no tools and nothing saved. The client secret is good for one minute and one socket, and Calls per hour are capped per visitor.
- The realtime API is `experimental_` in AI SDK 7 and the browser client is hand-written against its codec (`@ai-sdk/react` is not installed). An SDK upgrade may need changes in `voice-session.ts`.

## Consequences

- No audio passes through or is stored by the server. Consented recording was designed (bucket `switchboard`, column `audio_path`) but is not built; the page says no audio is stored.
- The text Line calls `callTool` in process rather than through an MCP client over HTTP as the Harness does (ADR 0013): one fewer round trip per tool call inside a Turn, the same function either way.
