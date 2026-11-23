import { expect, test } from "@playwright/test";

/*
 * Firebreak: take the chair, play six Rounds (one in your own words), and
 * open the After-Action Review. Stubbed by default: the Room, the Reader and
 * the Comms lead are canned (`x-firebreak-stub`), while the Engine, the
 * Rules, the replay of every Round and the Statement's checks run for real
 * through the real routes. The e2e visitor skips the rate limit, so nothing
 * is written to the database. `E2E_FIREBREAK_LIVE=1` asks the real model
 * (about ten cents a drill); run it only when asked.
 */
const live = process.env.E2E_FIREBREAK_LIVE === "1";
const token = process.env.E2E_BYPASS_TOKEN ?? "";

test.setTimeout(live ? 600_000 : 180_000);
test.use({
  extraHTTPHeaders: {
    "x-e2e-token": token,
    ...(live ? {} : { "x-firebreak-stub": token }),
  },
});

test("plays a drill to the Review, with the Statement sent back until it clears", async ({
  page,
}) => {
  const wait = { timeout: live ? 120_000 : 20_000 };
  await page.goto("/demos/firebreak");
  await page.getByTestId("fb-start-halyard-air").click();
  await expect(page.getByTestId("fb-inject")).toContainText(
    "The screens go black",
  );

  // Round one in the executive's own words: the Reader maps them to Levers.
  await page.getByTestId("fb-write-own").click();
  await page
    .getByTestId("fb-own")
    .fill("Roster crews by hand and keep flying; tell passengers the truth.");
  await page.getByRole("button", { name: "Decide" }).click();
  await expect(page.getByTestId("fb-reading")).toBeVisible(wait);
  await expect(page.getByTestId("fb-voices")).not.toBeEmpty(wait);
  await expect(page.getByTestId("fb-clock")).toContainText("T+0h");

  // The other five with the first Option on each card.
  for (let round = 2; round <= 6; round++) {
    await expect(page.getByTestId("fb-option-0")).toBeEnabled(wait);
    await page.getByTestId("fb-option-0").click();
    await expect(page.getByTestId("fb-ledger").first()).toBeVisible(wait);
  }

  await page.getByTestId("fb-review-start").click(wait);
  await expect(page.getByTestId("fb-grade")).toHaveText(/^[A-E]$/, wait);
  await expect(page.getByTestId("fb-draft-1")).toBeVisible(wait);
  await expect(page.getByText(/Cleared on draft \d/)).toBeVisible(
    live ? { timeout: 240_000 } : wait,
  );

  await page.getByRole("tab", { name: "Under the hood" }).click();
  await expect(page.getByTestId("fb-hood")).toContainText(
    "The model voices. Code decides.",
  );
});

test("refuses a Round the Engine could not have produced, before anything is spent", async ({
  request,
}) => {
  const response = await request.post("/api/firebreak/turns", {
    data: {
      scenario: "halyard-air",
      rounds: [],
      echoes: [],
      current: {
        inject: "back-in-the-air",
        choice: { kind: "option", option: "back-in-the-air/crews" },
      },
    },
  });
  expect(response.status()).toBe(400);
  expect((await response.json()).error).toMatch(/could not be on the desk/);
});
