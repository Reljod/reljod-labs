import { expect, test } from "@playwright/test";

/*
 * Client Manager: add a client from the Intake, watch the Build, then ask a
 * question and see the Navigator walk the graph. Calls the real models and
 * writes to the live database and bucket, like the rest of the suite.
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

let clientUrl = "";

test("an Intake builds a self-corrected graph", async ({ page }) => {
  await page.goto("/demos/client-manager");
  await page.getByRole("button", { name: /Add client/ }).click();
  await page.getByRole("button", { name: "Try Elena" }).click();
  await expect(page.getByLabel("Name")).toHaveValue("Elena Marsh");
  await page.getByRole("button", { name: /Build the graph/ }).click();

  await page.waitForURL(/\/demos\/client-manager\/[0-9a-f-]{36}$/);
  clientUrl = page.url();
  const card = page.getByTestId("build-card");
  await expect(card).toBeVisible();
  // Nodes stream onto the graph while Extract is still running.
  await expect
    .poll(
      async () =>
        Number(
          await page.getByTestId("client-graph").getAttribute("data-nodes"),
        ),
      { timeout: 120_000 },
    )
    .toBeGreaterThan(5);
  await expect(card).toHaveAttribute("data-status", "completed", {
    timeout: 240_000,
  });
  await expect(card).toContainText("Critique");
  await expect(page.getByText(/self-correction/).first()).toBeVisible();
});

test("the Category tree zooms into a Branch and a Node opens its Evidence", async ({
  page,
}) => {
  await page.goto(clientUrl);
  await page
    .getByRole("navigation", { name: "Categories" })
    .getByRole("button", { name: /^Wealth/ })
    .click();
  await expect(
    page.getByRole("navigation", { name: "Where you are" }),
  ).toContainText("Wealth");
  await page
    .getByRole("navigation", { name: "Categories" })
    .getByRole("button", { name: /^Property/ })
    .click();
  await page
    .getByRole("navigation", { name: "Categories" })
    .getByRole("button")
    .filter({ hasText: /cottage/i })
    .first()
    .click();
  await expect(
    page.getByRole("complementary", { name: /details/ }),
  ).toContainText("Evidence");
});

test("a question walks the graph with pgRouting and cites Nodes", async ({
  page,
}) => {
  await page.goto(clientUrl);
  await page
    .locator("#cm-input")
    .fill(
      "Who helps her with Daniel's estate, and how is the Saltmere cottage connected to Ivy?",
    );
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("tool-line").first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(
    page
      .getByTestId("tool-line")
      .filter({ hasText: /Expand|Connect/ })
      .first(),
  ).toBeVisible({ timeout: 90_000 });
  await expect(
    page.getByRole("button", { name: "▶ Replay the walk" }),
  ).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTitle("Show on the graph").first()).toBeVisible();
});

test("the Catalog shows the new client with a Persona", async ({ page }) => {
  await page.goto("/demos/client-manager");
  const card = page
    .getByTestId("client-card")
    .filter({ hasText: "Elena Marsh" })
    .first();
  await expect(card).toBeVisible();
  await expect(card).not.toContainText("Building", { timeout: 60_000 });
});
