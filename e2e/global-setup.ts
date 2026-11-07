const REQUIRED = [
  "OPENAI_API_KEY",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "PARSER_URL",
  "RATE_LIMIT_SALT",
  "E2E_BYPASS_TOKEN",
];

/** Fails fast with a clear message instead of six five-minute timeouts. */
export default async function globalSetup() {
  const missing = REQUIRED.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Set these in .env.local first: ${missing.join(", ")}`);
  }

  const health = `${process.env.PARSER_URL}/health`;
  try {
    const response = await fetch(health);
    if (!response.ok) throw new Error(`status ${response.status}`);
  } catch (error) {
    throw new Error(
      `The parser is not reachable at ${health} (${String(error)}). Start it with \`docker compose up parser\`.`,
    );
  }
}
