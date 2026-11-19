import { createGateway } from "ai";
import { env } from "./env";

/** Every model Switchboard calls goes through Vercel AI Gateway. */
export const gateway = () => createGateway({ apiKey: env.aiGatewayApiKey() });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** The price the gateway charged, from `providerMetadata.gateway.cost`, or null. */
export function gatewayCost(providerMetadata: unknown): number | null {
  const meta = isRecord(providerMetadata) ? providerMetadata.gateway : undefined;
  if (!isRecord(meta)) return null;
  for (const value of [meta.cost, meta.marketCost]) {
    const number = typeof value === "string" ? Number(value) : value;
    if (typeof number === "number" && Number.isFinite(number)) return number;
  }
  return null;
}
