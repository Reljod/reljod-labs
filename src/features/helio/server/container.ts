import "server-only";
import { container } from "@/platform/services/container";
import { pgHelioRate } from "./rate";
import { createHelioService } from "./service";
import { modelStudio, productFiles, stubStudio } from "./studio";

/**
 * Helio's composition root. Live: Gemini 4 Neon and MAI Image 2.7 through
 * AI Gateway. Stubbed (e2e without `x-e2e-live: 1`): canned direction and
 * audits, and the product plate handed back as each image, no spend. The
 * gate, the caps and the image checks are real in both.
 */
export const helio = container(({ stub }) =>
  createHelioService({
    studio: stub ? stubStudio : modelStudio,
    products: productFiles,
    rate: pgHelioRate,
    now: Date.now,
  }),
);
