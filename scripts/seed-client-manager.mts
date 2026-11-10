/**
 * Adds the Sample book: each example Intake, with its sample files, sent
 * through the running app's own pipeline and marked as a Sample so every
 * visitor sees it. Needs the app running and E2E_BYPASS_TOKEN set on both.
 *
 *   pnpm seed:client-manager            # against http://localhost:3000
 *   APP_URL=https://… pnpm seed:client-manager
 */
import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";

// Node strips types only from imports that name the .ts file, which tsc refuses;
// a computed path keeps both happy.
const examplesPath = "../src/features/client-manager/domain/examples.ts";
const {
  EXAMPLE_INTAKES,
}: typeof import("../src/features/client-manager/domain/examples") =
  await import(examplesPath);

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const TOKEN = process.env.E2E_BYPASS_TOKEN;
if (!TOKEN)
  throw new Error("Set E2E_BYPASS_TOKEN (the app must have the same one)");

const SAMPLES = join(import.meta.dirname, "../public/client-manager/samples");
const TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".csv": "text/csv",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};

let cookie = "";
async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${APP_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-e2e-token": TOKEN as string,
      cookie,
    },
    body: JSON.stringify(body),
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0] ?? cookie;
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new Error(`${path}: ${data.error ?? response.status}`);
  return data;
}

for (const intake of EXAMPLE_INTAKES) {
  const slug = intake.name.toLowerCase().replace(/[^a-z]+/g, "-");
  const folder = join(SAMPLES, slug);
  const names = (await readdir(folder).catch(() => [] as string[])).filter(
    (name) => TYPES[extname(name)],
  );
  const files = await Promise.all(
    names.map(async (name) => ({
      name,
      type: TYPES[extname(name)] as string,
      data: await readFile(join(folder, name)),
    })),
  );
  const created = await post<{
    clientId: string;
    buildId: string;
    uploads: { name: string; url: string }[];
  }>("/api/client-manager/clients", {
    name: intake.name,
    note: intake.note,
    files: files.map((file) => ({
      name: file.name,
      type: file.type,
      size: file.data.byteLength,
    })),
    sample: true,
  });
  for (const upload of created.uploads) {
    const file = files.find((item) => item.name === upload.name);
    if (!file) continue;
    const response = await fetch(upload.url, {
      method: "PUT",
      headers: { "content-type": file.type, "x-upsert": "true" },
      body: file.data,
    });
    if (!response.ok)
      throw new Error(`Upload of ${file.name} failed: ${response.status}`);
  }
  await post(`/api/client-manager/builds/${created.buildId}/start`, {});
  console.log(
    `${intake.name}: building with ${files.length} files → ${APP_URL}/demos/client-manager/${created.clientId}`,
  );
}
