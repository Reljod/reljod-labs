import "server-only";
import { createGateway, streamText } from "ai";
import { answerKeyFor } from "../domain/answer-key";
import type { Usage, WalkEvent } from "../domain/api";
import { walkInstructions, walkPrompt } from "../domain/brief";
import { LIMITS } from "../domain/limits";
import { rulesFor } from "../domain/rules";
import { routeAt, zoneAt } from "../domain/sites";
import {
  checkSighting,
  type Finding,
  parseLine,
  type WalkerLine,
} from "../domain/walk";
import { env } from "./env";
import type { Footage } from "./footage";

/**
 * One Walk: the Walker watches the whole footage in one call and writes
 * NDJSON lines as it goes. Each complete line is parsed, checked by code
 * (`checkSighting`) and turned into events as soon as it arrives, so the page
 * shows Findings while the model is still writing.
 */
export async function* walk(
  footage: Footage,
  options: { stub: boolean; signal?: AbortSignal },
): AsyncGenerator<WalkEvent> {
  const started = Date.now();
  const rules = rulesFor(footage.site?.kind ?? null);
  const model = options.stub ? "stub/scripted-walker" : env.model();
  yield {
    t: "start",
    model,
    seconds: footage.seconds,
    rules: rules.map((r) => r.id),
  };

  const known: Finding[] = [];
  let n = 0;
  const nextId = () => `f${++n}`;
  let skipped = 0;

  function* judge(line: WalkerLine): Generator<WalkEvent> {
    if (line.type === "zone") {
      if (line.at >= 0 && line.at <= footage.seconds + 0.5)
        yield { t: "zone", at: line.at, zone: line.zone };
      return;
    }
    const verdict = checkSighting(line, {
      rules,
      seconds: footage.seconds,
      known,
      nextId,
    });
    if (verdict.kind === "finding") {
      known.push(verdict.finding);
      yield { t: "finding", finding: verdict.finding };
    } else if (verdict.kind === "merged") {
      known.find((f) => f.id === verdict.into)?.alsoAt.push(verdict.at);
      yield { t: "merged", into: verdict.into, at: verdict.at };
    } else if (verdict.kind === "noticed")
      yield { t: "noticed", noticed: verdict.noticed };
    else
      yield {
        t: "refused",
        reason: verdict.reason,
        sighting: verdict.sighting,
      };
  }

  // Each complete line goes out raw, then judged, so the two stay paired.
  function* take(raw: string): Generator<WalkEvent> {
    const text = raw.trim();
    if (!text || text.startsWith("```")) return;
    yield { t: "raw", line: text.slice(0, 600) };
    const line = parseLine(text);
    if (line) yield* judge(line);
    else skipped++;
  }

  if (options.stub) {
    for (const raw of scriptedLines(footage)) {
      await new Promise((resolve) => setTimeout(resolve, 120));
      yield* take(raw);
    }
    yield {
      t: "done",
      ms: Date.now() - started,
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      skipped,
    };
    return;
  }

  const gateway = createGateway({ apiKey: env.aiGatewayApiKey() });
  const timeout = AbortSignal.timeout(LIMITS.walkSeconds * 1000);
  const result = streamText({
    model: gateway(model),
    system: walkInstructions(),
    messages: [
      {
        role: "user",
        content: [
          { type: "file", data: footage.bytes, mediaType: footage.mediaType },
          {
            type: "text",
            text: walkPrompt(rules, footage.site, footage.seconds || null),
          },
        ],
      },
    ],
    maxOutputTokens: LIMITS.walkOutputTokens,
    temperature: 0.2,
    providerOptions: { google: { thinkingConfig: { thinkingLevel: "low" } } },
    abortSignal: options.signal
      ? AbortSignal.any([options.signal, timeout])
      : timeout,
  });

  let buffer = "";
  for await (const delta of result.textStream) {
    buffer += delta;
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    for (const raw of parts) yield* take(raw);
  }
  yield* take(buffer);
  const [usage, metadata] = await Promise.all([
    result.usage,
    result.providerMetadata,
  ]);
  yield {
    t: "done",
    ms: Date.now() - started,
    usage: usageOf(usage, metadata),
    skipped,
  };
}

export function usageOf(
  usage: { inputTokens?: number; outputTokens?: number } | undefined,
  metadata: unknown,
): Usage {
  const cost = (metadata as { gateway?: { cost?: unknown } } | undefined)
    ?.gateway?.cost;
  const costUsd =
    typeof cost === "string" || typeof cost === "number" ? Number(cost) : null;
  return {
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    costUsd: Number.isFinite(costUsd) ? costUsd : null,
  };
}

/**
 * The scripted Walker for e2e runs: for a Sample, the zones along the route
 * and one Sighting per planted problem at its clearest frame, from the answer
 * key; for an upload, one zone. No model, no spend.
 */
function scriptedLines(footage: Footage): string[] {
  const site = footage.site;
  if (!site)
    return [JSON.stringify({ type: "zone", at: 0, zone: "Uploaded footage" })];
  const lines: { at: number; text: string }[] = [];
  let last = "";
  for (let t = 0; t <= footage.seconds; t += 0.5) {
    const [x, y] = routeAt(site.route, t);
    const zone = zoneAt(site, x, y);
    if (zone && zone.label !== last) {
      last = zone.label;
      lines.push({
        at: t,
        text: JSON.stringify({ type: "zone", at: t, zone: zone.label }),
      });
    }
  }
  for (const item of answerKeyFor(site.slug)?.items ?? []) {
    if (item.decoy || !item.best) continue;
    lines.push({
      at: item.best.at,
      text: JSON.stringify({
        type: "sighting",
        at: item.best.at,
        rule: item.rule,
        zone: "",
        box: item.best.box.map((v) => Math.round(v * 1000)),
        saw: item.note,
        confidence: 0.9,
      }),
    });
  }
  return lines.sort((a, b) => a.at - b.at).map((l) => l.text);
}
