"use client";

import { Button, Dialog } from "../ui";

/**
 * PLACEHOLDER. The Demo mode slice replaces this file wholesale and keeps
 * the default export and its props: the shell imports only this path and
 * renders it while `open`. Drive the app through `useHarness().controller()`
 * (`chat.send`, `staff.switch`, `tabs.open`, …), never through a tab's
 * internals.
 */
export default function DemoMode({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <Dialog
      title="Demo mode"
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <p className="eyebrow text-[0.65rem] text-ink-muted">Coming</p>
      <p className="mt-2 text-ink-muted">
        Pick a Scenario and press Next: each Beat does the next thing for you in
        your own Workspace, with the live model. Until it lands, the tabs are
        yours to explore.
      </p>
    </Dialog>
  );
}
