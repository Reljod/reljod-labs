import { describe, expect, it } from "vitest";
import { buildScreenBundle, bundleHash } from "./build";
import { SCREEN_BUNDLE, SCREEN_BUNDLE_HASH } from "./screen-bundle.generated";

describe("the Screen process bundle", () => {
  it("is the one its sources build to (run `pnpm build:operator-screen`)", async () => {
    const fresh = await buildScreenBundle();
    expect(bundleHash(fresh)).toBe(SCREEN_BUNDLE_HASH);
    expect(bundleHash(SCREEN_BUNDLE)).toBe(SCREEN_BUNDLE_HASH);
  });

  it("carries no schema library and leaves the browser driver to the image", () => {
    expect(SCREEN_BUNDLE).toContain('require("playwright-core")');
    expect(SCREEN_BUNDLE).not.toContain("ZodError");
    expect(SCREEN_BUNDLE.length).toBeLessThan(400_000);
  });
});
