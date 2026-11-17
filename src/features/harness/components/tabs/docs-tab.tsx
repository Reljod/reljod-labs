"use client";

import DocsViewer from "../docs/docs-viewer";

/**
 * The Docs tab: a documentation site for the Harness. The pages are written
 * in `src/features/harness/docs/`, listed in `registry.ts`, and where a page
 * shows tools, Pipelines, Rules, Skills, limits or Audit actions it builds
 * the table from the code's own registry. `?tab=docs&doc=<page id>` opens a
 * page, and `<page id>#<heading>` a heading in it.
 */
export default function DocsTab() {
  return <DocsViewer />;
}
