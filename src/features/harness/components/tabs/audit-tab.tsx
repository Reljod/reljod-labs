"use client";

import { ComingPanel } from "../ui";

/**
 * PLACEHOLDER. The Audit and Docs slice replaces this file wholesale and keeps the
 * default export: the shell imports only this path. Read who is signed in
 * and where the app is with `useHarness()`, call the API through
 * `../api`, build from `../ui`, and register a controller for Demo mode
 * with `useController`.
 */
export default function AuditTab() {
  return (
    <ComingPanel title="Audit trail">
      Every action by a Staff member, the Agent or the system, with the model,
      tokens and cost of each Agent event.
    </ComingPanel>
  );
}
