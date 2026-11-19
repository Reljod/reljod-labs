/** A link from GitHub, or null: only https links are rendered, whatever a row holds. */
export const safeHref = (url: string | null): string | null =>
  url?.startsWith("https://") ? url : null;
