import { expect, test } from "@playwright/test";

/*
 * Client Manager: add a client from the Intake and watch the Build on the
 * Map, read the Profile and a fact's sources, then ask the Desk in the Chat
 * tab and open a cited fact. Stubbed by default: the Build reads with the
 * canned extractor, Critic and Persona and the Desk is a script, both over
 * the real workflow, MCP server, caps, bucket and live database
 * (`server/stubs.ts`). `E2E_LIVE=1` calls the real models (paid).
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

let clientUrl = "";

test("an Intake builds a self-corrected graph", async ({ page }) => {
  await page.goto("/demos/client-manager");
  await page.getByRole("tab", { name: "Clients" }).click();
  await page.getByRole("button", { name: "Client", exact: true }).click();
  await page.getByRole("button", { name: "Try Elena" }).click();
  await expect(page.getByLabel("Name")).toHaveValue("Elena Marsh");
  await page.getByRole("button", { name: /Build the graph/ }).click();

  await page.waitForURL(/\/demos\/client-manager\/[0-9a-f-]{36}$/);
  clientUrl = page.url();
  const strip = page.getByTestId("build-card");
  await expect(strip).toBeVisible({ timeout: 60_000 });
  // Nodes stream onto the Map while Extract is still running.
  await expect
    .poll(
      async () =>
        Number(
          await page.getByTestId("client-graph").getAttribute("data-nodes"),
        ),
      { timeout: 120_000 },
    )
    .toBeGreaterThan(5);
  await expect(strip).toHaveAttribute("data-status", "completed", {
    timeout: 240_000,
  });
});

test("the Profile opens a fact with its sources, and the tree keeps its place", async ({
  page,
}) => {
  await page.goto(clientUrl);
  await expect(page.getByRole("region", { name: "People" })).toBeVisible();
  await page
    .getByRole("region", { name: "People" })
    .getByRole("button")
    .first()
    .click();
  await expect(
    page.getByRole("complementary", { name: /details/ }),
  ).toBeVisible();

  await page
    .getByRole("navigation", { name: "Client views" })
    .getByRole("button", { name: "Map" })
    .click();
  const tree = page.getByRole("navigation", { name: "Categories" });
  await tree.getByRole("button", { name: /^Wealth/ }).click();
  await tree.getByRole("button", { name: /^Property/ }).click();
  const leaves = tree.getByRole("button").filter({ hasText: /cottage/i });
  await leaves.first().click();
  // Opening a Node keeps the Branch and leaf open.
  await expect(tree.getByRole("button", { name: /^Property/ })).toBeVisible();
  await expect(leaves.first()).toBeVisible();
});

test("the Desk answers across the book and cites facts", async ({ page }) => {
  await page.goto("/demos/client-manager");
  await page
    .locator("#cm-input")
    .fill(
      "Who helps Elena Marsh with Daniel's estate, and how is the Saltmere cottage connected to Ivy?",
    );
  await page.keyboard.press("Enter");
  const chip = page.getByTitle(/open this fact/).first();
  await expect(chip).toBeVisible({ timeout: 120_000 });
  await chip.click();
  await expect(page.getByRole("tab", { name: "Clients" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    page.getByRole("complementary", { name: /details/ }),
  ).toBeVisible();
});

test("the new client is in the Catalog with a Persona", async ({ page }) => {
  await page.goto("/demos/client-manager");
  await page.getByRole("tab", { name: "Clients" }).click();
  const card = page
    .getByTestId("client-card")
    .filter({ hasText: "Elena Marsh" })
    .first();
  await expect(card).toBeVisible();
  await expect(card).not.toContainText("Building", { timeout: 60_000 });
});
