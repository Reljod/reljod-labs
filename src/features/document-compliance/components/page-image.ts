/** A preset page image, served through a short-lived signed redirect. */
export function pageImageUrl(packSlug: string, file: string) {
  return `/demos/document-compliance/packs/${packSlug}/${encodeURIComponent(file)}`;
}
