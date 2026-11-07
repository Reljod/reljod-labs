const REQUIRED = [
  "DOCUMENT_COMPLIANCE_AI_GATEWAY_API_KEY",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "RATE_LIMIT_SALT",
  "E2E_BYPASS_TOKEN",
];

/** Fails fast with a clear message instead of six five-minute timeouts. */
export default async function globalSetup() {
  const missing = REQUIRED.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Set these in .env.local first: ${missing.join(", ")}`);
  }
}
