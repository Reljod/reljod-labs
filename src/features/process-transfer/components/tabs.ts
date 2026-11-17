/*
 * The page's tabs, in a plain module so the server page can read `?tab=`
 * without importing the client component's exports.
 */
export const HANDOVER_TABS = [
  "convert",
  "runs",
  "rules",
  "pipeline",
  "audit",
] as const;
export type HandoverTab = (typeof HANDOVER_TABS)[number];

export function parseTab(value: unknown): HandoverTab {
  return HANDOVER_TABS.find((tab) => tab === value) ?? "convert";
}
