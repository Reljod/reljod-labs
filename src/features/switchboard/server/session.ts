import "server-only";
import { createGateway } from "ai";
import { z } from "zod";
import { callInstructions } from "../domain/agent";
import type { CallView } from "../domain/contract";
import { realtimeModel } from "../domain/models";
import { BACK_OFFICE_TOOLS } from "../domain/tools";
import { env } from "./env";

/** How long the browser has to open the socket with the client secret. */
const SECRET_SECONDS = 60;

export const SAMPLE_RATE = 24_000;

/** The Back office tools as the realtime Session is given them. */
export function sessionTools() {
  return Object.entries(BACK_OFFICE_TOOLS).map(([name, tool]) => ({
    type: "function" as const,
    name,
    description: tool.description,
    parameters: z.toJSONSchema(tool.input) as Record<string, unknown>,
  }));
}

export type SessionGrant = {
  /** A short-lived client secret for one socket; the gateway key never leaves the server. */
  token: string;
  url: string;
  model: string;
  mintMs: number;
  config: {
    instructions: string;
    voice: string | undefined;
    tools: ReturnType<typeof sessionTools>;
    sampleRate: number;
  };
};

/**
 * Mints what the browser needs to open the Call's realtime Session: a client
 * secret good for one minute and the Session's setup, written by the server
 * from the Rulebook the Call started under. A Vercel Function cannot hold a
 * socket open, so the audio goes browser to gateway; every tool call comes
 * back through the server (ADR 0029).
 */
export async function grantSession(call: CallView): Promise<SessionGrant> {
  const started = Date.now();
  const gateway = createGateway({ apiKey: env.aiGatewayApiKey() });
  const { token, url } = await gateway.experimental_realtime.getToken({
    model: call.model,
    expiresAfterSeconds: SECRET_SECONDS,
  });
  return {
    token,
    url,
    model: call.model,
    mintMs: Date.now() - started,
    config: {
      instructions: callInstructions(call.rulebook, true),
      voice: realtimeModel(call.model)?.voice,
      tools: sessionTools(),
      sampleRate: SAMPLE_RATE,
    },
  };
}
