"use client";

import { ComingPanel } from "../ui";

/**
 * PLACEHOLDER. The Chat/MCP slice replaces this file wholesale and keeps the
 * default export: the shell imports only this path. Read who is signed in
 * and where the app is with `useHarness()`, call the API through
 * `../api`, build from `../ui`, and register a controller for Demo mode
 * with `useController`.
 */
export default function ChatTab() {
  return (
    <ComingPanel title="Chat">
      Sessions with the Agent: ask about a Member, upload a document, start a
      Run and watch the answer arrive.
    </ComingPanel>
  );
}
