import { expect, test } from "@playwright/test";

/*
 * Floorwalk: replay a recorded Walk, then walk a Sample through the real
 * route with the scripted Walker (`x-floorwalk-stub` with the bypass token:
 * the answer key's planted problems, no model call, no database write, the
 * e2e visitor skips the rate limit). `E2E_FLOORWALK_LIVE=1` walks one Sample
 * on the real model (about four cents); run it only when asked.
 */
const live = process.env.E2E_FLOORWALK_LIVE === "1";
const token = process.env.E2E_BYPASS_TOKEN ?? "";

test.setTimeout(live ? 300_000 : 120_000);
test.use({
  extraHTTPHeaders: {
    "x-e2e-token": token,
    ...(live ? {} : { "x-floorwalk-stub": token }),
  },
});

test("replays a recorded Walk and checks it against the answer key", async ({
  page,
}) => {
  await page.goto("/demos/floorwalk");
  await page
    .getByTestId("floorwalk-sample-cold-store")
    .getByRole("button", { name: /Watch it walk/ })
    .click();
  await expect(page.getByTestId("floorwalk-finding")).toHaveCount(6, {
    timeout: 60_000,
  });
  await expect(page.getByTestId("floorwalk-band")).toBeVisible();
  await expect(page.getByTestId("floorwalk-answer-key")).toContainText("6/6");

  // The Standard re-scores without a model call.
  const score = page.getByTestId("floorwalk-score");
  const before = await score.innerText();
  await page.getByTestId("floorwalk-tab-standard").click();
  await page
    .getByRole("checkbox", { name: "Fire exits clear is on" })
    .uncheck();
  await page.getByTestId("floorwalk-tab-walk").click();
  await expect(score).not.toHaveText(before);

  await page.getByTestId("floorwalk-tab-hood").click();
  await expect(page.getByTestId("floorwalk-raw")).toContainText(
    '"type":"sighting"',
  );
});

test("walks a Sample through the route, line by line", async ({ page }) => {
  await page.goto("/demos/floorwalk");
  await page
    .getByTestId("floorwalk-sample-grocer")
    .getByRole("button", { name: /Walk it live/ })
    .click();
  await expect(page.getByTestId("floorwalk-status")).toHaveText(/Done/i, {
    timeout: live ? 240_000 : 60_000,
  });
  await expect(page.getByTestId("floorwalk-finding")).not.toHaveCount(0);
  await expect(page.getByTestId("floorwalk-answer-key")).toBeVisible();
});

test("refuses an upload path outside the caller's own folder before anything is spent", async ({
  request,
}) => {
  const response = await request.post("/api/floorwalk/walks", {
    data: {
      source: {
        kind: "upload",
        path: "uploads/2026112106/guest-someone-else/00000000-0000-4000-8000-000000000000.mp4",
      },
    },
  });
  expect(response.status()).toBe(400);
  expect((await response.json()).error).toMatch(/not one of yours/);
});
