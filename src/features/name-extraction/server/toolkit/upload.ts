import { LIMITS } from "../../domain/limits";

/** What an Upload may hold. Pure, so the browser-facing checks and the tests share it. */
export const UPLOAD_LIMITS = {
  pages: LIMITS.maxPages,
  charsPerPage: LIMITS.charsPerPage,
};

/** Checks an Upload's JSON: `{ pages: string[] }`, at most 500 pages of 20k characters. */
export function parseUploadPages(value: unknown): string[] {
  const pages = (value as { pages?: unknown } | null)?.pages;
  if (!Array.isArray(pages) || pages.length === 0)
    throw new Error("The upload has no pages.");
  if (pages.length > UPLOAD_LIMITS.pages)
    throw new Error(`The upload has over ${UPLOAD_LIMITS.pages} pages.`);
  return pages.map((page, index) => {
    if (typeof page !== "string")
      throw new Error(`Page ${index + 1} of the upload is not text.`);
    if (page.length > UPLOAD_LIMITS.charsPerPage)
      throw new Error(
        `Page ${index + 1} of the upload is over ${UPLOAD_LIMITS.charsPerPage.toLocaleString("en")} characters.`,
      );
    return page;
  });
}
