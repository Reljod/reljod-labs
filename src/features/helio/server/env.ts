import "server-only";

export const env = {
  aiGatewayApiKey(): string {
    return (
      process.env.HELIO_AI_GATEWAY_API_KEY?.trim() ||
      process.env.DOCUMENT_COMPLIANCE_AI_GATEWAY_API_KEY?.trim() ||
      ""
    );
  },
  flashImageModel(): string {
    return (
      process.env.HELIO_IMAGE_MODEL?.trim() || "microsoft/mai-image-2.7-flash"
    );
  },
  flagshipImageModel(): string {
    return (
      process.env.HELIO_FLAGSHIP_IMAGE_MODEL?.trim() ||
      "microsoft/mai-image-2.7"
    );
  },
  directorModel(): string {
    return process.env.HELIO_DIRECTOR_MODEL?.trim() || "google/gemini-4-neon";
  },
  rateLimitSalt(): string {
    return process.env.RATE_LIMIT_SALT?.trim() || "helio-dev-salt";
  },
  e2eBypassToken(): string {
    return process.env.E2E_BYPASS_TOKEN?.trim() || "";
  },
};
