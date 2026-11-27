import "server-only";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

/** Read lazily so `next build` works without secrets. Values are never logged. */
export const env = {
  /** Falls back to the document compliance key, like the other demos. */
  aiGatewayApiKey: () =>
    process.env.PRISM_AI_GATEWAY_API_KEY?.trim() ||
    required("DOCUMENT_COMPLIANCE_AI_GATEWAY_API_KEY"),
};
