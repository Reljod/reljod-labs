import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

export const BUCKET = "document-compliance";

let client: ReturnType<typeof createServiceClient> | undefined;

/**
 * For Storage only (the private `document-compliance` bucket). Database reads
 * and writes go straight to Postgres through `sql()` in `./db`.
 */
function createServiceClient() {
  return createClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Service-role Storage client: server code only. */
export function supabase() {
  client ??= createServiceClient();
  return client;
}

export async function signedUrl(path: string, expiresInSeconds = 600) {
  const { data, error } = await supabase()
    .storage.from(BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error) throw new Error(`Could not sign ${path}: ${error.message}`);
  return data.signedUrl;
}

/** A signed URL kept for reuse, and when it stops working (ms since epoch). */
const pageUrls = new Map<string, { url: string; expiresAt: number }>();

/** How long a page URL is signed for, and how much of that it must have left to be reused. */
const PAGE_URL_SECONDS = 2 * 3600;
const PAGE_URL_MIN_LEFT_MS = 3600 * 1000;

/**
 * Signed URLs for the preset pack pages. They are shared seed files, the same
 * for every Owner, so a URL is reused across runs and visitors while it has
 * at least an hour left: a run opens without a Storage round trip, and the
 * browser finds the same image URL in its cache instead of downloading the
 * page again under a new signature.
 */
export async function packPageUrls(paths: string[]) {
  const now = Date.now();
  const missing = [
    ...new Set(
      paths.filter(
        (path) =>
          (pageUrls.get(path)?.expiresAt ?? 0) - now < PAGE_URL_MIN_LEFT_MS,
      ),
    ),
  ];
  if (missing.length > 0) {
    const { data, error } = await supabase()
      .storage.from(BUCKET)
      .createSignedUrls(missing, PAGE_URL_SECONDS);
    if (error) throw new Error(`Could not sign page images: ${error.message}`);
    const expiresAt = now + PAGE_URL_SECONDS * 1000;
    for (const item of data) {
      if (item.path && item.signedUrl) {
        pageUrls.set(item.path, { url: item.signedUrl, expiresAt });
      }
    }
  }
  return new Map(
    paths.flatMap((path) => {
      const entry = pageUrls.get(path);
      return entry ? [[path, entry.url] as const] : [];
    }),
  );
}
