import {
  type APIRequestContext,
  expect,
  type Page,
  test,
} from "@playwright/test";

/*
 * Tidewater Bank, the paths a person takes, without model spend: the Teller
 * turn is stubbed (`x-bank-stub`: it calls one real MCP tool in process and
 * gives a canned reply), and the e2e Owner's Growth requests are triaged
 * without a model and never filed on GitHub. It still writes to the `e2e`
 * Owner's bank in the database and starts real Workflows.
 *
 * Opt-in with `E2E_BANK=1` once `supabase/migrations/20261119120000_bank.sql`
 * is applied to the project the suite runs against. `E2E_BANK_LIVE=1` adds
 * one real, cheap Teller turn.
 */
test.skip(
  process.env.E2E_BANK !== "1",
  "Set E2E_BANK=1 once the bank migration is applied.",
);
test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);
test.use({
  actionTimeout: 30_000,
  extraHTTPHeaders: {
    "x-e2e-token": process.env.E2E_BYPASS_TOKEN ?? "",
    "x-bank-stub": "1",
  },
});

const money = (text: string | null) =>
  Number((text ?? "").replace(/[^0-9.]/g, ""));

async function openBank(page: Page, tab = "bank") {
  await page.goto(`/demos/bank${tab === "bank" ? "" : `?tab=${tab}`}`);
  await expect(page.getByTestId(`bank-panel-${tab}`)).toBeVisible({
    timeout: 120_000,
  });
}

/** Signs in as a Staff member through the bar's switcher. */
async function signInAs(page: Page, key: string) {
  await page.getByTestId("bank-staff-switcher").click();
  const item = page.getByTestId(`bank-staff-${key}`);
  if ((await item.getAttribute("aria-checked")) === "true") {
    await page.keyboard.press("Escape");
    return;
  }
  await item.click();
  await expect(item).toBeHidden({ timeout: 30_000 });
}

async function sendToTeller(page: Page, text: string) {
  const box = page.getByTestId("bank-chat-input");
  await expect(box).toBeEnabled({ timeout: 60_000 });
  await box.fill(text);
  await page.getByTestId("bank-chat-send").click();
}

/** One JSON-RPC call to the bank's MCP server. */
async function mcp(
  request: APIRequestContext,
  token: string,
  method: string,
  params: object,
) {
  const response = await request.post("/api/bank/mcp", {
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    data: { jsonrpc: "2.0", id: 1, method, params },
  });
  expect(response.status(), `${method} status`).toBe(200);
  const body = await response.text();
  const line = body.trim().startsWith("{")
    ? body
    : (body.split("\n").find((item) => item.startsWith("data:")) ?? "").slice(
        5,
      );
  return JSON.parse(line).result as Record<string, unknown>;
}

test("a visitor without Access is turned away at both gates", async ({
  playwright,
  baseURL,
}) => {
  const stranger = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: {},
  });
  const read = await stranger.get("/api/bank/read/get_overview");
  expect(read.status()).toBe(401);
  const page = await stranger.get("/demos/bank", { maxRedirects: 0 });
  expect([302, 307]).toContain(page.status());
  expect(page.headers().location).toContain("/access");
  const tool = await stranger.post("/api/bank/mcp", {
    headers: {
      authorization: "Bearer tdw_forged.token",
      "content-type": "application/json",
    },
    data: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
  });
  expect(tool.status()).toBe(401);
  await stranger.dispose();
});

test("the bank opens with its seed: customers, accounts and a ledger that balances", async ({
  page,
}) => {
  await openBank(page);
  await expect(page.getByTestId("bank-customer-row"))
    .toHaveCount(4, { timeout: 60_000 })
    .catch(async () => {
      // Earlier runs may have opened more customers.
      expect(
        await page.getByTestId("bank-customer-row").count(),
      ).toBeGreaterThanOrEqual(4);
    });
  await expect(page.getByTestId("bank-customer-title")).toContainText(
    "Mara Voss",
  );
  await expect(page.getByTestId("bank-account-card").first()).toBeVisible();
  await expect(
    page.getByText("Play money", { exact: false }).first(),
  ).toBeVisible();

  await page.getByTestId("bank-tab-operations").click();
  await page
    .getByTestId("bank-panel-operations")
    .getByText("Trial balance", { exact: true })
    .first()
    .click();
  await expect(page.getByTestId("bank-ops-trial-seal")).toContainText(
    /Balanced/i,
    { timeout: 60_000 },
  );
  const debits = money(
    await page.getByTestId("bank-ops-trial-debits").textContent(),
  );
  const credits = money(
    await page.getByTestId("bank-ops-trial-credits").textContent(),
  );
  expect(debits).toBeGreaterThan(5_000_000);
  expect(debits).toBe(credits);
});

test("a transfer in the app: step-up, then the balances move", async ({
  page,
}) => {
  await openBank(page);
  await signInAs(page, "ines-maro");
  const balance = page.getByTestId("bank-account-balance").first();
  await expect(balance).toBeVisible({ timeout: 60_000 });
  const before = money(await balance.textContent());

  await page
    .getByRole("tab", { name: /^Payments/ })
    .first()
    .click();
  await page.getByTestId("bank-transfer-open").click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("group", { name: "This customer's other accounts" })
    .getByRole("button")
    .first()
    .click();
  await dialog.getByTestId("bank-transfer-amount").fill("15");
  await dialog.getByTestId("bank-write-submit").click();
  // Step-up: nothing is sent until the amount is typed again.
  await expect(dialog.getByTestId("bank-stepup-confirm")).toBeDisabled();
  await dialog.getByTestId("bank-stepup-input").fill("15.00");
  await dialog.getByTestId("bank-stepup-confirm").click();
  await expect(
    page
      .getByTestId("bank-write-outcome")
      .or(page.getByTestId("bank-write-done"))
      .first(),
  ).toContainText(/Transferred MRF 15\.00/, { timeout: 60_000 });

  await page.keyboard.press("Escape");
  await page
    .getByRole("tab", { name: /^Accounts/ })
    .first()
    .click();
  await expect
    .poll(async () => money(await balance.textContent()), { timeout: 60_000 })
    .toBe(Math.round((before - 15) * 100) / 100);
});

test("the Teller asks, the person confirms: a transfer from chat waits for the click", async ({
  page,
}) => {
  await openBank(page, "chat");
  await page.getByTestId("bank-chat-new").click();
  await sendToTeller(page, "Please transfer some money");
  const tool = page
    .getByTestId("bank-chat-tool")
    .filter({ hasText: /Transfer/ })
    .last();
  await expect(tool).toBeVisible({ timeout: 90_000 });
  const card = page.getByTestId("bank-confirmation").last();
  await expect(card).toHaveAttribute("data-status", "pending", {
    timeout: 60_000,
  });
  await expect(card).toContainText("Transfer MRF 12.00");
  await expect(card).toContainText("Only you can");
  // The money has not moved, and Confirm is locked until the word is typed.
  await expect(card.getByTestId("bank-confirmation-confirm")).toBeDisabled();
  await card.getByTestId("bank-confirmation-stepup").fill("confirm");
  await card.getByTestId("bank-confirmation-confirm").click();
  await expect(card.getByTestId("bank-confirmation-result")).toContainText(
    /Transferred MRF 12\.00/,
    { timeout: 60_000 },
  );

  // The same journey is on the Audit trail: asked by the Teller, confirmed by a person.
  await page.getByTestId("bank-tab-audit").click();
  await expect(page.getByTestId("bank-audit-list")).toContainText(
    "confirmation.requested",
    { timeout: 60_000 },
  );
  await expect(page.getByTestId("bank-audit-list")).toContainText(
    "confirmation.confirmed",
  );
});

test("the same bank through MCP: a token from Connect a client, every command a tool, sensitive writes parked", async ({
  page,
  request,
}) => {
  await openBank(page, "connect");
  await page.getByTestId("bank-connect-mint").click();
  const tokenBox = page.getByTestId("bank-connect-token");
  await expect(tokenBox).toBeVisible({ timeout: 60_000 });
  const token = (await tokenBox.getAttribute("data-token")) ?? "";
  expect(token).toMatch(/^tdw_/);
  // Masked on screen until Show is pressed.
  await expect(tokenBox).not.toContainText(token);

  await mcp(request, token, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "e2e", version: "1" },
  });
  const listed = (await mcp(request, token, "tools/list", {})) as {
    tools: { name: string }[];
  };
  const names = listed.tools.map((tool) => tool.name);
  expect(names.length).toBeGreaterThan(50);
  for (const name of [
    "transfer",
    "pay_payee",
    "get_trial_balance",
    "raise_request",
    "advance_clock",
  ]) {
    expect(names).toContain(name);
  }
  // No tool gives an Approval or confirms a request.
  expect(names).not.toContain("decide_approval");
  expect(names).not.toContain("confirm_request");

  const call = async (name: string, args: object) =>
    (await mcp(request, token, "tools/call", { name, arguments: args })) as {
      structuredContent?: Record<string, never>;
      isError?: boolean;
      content?: { text: string }[];
    };
  const customers = (await call("list_customers", {})).structuredContent
    ?.customers as { id: string; name: string }[];
  const mara = customers.find((item) => item.name === "Mara Voss");
  const detail = (await call("get_customer", { customerId: mara?.id }))
    .structuredContent as {
    accounts: { id: string; number: string; kind: string; balance: number }[];
  };
  const [current, savings] = [
    detail.accounts.find((item) => item.kind === "current"),
    detail.accounts.find((item) => item.kind === "savings"),
  ];

  // A harmless write goes through; a money-moving one is parked for the person.
  const credit = await call("receive_credit", {
    accountId: current?.id,
    amount: 5_00,
    from: "Refund Desk",
    idempotencyKey: `e2e-${Date.now()}`,
  });
  expect(credit.structuredContent?.status).toBe("done");
  const asked = await call("transfer", {
    fromAccountId: current?.id,
    toAccountNumber: savings?.number,
    amount: 7_00,
  });
  expect(asked.structuredContent?.status).toBe("needs_confirmation");
  const after = (await call("get_account", { accountId: current?.id }))
    .structuredContent as { account: { balance: number } };
  expect(after.account.balance).toBe((current?.balance ?? 0) + 5_00);
  // The Rules refuse through MCP exactly as they do in the app.
  const tooMuch = await call("transfer", {
    fromAccountId: current?.id,
    toAccountNumber: savings?.number,
    amount: 60_000_00,
  });
  expect(tooMuch.isError).toBe(true);
  expect(tooMuch.content?.[0]?.text).toMatch(/may not exceed/);

  // The parked request is waiting in the app, and declining it leaves the money alone.
  await page.reload();
  const pending = page
    .getByTestId("bank-connect-pending")
    .getByTestId("bank-confirmation")
    .filter({ hasText: "Transfer MRF 7.00" })
    .first();
  await expect(pending).toBeVisible({ timeout: 60_000 });
  await expect(pending).toContainText("an MCP client");
  await pending.getByTestId("bank-confirmation-decline").click();
  await expect(
    pending
      .getByTestId("bank-confirmation-result")
      .or(page.getByText("Nothing is waiting")),
  ).toBeVisible({ timeout: 60_000 });
});

test("a supervisor edits a Rule; a teller may not", async ({ page }) => {
  await openBank(page, "rules");
  await signInAs(page, "ines-maro");
  const card = page.getByTestId("bank-rule-fees.payments");
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card.getByTestId("bank-rule-fees.payments-save")).toBeDisabled();

  await signInAs(page, "tomas-vell");
  const sentence = card.getByTestId("bank-rule-fees.payments-sentence");
  const next = (await sentence.textContent())?.includes("costs MRF 2.00")
    ? "1.50"
    : "2.00";
  await card.getByLabel("Payment to another bank").fill(next);
  // The sentence follows the Parameter as it is typed.
  await expect(sentence).toContainText(`costs MRF ${next}`);
  await card.getByTestId("bank-rule-fees.payments-save").click();
  await page.getByTestId("bank-rule-fees.payments-confirm").click();
  await expect(card).toContainText(/Version \d+/, { timeout: 60_000 });
  await page.reload();
  await expect(
    page.getByTestId("bank-rule-fees.payments-sentence"),
  ).toContainText(`costs MRF ${next}`, { timeout: 60_000 });
  await signInAs(page, "ines-maro");
});

test("fast-forwarding the clock runs end-of-day as a Workflow and the books still balance", async ({
  page,
}) => {
  await openBank(page, "operations");
  const date = page.getByTestId("bank-clock-date");
  const before = await date.textContent();
  await page.getByTestId("bank-clock-fast-forward").click();
  await page.getByTestId("bank-clock-jump-1").click();
  await expect(date).not.toHaveText(before ?? "", { timeout: 60_000 });
  await expect(page.getByTestId("bank-ops-workflows")).toContainText(
    /end-of-day/i,
    { timeout: 90_000 },
  );
  await expect(
    page
      .getByTestId("bank-ops-workflows")
      .getByText(/completed/i)
      .first(),
  ).toBeVisible({ timeout: 120_000 });
  await page
    .getByTestId("bank-panel-operations")
    .getByText("Trial balance", { exact: true })
    .first()
    .click();
  await expect(page.getByTestId("bank-ops-trial-seal")).toContainText(
    /Balanced/i,
    { timeout: 60_000 },
  );
  await expect(page.getByTestId("bank-ops-trial-difference")).toContainText(
    "0.00",
  );
});

test("asking for something the bank cannot do raises a Growth request that is triaged", async ({
  page,
}) => {
  await openBank(page, "chat");
  await page.getByTestId("bank-chat-new").click();
  const wish = `I wish the bank had savings goals ${Date.now().toString(36)}`;
  await sendToTeller(page, wish);
  const tool = page
    .getByTestId("bank-chat-tool")
    .filter({ hasText: /grow/i })
    .last();
  await expect(tool).toBeVisible({ timeout: 90_000 });
  const outcome = await tool.textContent();
  await page.getByTestId("bank-tab-growth").click();
  if (/Growth requests (today|are still open)/.test(outcome ?? "")) {
    // The daily cap of earlier runs: the refusal itself is the behaviour.
    await expect(page.getByTestId("bank-growth-requests")).toBeVisible({
      timeout: 60_000,
    });
    return;
  }
  const request = page
    .getByTestId("bank-growth-requests")
    .locator('[data-testid^="bank-growth-request-"]')
    .first();
  await expect(request).toContainText("savings goals", { timeout: 60_000 });
  // Triaged by the Workflow (stubbed for the e2e Owner: no model, never filed).
  await expect(request).toContainText(/Triaged|duplicate|Already asked/i, {
    timeout: 120_000,
  });
  await expect(page.getByTestId("bank-growth-rings")).toBeVisible();
});

test("one real Teller turn, with the model", async ({ page }) => {
  test.skip(
    process.env.E2E_BANK_LIVE !== "1",
    "Set E2E_BANK_LIVE=1 for one real, cheap model turn.",
  );
  // The context's stub header is overridden: this turn reaches the model.
  await page.setExtraHTTPHeaders({
    "x-e2e-token": process.env.E2E_BYPASS_TOKEN ?? "",
    "x-bank-stub": "0",
  });
  await openBank(page, "chat");
  await page.getByTestId("bank-chat-new").click();
  await sendToTeller(
    page,
    "What is Mara Voss's everyday account balance? Answer in one short sentence.",
  );
  await expect(page.getByTestId("bank-chat-tool").first()).toBeVisible({
    timeout: 120_000,
  });
  const answer = page
    .getByTestId("bank-chat-message")
    .filter({ hasText: /MRF/ })
    .last();
  await expect(answer).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId("bank-chat-usage").last()).toContainText(
    /\$0\.\d+/,
    { timeout: 60_000 },
  );
});
