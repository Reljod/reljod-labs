import { expect, test } from "@playwright/test";

/*
 * Prism, the main path across all four tabs. Decision Model calls are stubbed
 * (the e2e token alone selects the container's stub Decider: deterministic
 * calibrated answers in place of AI Gateway, zero spend) while the Access
 * gate, route validation, the caps, NDJSON streaming, threshold physics, and
 * UI animations run for real.
 *
 * Opt-in with `E2E_PRISM=1`.
 */
test.skip(
  process.env.E2E_PRISM !== "1",
  "Set E2E_PRISM=1 to run the stubbed Prism end-to-end suite.",
);

test.describe("Prism (stubbed Decision Models)", () => {
  test("refracts a slip live, re-routes with zero extra API calls on threshold slide, and runs Tribunal, Cascade, and Lab", async ({
    page,
  }) => {
    const refractCalls: string[] = [];
    page.on("request", (request) => {
      if (request.method() !== "POST") return;
      const path = new URL(request.url()).pathname;
      if (path === "/api/prism/refract") refractCalls.push(path);
    });

    await page.goto("/demos/prism");

    // Arrives alive with the optical chamber and specimen slip.
    await expect(page.getByText("Single-Pass Optical Chamber")).toBeVisible();
    await expect(page.getByText("0 OUT TOK")).toBeVisible();

    // Fire a live (stubbed) refraction.
    await page.getByRole("button", { name: /Refract Slip/i }).click();
    await expect(page.getByText(/● Live ·/i)).toBeVisible({ timeout: 15_000 });
    expect(refractCalls).toHaveLength(1);

    // Moving threshold sliders re-routes deterministically with ZERO extra API calls.
    const adversarialSlider = page.getByLabel("Adversarial Tripwire");
    await adversarialSlider.fill("0.95");
    const escalateSlider = page.getByLabel("Escalate Risk Floor");
    await escalateSlider.fill("0.95");
    await expect(page.getByText("HOLD FOR REVIEW")).toBeVisible();
    expect(refractCalls).toHaveLength(1);

    // Tribunal tab: streams 4 parallel jurors over NDJSON.
    await page.getByRole("tab", { name: "Tribunal" }).click();
    await page.getByRole("button", { name: /Convene Tribunal/i }).click();
    await expect(page.getByText(/Wall: \d+ ms/)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("#4")).toBeVisible();

    // Cascade tab: streams 12 slips off the conveyor into the 3 chutes.
    await page.getByRole("tab", { name: "Cascade" }).click();
    await page.getByRole("button", { name: /Run Sorting Machine/i }).click();
    await expect(page.getByText("12/12 slips sorted")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText("CONVEYOR CLEARED")).toBeVisible();

    // Lab tab: evaluates custom rubric questions and renders the SDK snippet.
    await page.getByRole("tab", { name: "Lab" }).click();
    await page.getByRole("button", { name: /Run Custom Slate/i }).click();
    await expect(page.getByText("Output Tok")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("pre code")).toContainText("experimental_decide");
  });
});
