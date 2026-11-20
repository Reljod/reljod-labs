import "server-only";

function read(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export const env = {
  aiGatewayApiKey(): string {
    const key =
      read("PRISM_AI_GATEWAY_API_KEY") ??
      read("DOCUMENT_COMPLIANCE_AI_GATEWAY_API_KEY");
    if (!key) {
      throw new Error(
        "Missing PRISM_AI_GATEWAY_API_KEY (or DOCUMENT_COMPLIANCE_AI_GATEWAY_API_KEY).",
      );
    }
    return key;
  },
  rateLimitSalt(): string {
    return read("RATE_LIMIT_SALT") ?? "prism-dev-salt";
  },
  e2eBypassToken(): string | undefined {
    return read("E2E_BYPASS_TOKEN");
  },
};
