import { expect, test } from "@playwright/test";

/*
 * Helio: autonomous global product shoot & campaign studio.
 * Runs stubbed by default (`x-helio-stub: 1`, zero model spend, zero DB writes).
 */
test.use({
  extraHTTPHeaders: {
    "x-e2e-token": process.env.E2E_BYPASS_TOKEN ?? "",
    "x-helio-stub": "1",
  },
});

test.describe("Helio", () => {
  test("shoots a 3-market campaign, audits brand integrity, and populates placements", async ({
    page,
  }) => {
    await page.goto("/demos/helio");
    await expect(page.getByRole("heading", { name: "Helio" })).toBeVisible();
    await expect(page.getByText("Solis No. 2 Pour-Over").first()).toBeVisible();

    // Toggle Alpha X-Ray on the 3D RGBA plate
    await page.getByRole("button", { name: "Alpha X-Ray" }).click();
    await expect(page.getByText("BRASS = FEATHERED EDGE")).toBeVisible();

    // Shoot a stubbed 3-market campaign
    await page.getByTestId("helio-shoot-button").click();
    await expect(page.getByText("3/3 DEVELOPED")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("Master Light Table")).toBeVisible();

    // Run stubbed Gemini 4 Neon vision audit
    await page.getByRole("button", { name: "Audit Brand Integrity" }).click();
    await expect(page.getByText("✓ APPROVED · 95/100")).toBeVisible({
      timeout: 10_000,
    });

    // Switch to Placements tab and verify live billboard & channels
    await page.getByRole("tab", { name: /Placements/ }).click();
    await expect(
      page.getByText("Channel 01 · Flagship Out-of-Home Billboard (16:9)"),
    ).toBeVisible();

    // Switch to Compare tab and run stubbed Flash vs Flagship race
    await page.getByRole("tab", { name: "Flash vs 2.7" }).click();
    await page.getByRole("button", { name: /Start Parallel Race/ }).click();
    await expect(
      page.getByText(/Flash 2\.7 is .* cheaper per image/),
    ).toBeVisible({ timeout: 10_000 });

    // Switch to Under the hood and verify telemetry ledger recorded calls
    await page.getByRole("tab", { name: "Under the hood" }).click();
    await expect(page.getByText("Live Session Gateway Ledger")).toBeVisible();
    await expect(page.getByText("campaign-shoot").first()).toBeVisible();
  });
});
