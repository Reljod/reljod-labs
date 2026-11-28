import { expect, test } from "@playwright/test";
import { E2E_HEADER, E2E_LIVE_HEADER } from "../src/platform/request/headers";

/*
 * Vellum: pick a Sample, watch it drawn and measured, Pass after Pass.
 * Stubbed by default (the e2e token alone): the container's canned
 * Draftsman streams a Drawing through the real route, sanitizer and Ruler,
 * with no model call and no database write (the e2e visitor skips the rate
 * limit). `E2E_VELLUM_LIVE=1` sends `x-e2e-live: 1` and asks the real model
 * (about a dollar for a Trace); run it only when asked.
 */
const live = process.env.E2E_VELLUM_LIVE === "1";

test.setTimeout(live ? 900_000 : 120_000);
test.use({
  extraHTTPHeaders: {
    [E2E_HEADER]: process.env.E2E_BYPASS_TOKEN ?? "",
    ...(live ? { [E2E_LIVE_HEADER]: "1" } : {}),
  },
});

test("traces a Sample, measures every Pass and stops on a Rule", async ({
  page,
}) => {
  await page.goto("/demos/vellum");
  await expect(page.getByTestId("vellum-status")).toHaveText(/Pick a screen/i);
  await page.getByTestId("vellum-sample-harbour-dashboard").click();

  const status = page.getByTestId("vellum-status");
  await expect(status).toHaveText(/Traced in \d Pass/i, {
    timeout: live ? 840_000 : 60_000,
  });
  await expect(page.getByTestId("vellum-stamp")).toContainText("LIKENESS");
  await expect(page.getByTestId("vellum-ruler")).toBeVisible();
  await expect(
    page.getByTestId("vellum-palette").locator("li"),
  ).not.toHaveCount(0);
  await expect(
    page.getByRole("img", { name: /The Drawing: \d+ marks/ }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Heat", exact: true }).click();
  await expect(
    page.getByLabel("Where the Drawing differs from the screenshot"),
  ).toBeVisible();

  await page.getByTestId("vellum-tab-hood").click();
  await expect(page.getByText(/"version": "vellum.drawing\/1"/)).toBeVisible();
});

test("refuses a Pass that is not an image before anything is spent", async ({
  request,
}) => {
  const response = await request.post("/api/vellum/passes", {
    data: {
      pass: 1,
      width: 100,
      height: 100,
      screenshot: "data:image/png;base64,PHN2Zz48L3N2Zz4=",
      squared: "data:image/png;base64,PHN2Zz48L3N2Zz4=",
    },
  });
  expect(response.status()).toBe(400);
  expect((await response.json()).error).toMatch(/isn't the image/);
});
