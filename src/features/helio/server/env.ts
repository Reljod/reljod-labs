import "server-only";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

/** Read lazily so `next build` works without secrets. Values are never logged. */
export const env = {
  aiGatewayApiKey: () =>
    process.env.HELIO_AI_GATEWAY_API_KEY?.trim() ||
    required("DOCUMENT_COMPLIANCE_AI_GATEWAY_API_KEY"),
  flashImageModel: () =>
    process.env.HELIO_IMAGE_MODEL?.trim() || "microsoft/mai-image-2.7-flash",
  flagshipImageModel: () =>
    process.env.HELIO_FLAGSHIP_IMAGE_MODEL?.trim() || "microsoft/mai-image-2.7",
  directorModel: () =>
    process.env.HELIO_DIRECTOR_MODEL?.trim() || "google/gemini-4-neon",
};
