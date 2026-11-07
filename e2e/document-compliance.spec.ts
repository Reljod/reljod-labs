import { expect, type Page, test } from "@playwright/test";
import { packs } from "../src/features/document-compliance/packs";

const DEMO = "/demos/document-compliance";
// Generous: three parses plus three model calls, on a cold parser.
const RUN_TIMEOUT = 4 * 60 * 1000;

async function runPrescreen(page: Page, slug: string) {
  await page.goto(DEMO);
  await page.getByTestId(`pack-option-${slug}`).click();
  await page.getByTestId("run-prescreen").click();
  const report = page.getByTestId("findings-report");
  await expect(report).toBeVisible({ timeout: RUN_TIMEOUT });
  await expect(report).toHaveAttribute("data-run-status", "completed");
  await expect(page.getByTestId("run-notice")).toHaveCount(0);
}

const compact = (text: string) => text.replace(/\s+/g, "").toLowerCase();

/** Every value shown as Evidence must be boxed on the page and found in the boxed text. */
async function expectEvidenceTraceable(page: Page) {
  let boxesSeen = 0;
  const findings = page.locator('[data-testid^="finding-"]');
  for (let index = 0; index < (await findings.count()); index++) {
    await findings.nth(index).click();
    const fields = page.getByTestId("evidence-field");
    for (
      let fieldIndex = 0;
      fieldIndex < (await fields.count());
      fieldIndex++
    ) {
      const field = fields.nth(fieldIndex);
      const value = (await field.getAttribute("data-field-value")) ?? "";
      const refs = ((await field.getAttribute("data-span-refs")) ?? "")
        .split(" ")
        .filter(Boolean);
      expect(refs.length, `"${value}" cites no spans`).toBeGreaterThan(0);

      const boxedText: string[] = [];
      for (const ref of refs) {
        const box = page.locator(
          `[data-testid="evidence-box"][data-span-ref="${ref}"]`,
        );
        await expect(box, `no box drawn for span ${ref}`).toHaveCount(1);
        boxedText.push((await box.getAttribute("data-span-text")) ?? "");
        boxesSeen++;
      }
      for (const word of value.split(/[^\p{L}\p{N}]+/u).filter(Boolean)) {
        expect(
          compact(boxedText.join(" ")),
          `"${value}" is not in its boxed source text`,
        ).toContain(word.toLowerCase());
      }
    }
  }
  expect(boxesSeen, "no evidence box was drawn at all").toBeGreaterThan(0);
}

for (const pack of packs) {
  test(`${pack.slug}: Findings match the pack's expected outcomes`, async ({
    page,
  }) => {
    await runPrescreen(page, pack.slug);

    for (const { requirementId, outcome } of pack.expectedFindings) {
      await expect
        .soft(page.getByTestId(`finding-${requirementId}`))
        .toHaveAttribute("data-outcome", outcome);
    }

    if (pack.slug === "clean") {
      await test.step("every Finding traces back to boxes on its source", () =>
        expectEvidenceTraceable(page));
    }
  });
}
