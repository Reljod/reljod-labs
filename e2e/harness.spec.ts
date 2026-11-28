import { expect, type Page, test } from "@playwright/test";

/*
 * Jod: Harness for Bank, the main path a person takes, stubbed by default
 * (the e2e token alone; `E2E_LIVE=1` reaches the models): Harness's
 * container swaps in its canned Agent, which calls one Harness MCP tool in
 * process instead of a model, Runs whose model Steps use their deterministic
 * fallbacks, no embeddings and the Conflict check's stub, so nothing is
 * spent. It still writes to the `e2e` Workspace in the database and uploads
 * a sample to Storage.
 *
 * Opt-in with `E2E_HARNESS=1` until the Harness migrations
 * (`supabase/migrations/20261117*_harness*.sql`) are applied to the project
 * the suite runs against.
 */
test.skip(
  process.env.E2E_HARNESS !== "1",
  "Set E2E_HARNESS=1 once the Harness migrations are applied.",
);
test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

/** Signs in as a Staff member through the header's menu. */
async function signInAs(page: Page, name: RegExp) {
  await page
    .getByRole("button", { name: /Signed in as/ })
    .first()
    .click();
  const item = page.getByRole("menuitemradio").filter({ hasText: name });
  if ((await item.getAttribute("aria-checked")) === "true") {
    await page.keyboard.press("Escape");
    return;
  }
  await item.click();
  await expect(
    page.getByRole("button", { name: /Signed in as/ }).first(),
  ).toContainText(name);
}

async function closeDemoMode(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Demo mode" });
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByRole("button", { name: "Close" }).last().click();
  }
}

test("a request runs, stops at four eyes, is approved by the admin and lands in the Audit trail", async ({
  page,
}) => {
  await page.goto("/demos/harness");
  await closeDemoMode(page);
  await signInAs(page, /Keisha/);

  await page.getByRole("button", { name: "New Session" }).first().click();
  await page.getByRole("button", { name: "Sample files" }).click();
  await page
    .getByRole("button", { name: /Overseas transfer: Alison/ })
    .last()
    .click();
  await expect(
    page.getByRole("list", { name: "Files for the next message" }),
  ).toBeVisible();
  const box = page.getByRole("textbox", { name: "Message the Agent" });
  await box.fill("Please handle this member request");
  await expect(page.getByRole("button", { name: "Send" })).toBeEnabled({
    timeout: 30_000,
  });
  await box.press("Enter");

  await expect(page.getByText("Stub reply").first()).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "View pipeline" }).first().click();

  const approval = page.getByRole("region", { name: "Approval needed" });
  await expect(approval).toBeVisible({ timeout: 60_000 });
  await expect(approval).toContainText("High risk", { ignoreCase: true });
  // Four eyes: the user who started it may not approve a high-risk Draft.
  await expect(
    approval.getByRole("button", { name: "Approve", exact: true }),
  ).toBeDisabled();

  await signInAs(page, /Marva/);
  await approval.getByRole("button", { name: "Approve", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Approve", exact: true })
    .click();
  await expect(page.getByText(/Approved as Marva/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(/^completed$/i).first()).toBeVisible({
    timeout: 60_000,
  });

  // A Step of the graph opens with its Findings and their Rule Versions.
  await page
    .locator(".react-flow__node button")
    .filter({ hasText: "Check eligibility" })
    .click();
  await expect(page.getByRole("region", { name: "Findings" })).toBeVisible();

  await page.getByRole("tab", { name: "Audit" }).click();
  await expect(
    page
      .getByText("Approval decided", { exact: true })
      .filter({ visible: true })
      .first(),
  ).toBeVisible({
    timeout: 20_000,
  });
});
