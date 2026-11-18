/**
 * Signed links to Sample files (portraits, documents), shared by everyone and
 * read-only, kept and reused while they have ample life left, so the same link
 * comes back and the browser's image cache works. Never used for an Owner's
 * own files: those are signed per request.
 */
export const SEED_URL_TTL_SECONDS = 2 * 60 * 60;
/** A kept link is handed out again only while it has more than this left. */
export const SEED_URL_MIN_LEFT_MS = 60 * 60 * 1000;
const MAX_KEPT = 500;

type Sign = (
  paths: string[],
  expiresInSeconds: number,
) => Promise<Map<string, string>>;

export function seedUrlCache(sign: Sign, now: () => number = Date.now) {
  const kept = new Map<string, { url: string; expiresAt: number }>();
  return async function urls(paths: string[]): Promise<Map<string, string>> {
    const at = now();
    const result = new Map<string, string>();
    const missing: string[] = [];
    for (const path of new Set(paths.filter(Boolean))) {
      const hit = kept.get(path);
      if (hit && hit.expiresAt - at > SEED_URL_MIN_LEFT_MS)
        result.set(path, hit.url);
      else missing.push(path);
    }
    if (missing.length === 0) return result;
    const fresh = await sign(missing, SEED_URL_TTL_SECONDS);
    const expiresAt = at + SEED_URL_TTL_SECONDS * 1000;
    for (const [path, url] of fresh) {
      result.set(path, url);
      kept.delete(path);
      kept.set(path, { url, expiresAt });
    }
    // Oldest first out, so the Map stays small.
    while (kept.size > MAX_KEPT) {
      const oldest = kept.keys().next().value;
      if (oldest === undefined) break;
      kept.delete(oldest);
    }
    return result;
  };
}
