import "server-only";

const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * The site a Sample is fetched from, for the request's Host header (or
 * `x-forwarded-host`). That header is the browser's to set, so it is used
 * only when it names this deployment or a local dev server; otherwise the
 * production URL, or null when there is none.
 */
export function siteOrigin(host: string): string | null {
  const known = [
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
  ].filter(Boolean);
  if (process.env.NODE_ENV !== "production" && LOCAL_HOSTS.test(host)) {
    return `http://${host}`;
  }
  if (known.includes(host)) return `https://${host}`;
  const fallback =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  return fallback ? `https://${fallback}` : null;
}
