import { createHmac } from "node:crypto";
import {
  type APIRequestContext,
  expect,
  type Page,
  test,
} from "@playwright/test";

/*
 * Operator: the journeys a person and an outside client take.
 *
 * The Operator's model is stubbed (`x-operator-stub` carrying the e2e bypass
 * token): it plays the sample Task's Script instead of calling a model, so
 * nothing is spent on tokens. Everything else is real: each Run forks a
 * Vercel Sandbox with headless Chromium, HARBOURMASTER and the Guard in it,
 * writes Frames to Storage and rows to the `operator` schema under the `e2e`
 * Owner. So the spec needs the migration
 * `supabase/migrations/20261119130000_operator.sql` applied and Vercel
 * Sandbox credentials (`VERCEL_OIDC_TOKEN` locally), and is opt-in with
 * `E2E_OPERATOR=1`. `E2E_OPERATOR_LIVE=1` adds one short Run on the real
 * model.
 */
test.skip(
  process.env.E2E_OPERATOR !== "1",
  "Set E2E_OPERATOR=1 once the Operator migration is applied and Sandbox credentials are set.",
);
test.describe.configure({ mode: "serial" });
test.setTimeout(8 * 60_000);

const BYPASS = process.env.E2E_BYPASS_TOKEN ?? "";
test.use({
  viewport: { width: 1440, height: 1000 },
  extraHTTPHeaders: { "x-e2e-token": BYPASS, "x-operator-stub": BYPASS },
});

const verdict = (page: Page) => page.getByTestId("verdict");
const guardCard = (page: Page) =>
  page
    .getByRole("alertdialog")
    .filter({ hasText: "The Guard stopped this key" });

async function startOperator(page: Page, task: RegExp) {
  await page.goto("/demos/operator");
  await page.getByRole("button", { name: task }).first().click();
  await page.getByRole("button", { name: "Let the Operator do it" }).click();
  await expect(page).toHaveURL(/run=/, { timeout: 90_000 });
}

/** An MCP token for the `e2e` Owner, signed as `mintMcpToken` signs it. */
function e2eToken() {
  const payload = Buffer.from(
    JSON.stringify({
      kind: "e2e",
      owner: "e2e",
      visitor: "e2e",
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  ).toString("base64url");
  const signature = createHmac(
    "sha256",
    `operator-mcp:${process.env.RATE_LIMIT_SALT ?? ""}`,
  )
    .update(payload)
    .digest("base64url");
  return `operator_${payload}.${signature}`;
}

type ToolAnswer = {
  text: string;
  isError: boolean;
  hasImage: boolean;
  structured: Record<string, unknown> | undefined;
};

/** Calls one tool of the Operator MCP server over Streamable HTTP. */
async function mcp(
  request: APIRequestContext,
  name: string,
  args: Record<string, unknown> = {},
  token = e2eToken(),
): Promise<ToolAnswer> {
  const response = await request.post("/api/operator/mcp", {
    headers: {
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
    },
    data: {
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name, arguments: args },
    },
    timeout: 150_000,
  });
  expect(response.status(), `${name} answered`).toBe(200);
  const body = await response.text();
  const line = body.startsWith("{")
    ? body
    : (body.split("\n").find((part) => part.startsWith("data:")) ?? "").slice(
        5,
      );
  const result = JSON.parse(line).result as {
    content?: { type: string; text?: string }[];
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
  };
  const content = result.content ?? [];
  return {
    text: content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n"),
    isError: result.isError === true,
    hasImage: content.some((part) => part.type === "image"),
    structured: result.structuredContent,
  };
}

test("the demos stay shut without Access", async ({ playwright, baseURL }) => {
  const anonymous = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: {},
  });
  const runs = await anonymous.get("/api/operator/runs");
  expect(runs.status()).toBe(401);
  const page = await anonymous.get("/demos/operator", { maxRedirects: 0 });
  expect(page.status()).toBeGreaterThanOrEqual(300);
  expect(page.status()).toBeLessThan(400);
  expect(page.headers().location).toContain("/access");
  const tool = await anonymous.post("/api/operator/mcp", {
    headers: { accept: "application/json, text/event-stream" },
    data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });
  expect(tool.status()).toBe(401);
  await anonymous.dispose();
});

test("a recorded Run is on the stage before anything is spent", async ({
  page,
}) => {
  await page.goto("/demos/operator");
  await expect(
    page.getByRole("button", { name: /Watch a recorded Run/ }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Frame 1 of \d+/)).toBeVisible();
  await page.getByRole("button", { name: "Next Frame" }).click();
  await expect(page.getByText(/Frame 2 of \d+/)).toBeVisible();
});

test("the Operator keys a Task, the Guard pauses the guarded key, a person approves and code says Correct", async ({
  page,
}) => {
  await startOperator(page, /Release a hold, book a berth/);

  // The harness stops the key that would release the hold; nothing is committed yet.
  await expect(guardCard(page)).toBeVisible({ timeout: 4 * 60_000 });
  await expect(guardCard(page)).toContainText("Release a customs hold");
  await expect(guardCard(page)).toContainText("actions.guarded");
  await expect(page.getByText("Checklist: 0 of 2")).toBeVisible();

  await guardCard(page).getByRole("button", { name: "Approve" }).click();
  await expect(guardCard(page)).toBeHidden({ timeout: 60_000 });

  // The lock by another clerk is retried, the berth is booked, the session signed off.
  await expect(verdict(page)).toHaveText("Correct", { timeout: 5 * 60_000 });
  await expect(page.getByText("Checklist: 2 of 2")).toBeVisible();
  await expect(page.getByText(/approved by a person/)).toBeVisible();
  await expect(page.getByText("The session was signed off")).toBeVisible();

  // Replay: every Frame can be stepped through.
  await page.getByRole("button", { name: "Previous Frame" }).click();
  await expect(page.getByText(/Frame \d+ of \d+/)).toBeVisible();

  // Under the hood shows what ran and why it paused.
  await page.getByRole("tab", { name: "Under the hood" }).click();
  const hood = page.locator("#op-panel-hood");
  await expect(hood.getByText("Rules that fired")).toBeVisible();
  await expect(hood.getByText(/needs a person/).first()).toBeVisible();
});

test("a refused Approval leaves the change undone, and the checks say Incorrect", async ({
  page,
}) => {
  await startOperator(page, /Correct a manifest/);
  await expect(guardCard(page)).toBeVisible({ timeout: 4 * 60_000 });
  await expect(guardCard(page)).toContainText("Delete a manifest line");
  // The scripted Operator cannot see the refusal, so it presses the same key
  // again; the Guard stops it every time, and every time a person refuses.
  const refuse = guardCard(page).getByRole("button", { name: "Refuse" });
  for (let pauses = 0; pauses < 6; pauses++) {
    await expect(refuse.or(verdict(page)).first()).toBeVisible({
      timeout: 5 * 60_000,
    });
    if (await verdict(page).isVisible()) break;
    await refuse.click();
    await expect(refuse).toBeHidden({ timeout: 60_000 });
  }

  await expect(verdict(page)).toHaveText("Incorrect", { timeout: 5 * 60_000 });
  // The line the Task wanted gone is still in the Books: only code noticed.
  await expect(
    page.getByText("Not found in the Books as asked.").first(),
  ).toBeVisible();
});

test("taking the keyboard: the server replays what was keyed and checks it", async ({
  page,
}) => {
  await page.goto("/demos/operator");
  await page
    .getByRole("button", { name: /Release a hold, book a berth/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Take the keyboard" }).click();
  const terminal = page.getByRole("application");
  await expect(terminal).toBeVisible({ timeout: 30_000 });
  await terminal.click();
  await page.keyboard.type("OPR7");
  await page.keyboard.press("Tab");
  await page.keyboard.type("MERIDIA1");
  await page.keyboard.press("Enter");
  await expect(terminal).toHaveAccessibleName(/Screen HMM100/);
  // A key that is not valid here: HARBOURMASTER counts the error.
  await page.keyboard.press("F9");
  await page.getByRole("button", { name: "Finish and check" }).click();

  // Nothing the Task asked for was done, and the session was left signed on.
  await expect(verdict(page)).toHaveText("Incorrect", { timeout: 60_000 });
  await expect(page.getByText("The session was left signed on")).toBeVisible();
});

test("an outside client drives the same Screen through the same Guard, over MCP", async ({
  request,
}) => {
  const bad = await request.post("/api/operator/mcp", {
    headers: {
      accept: "application/json, text/event-stream",
      authorization: "Bearer operator_not-a-token.x",
    },
    data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });
  expect(bad.status()).toBe(401);

  const tasks = await mcp(request, "list_tasks");
  expect(tasks.text).toContain("release-and-berth");

  const started = await mcp(request, "start_run", {
    taskId: "release-and-berth",
    driver: "client",
  });
  expect(started.isError, started.text).toBe(false);
  expect(started.hasImage).toBe(true);
  const runId = String(started.structured?.runId);

  try {
    await mcp(request, "screen_type", { runId, text: "OPR7" });
    await mcp(request, "screen_key", { runId, keys: ["Tab"] });
    await mcp(request, "screen_type", { runId, text: "MERIDIA1" });
    const signedOn = await mcp(request, "screen_key", {
      runId,
      keys: ["Enter"],
    });
    expect(signedOn.text).toContain("HMM100");
    expect(signedOn.hasImage).toBe(true);

    // The Rules keep any driver out of Administration: the key never arrives.
    await mcp(request, "screen_type", { runId, text: "9" });
    const refused = await mcp(request, "screen_key", {
      runId,
      keys: ["Enter"],
    });
    expect(refused.text).toContain("REFUSED by the Rule screens.allowed");
    expect(refused.text).toContain("HMM100");

    // To the hold, and the release: the Guard pauses, and the client cannot approve its own key.
    await mcp(request, "screen_key", { runId, keys: ["Backspace"] });
    await mcp(request, "screen_type", { runId, text: "3" });
    await mcp(request, "screen_key", { runId, keys: ["Enter"] });
    await mcp(request, "screen_type", { runId, text: "TRSU3304186" });
    await mcp(request, "screen_key", { runId, keys: ["Enter", "Tab"] });
    await mcp(request, "screen_type", { runId, text: "R" });
    await mcp(request, "screen_key", { runId, keys: ["Tab", "Tab"] });
    await mcp(request, "screen_type", { runId, text: "RO-2611-0457" });
    await mcp(request, "screen_key", { runId, keys: ["Enter"] });
    await mcp(request, "screen_type", { runId, text: "Y" });
    const paused = await mcp(request, "screen_key", { runId, keys: ["Enter"] });
    expect(paused.text).toContain("PAUSED by the Rule actions.guarded");

    const run = await mcp(request, "get_run", { runId });
    const pending = (run.structured?.pending ?? null) as {
      approvalId: string;
    } | null;
    expect(run.structured?.status).toBe("paused");
    expect(pending?.approvalId).toBeTruthy();
    const own = await mcp(request, "decide_approval", {
      runId,
      approvalId: pending?.approvalId,
      decision: "approved",
    });
    expect(own.isError).toBe(true);
    expect(own.text).toContain("decided by a person in the app");
    const blocked = await mcp(request, "screen_capture", { runId });
    expect(blocked.isError).toBe(true);

    const trail = await mcp(request, "get_trail", { runId });
    expect(trail.text).toContain('"type":"pause"');
    const frame = await mcp(request, "get_frame", { runId, n: 0 });
    expect(frame.hasImage).toBe(true);
  } finally {
    const stopped = await mcp(request, "stop_run", { runId });
    expect(stopped.text).toContain("stopped");
  }
});

test("Rules are data: an edit saves a new version, on the page and over MCP", async ({
  page,
  request,
}) => {
  const before = await mcp(request, "get_rulebook");
  const version = Number(before.structured?.version ?? 0);

  await page.goto("/demos/operator?tab=rules");
  const max = page.getByLabel("At most");
  await expect(max).toBeVisible({ timeout: 30_000 });
  const next = (Number(await max.inputValue()) % 40) + 11;
  await max.fill(String(next));
  await page.getByRole("button", { name: /Save as version/ }).click();
  await expect(page.getByText(/Saved as version \d+/)).toBeVisible({
    timeout: 30_000,
  });

  const after = await mcp(request, "get_rulebook");
  expect(Number(after.structured?.version)).toBe(version + 1);
  const saved = after.structured?.rulebook as {
    records: { max: number };
  };
  expect(saved.records.max).toBe(next);

  // A Rulebook that does not fit the schema is refused where it is made.
  const refusedEdit = await mcp(request, "save_rulebook", {
    rulebook: { ...saved, records: { enabled: true, max: 0 } },
  });
  expect(refusedEdit.isError).toBe(true);

  // Leave the e2e Owner on the Default values again, as a new version.
  const versions = await mcp(request, "list_rulebook_versions");
  const all = versions.structured?.versions as {
    version: number;
    rulebook: unknown;
  }[];
  const restored = await mcp(request, "save_rulebook", {
    rulebook: all[all.length - 1].rulebook,
    note: "e2e: back to the Default",
  });
  expect(restored.isError, restored.text).toBe(false);
});

test.describe("with the real model", () => {
  test.skip(
    process.env.E2E_OPERATOR_LIVE !== "1",
    "Set E2E_OPERATOR_LIVE=1 to spend about $0.40 on one real Run.",
  );
  // No stub header: the Operator calls the model through the AI Gateway.
  test.use({ extraHTTPHeaders: { "x-e2e-token": BYPASS } });

  test("the Operator reads the Screen and keys the Task; code gives the Verdict", async ({
    page,
  }) => {
    test.setTimeout(14 * 60_000);
    await startOperator(page, /Release a hold, book a berth/);
    await expect(guardCard(page)).toBeVisible({ timeout: 6 * 60_000 });
    await guardCard(page).getByRole("button", { name: "Approve" }).click();
    await expect(verdict(page)).toHaveText(/Correct|Incorrect/, {
      timeout: 10 * 60_000,
    });
    // The claim under test is that a real model drove the Screen to the end
    // and code judged it; the Verdict itself is reported, not assumed.
    console.log(`live Verdict: ${await verdict(page).textContent()}`);
    // The Operator's own summary may say the same words; the Finding comes first.
    await expect(page.getByText(/approved by a person/).first()).toBeVisible();
  });
});
