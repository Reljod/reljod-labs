/**
 * Uploads every preset pack's files and page images to the private
 * `document-compliance` bucket under `presets/<slug>/`. Safe to re-run.
 *
 *   pnpm seed:document-compliance
 */
import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "document-compliance";
const PACKS_DIR = join(
  import.meta.dirname,
  "../fixtures/document-compliance/packs",
);
const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".pdf": "application/pdf",
};

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  throw new Error(
    "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local",
  );
}
const storage = createClient(url, key, {
  auth: { persistSession: false },
}).storage.from(BUCKET);

for (const slug of await readdir(PACKS_DIR)) {
  const files = (await readdir(join(PACKS_DIR, slug))).filter(
    (file) => CONTENT_TYPES[extname(file)],
  );
  for (const file of files) {
    const { error } = await storage.upload(
      `presets/${slug}/${file}`,
      await readFile(join(PACKS_DIR, slug, file)),
      { contentType: CONTENT_TYPES[extname(file)], upsert: true },
    );
    if (error) throw new Error(`${slug}/${file}: ${error.message}`);
  }
  console.log(`uploaded ${slug} (${files.length} files)`);
}
