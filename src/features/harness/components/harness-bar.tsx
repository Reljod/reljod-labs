import type { ReactNode } from "react";
import { DemoBar } from "@/components/demo/demo-bar";
import { hrefOf, TAB_IDS, type TabId } from "../domain/place";

export const PRODUCT_NAME = "Jod: Harness for Bank";

/** The Harness's places, as the shared demo bar shows them. */
export const TAB_LABEL: Record<TabId, string> = {
  chat: "Chat",
  pipelines: "Pipelines",
  knowledge: "Knowledge",
  skills: "Skills",
  audit: "Audit",
  docs: "Docs",
};

/**
 * The bar's tabs and the app's panels name each other through this: tab
 * `harness-tab-<tab>`, panel `harness-panel-<tab>` (see `DemoTabs`). Demo
 * mode's focus ring in harness.css keys on both.
 */
export const PANELS_ID = "harness";

/**
 * The bar on the Harness's own pages (Connect, consent): the same bar as the
 * app, its places as links back into it. Six places and the controls need
 * the full width, so it is one row only from `xl`.
 */
export function HarnessPageBar({ children }: { children?: ReactNode }) {
  return (
    <DemoBar
      slug="bank-harness"
      name={PRODUCT_NAME}
      rowFrom="xl"
      tabs={TAB_IDS.map((id) => ({
        id,
        label: TAB_LABEL[id],
        href: hrefOf({ tab: id, params: {} }),
      }))}
    >
      {children}
    </DemoBar>
  );
}
