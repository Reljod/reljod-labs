import "server-only";
import { createGateway, generateText } from "ai";
import { z } from "zod";
import type { AskAnswer, Moment } from "../domain/api";
import { askInstructions, askPrompt } from "../domain/brief";
import { LIMITS } from "../domain/limits";
import { round, toBox } from "../domain/walk";
import { env } from "./env";
import type { Footage } from "./footage";
import { usageOf } from "./walker";

const replySchema = z.object({
  answer: z.string().min(1).max(800),
  moments: z
    .array(
      z.object({
        at: z.number(),
        box: z.array(z.number()).length(4).nullable().optional(),
        label: z.string().max(80).default(""),
      }),
    )
    .max(8)
    .default([]),
});

/** Strips control characters and caps a model string before it is shown. */
function clean(text: string, max: number) {
  return text
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * Ask the footage: one more call over the same video, answered with moments
 * the page can jump to. The reply is data: parsed, clamped to the footage and
 * the frame, and anything that is not a moment is dropped.
 */
export async function ask(
  footage: Footage,
  question: string,
  options: { stub: boolean; signal?: AbortSignal },
): Promise<AskAnswer> {
  const started = Date.now();
  if (options.stub) {
    return {
      answer: `Scripted answer to ${JSON.stringify(question.slice(0, 60))}: the walk starts here.`,
      moments: [{ at: 0, box: null, label: "Start of the walk" }],
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      ms: Date.now() - started,
    };
  }
  const gateway = createGateway({ apiKey: env.aiGatewayApiKey() });
  const result = await generateText({
    model: gateway(env.model()),
    system: askInstructions(),
    messages: [
      {
        role: "user",
        content: [
          { type: "file", data: footage.bytes, mediaType: footage.mediaType },
          { type: "text", text: askPrompt(question, footage.site) },
        ],
      },
    ],
    maxOutputTokens: LIMITS.askOutputTokens,
    temperature: 0.2,
    providerOptions: { google: { thinkingConfig: { thinkingLevel: "low" } } },
    abortSignal: options.signal,
  });
  const text = result.text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  let parsed: z.infer<typeof replySchema> | null = null;
  try {
    const candidate = replySchema.safeParse(
      JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)),
    );
    parsed = candidate.success ? candidate.data : null;
  } catch {
    parsed = null;
  }
  const moments: Moment[] = (parsed?.moments ?? [])
    .filter((m) => m.at >= 0 && m.at <= footage.seconds + 0.5)
    .slice(0, 4)
    .map((m) => ({
      at: round(m.at),
      box: m.box ? (toBox(m.box) as Moment["box"]) : null,
      label: clean(m.label, 60),
    }));
  return {
    answer: parsed
      ? clean(parsed.answer, 600)
      : "The Walker's answer could not be read. Ask again.",
    moments,
    usage: usageOf(result.usage, result.providerMetadata),
    ms: Date.now() - started,
  };
}
