import { expect, type Locator, type Page, test } from "@playwright/test";
import { PRESET_QUESTIONS } from "../src/features/ledger/domain/presets";

/*
 * Ledger: ask from the home page, watch him push the chat into the dock, stack
 * the right pieces above the site, kick the rest away and write them up.
 * Stubbed by default: canned Build plans run through the real validation,
 * storage and stream. `E2E_LEDGER_LIVE=1` asks the real model instead and
 * skips the scenarios that need a specific plan.
 */
const live = process.env.E2E_LEDGER_LIVE === "1";
const BUILD_TIMEOUT = live ? 150_000 : 90_000;
const STUB_INVENTED = "stub: invented excerpt";
const STUB_TOSS = "stub: toss";

test.describe.configure({ mode: "serial" });
test.setTimeout(live ? 300_000 : 180_000);
test.use({
  extraHTTPHeaders: {
    "x-e2e-token": process.env.E2E_BYPASS_TOKEN ?? "",
    ...(live ? {} : { "x-ledger-stub": "1" }),
  },
});

/** Records every pose Ledger takes on the session page, so tests can check what he did. */
async function recordPoses(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __poses: string[] }).__poses = seen;
    new MutationObserver(() => {
      const pose = document
        .querySelector('[data-testid="ask-screen"] [data-testid="ledger-cat"]')
        ?.getAttribute("data-pose");
      if (pose && seen.at(-1) !== pose) seen.push(pose);
    }).observe(document, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-pose"],
    });
  });
}

const poses = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __poses: string[] }).__poses ?? [],
  );

const screen = (page: Page) => page.getByTestId("ask-screen");

/**
 * Asks from the home page's chat box and waits for the session's address.
 * The page never reloads: a marker set before asking is still there after.
 */
async function askFromHome(page: Page, question: string, viaPreset = false) {
  await page.goto("/");
  const box = page.getByTestId("ask-box");
  await expect(box).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { __samePage: boolean }).__samePage = true;
  });
  if (viaPreset) {
    await box.getByTestId("preset-chip").filter({ hasText: question }).click();
  } else {
    await box.getByTestId("ask-input").fill(question);
    await box.getByTestId("ask-send").click();
  }
  await page.waitForURL(/\/ask\/[0-9a-f-]{36}/);
  expect(
    await page.evaluate(
      () => (window as unknown as { __samePage?: boolean }).__samePage,
    ),
    "asking never reloads the page",
  ).toBe(true);
}

/** Waits for the Build to finish: Write-up done, Ledger back by the dock. */
async function waitForBuild(page: Page) {
  await expect(screen(page)).toHaveAttribute("data-busy", "false", {
    timeout: BUILD_TIMEOUT,
  });
}

/** Every Source block names a real piece of the page, in the page's own words. */
async function expectGrounded(page: Page, blocks: Locator) {
  const count = await blocks.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index++) {
    const block = blocks.nth(index);
    const source = await block.getAttribute("data-source");
    const excerpt = await block.getAttribute("data-excerpt");
    const piece = page.locator(
      `[data-testid="page-copy"] [data-ledger-source="${source}"]`,
    );
    await expect(piece, `source ${source} exists on the page`).toHaveCount(1);
    if (excerpt) {
      const text = ((await piece.textContent()) ?? "").replace(/\s+/g, " ");
      expect(text, `excerpt of ${source} is verbatim`).toContain(excerpt);
    }
  }
}

async function expectAnswered(page: Page) {
  await waitForBuild(page);
  await expect(page.getByTestId("answer-page")).toBeVisible();
  await expect(screen(page)).toHaveAttribute("data-phase", "answer");
  await expectGrounded(page, page.getByTestId("source-block"));
  const sentences = page.getByTestId("writeup-sentence");
  expect(await sentences.count()).toBeGreaterThan(0);
  await expect(sentences.last()).toHaveAttribute("data-written", "true");
  const sources = await page.getByTestId("source-block").count();
  for (const cite of await page.getByTestId("cite").allTextContents()) {
    expect(
      Number(cite),
      "every citation names a Source block",
    ).toBeLessThanOrEqual(sources);
  }
  const reply = screen(page)
    .locator('[data-testid="chat-message"][data-role="ledger"]')
    .last();
  await expect(reply).not.toHaveText(/^…?$/);
}

test.describe("Ledger", () => {
  test.beforeEach(async ({ page }) => {
    await recordPoses(page);
  });

  for (const question of PRESET_QUESTIONS) {
    test(`preset: ${question}`, async ({ page }) => {
      await askFromHome(page, question, true);
      await expect(page.getByTestId("stack-block").first()).toBeVisible({
        timeout: BUILD_TIMEOUT,
      });
      await expectAnswered(page);
      const seen = await poses(page);
      expect(seen, "tore the page apart first").toContain("unstitch");
      expect(
        seen.some((pose) =>
          ["run", "run-up", "run-down", "fly"].includes(pose),
        ),
        "ran and pushed",
      ).toBe(true);
      expect(seen, "stamped it on the Stack").toContain("stamp");
      expect(seen, "kicked the rest away").toContain("toss");
      expect(seen, "wrote it up").toContain("conduct");
    });
  }

  test("KYC figures are cut out of the Maya Philippines bullet, word for word", async ({
    page,
  }) => {
    await askFromHome(page, PRESET_QUESTIONS[1], true);
    await expectAnswered(page);
    const fromMaya = page.locator(
      '[data-testid="source-block"][data-source^="experience.3"]',
    );
    const kycProject = page.locator(
      '[data-testid="source-block"][data-source="projects.1"]',
    );
    expect(
      (await fromMaya.count()) + (await kycProject.count()),
    ).toBeGreaterThan(0);
    if (!live) {
      const cost = page.locator(
        '[data-testid="source-block"][data-source="experience.3.points.0"][data-excerpt="90% lower KYC operating cost"]',
      );
      await expect(cost).toHaveAttribute("data-kind", "figure");
      await expect(cost).toContainText("90%");
    }
  });

  test("a follow-up rewinds the answer and rebuilds in the same session", async ({
    page,
  }) => {
    await askFromHome(page, PRESET_QUESTIONS[0], true);
    await expectAnswered(page);
    const sessionUrl = page.url();
    await screen(page).getByTestId("chat-input").fill(PRESET_QUESTIONS[2]);
    await screen(page).getByTestId("chat-send").click();
    await expect(screen(page)).toHaveAttribute("data-phase", "stack");
    await expectAnswered(page);
    expect(page.url()).toBe(sessionUrl);
    await expect(
      screen(page).locator('[data-testid="chat-message"][data-role="visitor"]'),
    ).toHaveCount(2);
  });

  test("asking pushes the chat into the dock and logs every move", async ({
    page,
  }) => {
    await askFromHome(page, PRESET_QUESTIONS[5], true);
    await expect(page.getByTestId("dock")).toBeVisible();
    await expect(page.getByTestId("ask-box")).toHaveCount(0);
    await expect(page.getByTestId("hero-cat")).toHaveCount(0);
    await expectAnswered(page);
    const terminal = page.getByTestId("terminal");
    await expect(terminal).toContainText("pushing the chat into the dock");
    await expect(terminal).toContainText("stacked #1");
    await expect(terminal).toContainText("kicking");
    await expect(terminal).toContainText("built in");
  });

  test("a Source block opens, closes and comes back", async ({ page }) => {
    await askFromHome(page, PRESET_QUESTIONS[1], true);
    await expectAnswered(page);
    const sources = page.getByTestId("source-block");
    const count = await sources.count();
    await page.getByTestId("cite").first().click();
    await expect(page.getByTestId("expanded-source")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("expanded-source")).toHaveCount(0);
    // The cards drift; dispatch rather than wait for one to hold still.
    await page.getByTestId("close-source").first().dispatchEvent("click");
    await expect(sources).toHaveCount(count - 1);
    await page.getByTestId("show-sources").click();
    await expect(sources).toHaveCount(count);
  });

  test("an off-topic question builds nothing and offers the presets", async ({
    page,
  }) => {
    await askFromHome(page, "What's the best pizza topping?");
    await waitForBuild(page);
    await expect(screen(page).getByTestId("not-found")).toBeVisible();
    await expect(
      screen(page).getByTestId("not-found").getByTestId("preset-chip"),
    ).toHaveCount(PRESET_QUESTIONS.length);
    await expect(page.getByTestId("answer-page")).toHaveCount(0);
    expect(await poses(page)).toContain("confused");
  });

  test("a stored session shows its answer at once and replays on request", async ({
    page,
  }) => {
    await askFromHome(page, PRESET_QUESTIONS[3], true);
    await expectAnswered(page);
    const before = await page
      .getByTestId("source-block")
      .evaluateAll((blocks) =>
        blocks.map((block) => block.getAttribute("data-source")),
      );

    await page.reload();
    await expect(page.getByTestId("answer-page")).toBeVisible({
      timeout: 10_000,
    });
    await expect(screen(page)).toHaveAttribute("data-busy", "false");
    expect(
      await page
        .getByTestId("source-block")
        .evaluateAll((blocks) =>
          blocks.map((block) => block.getAttribute("data-source")),
        ),
    ).toEqual(before);

    await page.getByTestId("replay-build").click();
    await expect(screen(page)).toHaveAttribute("data-phase", "stack");
    await expect(page.getByTestId("stack-block").first()).toBeVisible({
      timeout: BUILD_TIMEOUT,
    });
    await expectAnswered(page);
  });

  test("the home page is untouched by a session and has no case file", async ({
    page,
  }) => {
    await askFromHome(page, PRESET_QUESTIONS[5], true);
    await expectAnswered(page);
    await page.goto("/");
    await expect(page.getByTestId("ask-box")).toBeVisible();
    await expect(page.getByText("Case file · Digital bank")).toHaveCount(0);
    await expect(page.locator(".ldg-torn")).toHaveCount(0);
    await expect(page.getByTestId("answer-page")).toHaveCount(0);
    await expect(
      page.locator('[data-ledger-source="experience.3.points.0"]'),
    ).toContainText("90% lower KYC operating cost");
  });

  test("an invented excerpt is dropped and never rendered", async ({
    page,
  }) => {
    test.skip(live, "needs a canned plan");
    await askFromHome(page, STUB_INVENTED);
    await expectAnswered(page);
    await expect(page.getByTestId("source-block")).toHaveCount(1);
    await expect(page.getByTestId("answer-page")).not.toContainText("99%");
    await expect(page.locator('[data-source="experience.42"]')).toHaveCount(0);
  });

  test("a tossed block spins away and never reaches the answer", async ({
    page,
  }) => {
    test.skip(live, "needs a canned plan");
    await askFromHome(page, STUB_TOSS);
    await expectAnswered(page);
    expect(await poses(page)).toContain("toss");
    const sources = await page
      .getByTestId("source-block")
      .evaluateAll((blocks) =>
        blocks.map((block) => block.getAttribute("data-source")),
      );
    expect(sources).toEqual(["experience.3"]);
  });

  test("an over-limit visitor lands on a stored answer", async ({ page }) => {
    test.skip(live, "forces the limit with an e2e header");
    await page.setExtraHTTPHeaders({ "x-ledger-force-limit": "1" });
    await page.goto("/");
    await page
      .getByTestId("ask-box")
      .getByTestId("preset-chip")
      .first()
      .click();
    await page.waitForURL(/notice=limited/);
    await expect(screen(page).getByTestId("notice")).toBeVisible();
    await expect(page.getByTestId("answer-page")).toBeVisible();
  });
});

test.describe("Ledger with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("skips the gallop and still builds the answer", async ({ page }) => {
    test.skip(live, "covered by the stubbed run");
    await recordPoses(page);
    const started = Date.now();
    await askFromHome(page, PRESET_QUESTIONS[2], true);
    await expectAnswered(page);
    expect(Date.now() - started).toBeLessThan(45_000);
    const seen = await poses(page);
    expect(
      seen.filter((pose) =>
        ["run", "run-up", "run-down", "fly"].includes(pose),
      ),
    ).toEqual([]);
    await expect(page.locator(".print")).toHaveCount(0);
  });
});

test.describe("Ledger on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("builds into one column with a smaller Ledger", async ({ page }) => {
    test.skip(live, "covered by the stubbed run");
    await recordPoses(page);
    await askFromHome(page, PRESET_QUESTIONS[1], true);
    await expectAnswered(page);
    const cat = screen(page).getByTestId("ledger-cat");
    expect((await cat.boundingBox())?.width).toBe(96);
    const writeup = await page.getByTestId("writeup").boundingBox();
    expect(writeup?.width).toBeLessThanOrEqual(390);
    const scrollWidth = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    expect(scrollWidth, "no sideways scroll").toBeLessThanOrEqual(390);
  });
});
