import { defineConfig } from "@playwright/test";
import { E2E_HEADER, E2E_LIVE_HEADER } from "./src/platform/request/headers";

// End-to-end tests write to the live Supabase project. Paid services (models,
// Sandboxes) are stubbed by default: every request carries the e2e token, and
// each feature's container swaps in canned adapters. `E2E_LIVE=1` sends
// `x-e2e-live: 1` too, so the real models answer (paid; only when asked).

try {
  process.loadEnvFile(".env.local");
} catch {
  // CI provides the variables directly.
}

const externalBaseUrl = process.env.E2E_BASE_URL;
const recording = process.env.E2E_RECORD === "1";
// Its own port, so a dev server you already have on 3000 is never mistaken for
// this one. `E2E_PORT` gives parallel worktrees one each.
const port = process.env.E2E_PORT ?? "3100";
const localUrl = `http://localhost:${port}`;

export default defineConfig({
  testDir: "e2e",
  // One Pre-screen parses three documents and calls the model three times.
  timeout: 5 * 60 * 1000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  // No retries: a flaky model answer is a finding, not noise to hide.
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: externalBaseUrl ?? localUrl,
    // Locally, use the installed Google Chrome; CI installs Playwright's Chromium.
    channel: process.env.CI ? undefined : "chrome",
    // `pnpm test:e2e:record` keeps a video of every test as review evidence.
    viewport: recording ? { width: 1440, height: 1000 } : undefined,
    video: recording
      ? { mode: "on", size: { width: 1440, height: 1000 } }
      : "off",
    extraHTTPHeaders: {
      [E2E_HEADER]: process.env.E2E_BYPASS_TOKEN ?? "",
      ...(process.env.E2E_LIVE === "1" ? { [E2E_LIVE_HEADER]: "1" } : {}),
    },
    trace: "retain-on-failure",
  },
  // CI tests a production build: `next dev` compiles each route on its first
  // visit, which slows the first request of every spec. Locally, dev keeps
  // the edit-and-rerun loop fast. `E2E_SERVER=prod` forces a build locally.
  webServer: externalBaseUrl
    ? undefined
    : {
        command:
          process.env.CI || process.env.E2E_SERVER === "prod"
            ? `pnpm build && pnpm start --port ${port}`
            : `pnpm dev --port ${port}`,
        url: localUrl,
        reuseExistingServer: false,
        timeout: 300_000,
      },
});
