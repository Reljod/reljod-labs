import { defineConfig } from "@playwright/test";
import { E2E_HEADER } from "./src/features/document-compliance/constants";

// End-to-end tests call the paid model and the live Supabase project.
// Run them only when asked (see AGENTS.md): `pnpm test:e2e`.

try {
  process.loadEnvFile(".env.local");
} catch {
  // CI provides the variables directly.
}

const externalBaseUrl = process.env.E2E_BASE_URL;
// Its own port, so a dev server you already have on 3000 is never mistaken for this one.
const localUrl = "http://localhost:3100";

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
    extraHTTPHeaders: { [E2E_HEADER]: process.env.E2E_BYPASS_TOKEN ?? "" },
    trace: "retain-on-failure",
  },
  webServer: externalBaseUrl
    ? undefined
    : {
        command: "pnpm dev --port 3100",
        url: localUrl,
        reuseExistingServer: false,
        timeout: 120_000,
      },
});
