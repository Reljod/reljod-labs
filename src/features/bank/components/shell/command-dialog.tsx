"use client";

import type { ReactNode } from "react";
import type { WriteOutcome } from "../../domain/commands";
import { Button, cx, Dialog, DoneNote, ErrorNote } from "../ui";
import type { useCommand } from "../use-bank";

export type CommandHandle = ReturnType<typeof useCommand>;

/**
 * Asks before a write that is hard to undo, and sends it once through the
 * `useCommand` the caller owns. On an Outcome the dialog closes and the
 * caller shows `OutcomeNote` where the person clicked; on a refusal it stays
 * open with the reason, so the person may fix it and try again.
 */
export function CommandDialog({
  title,
  children,
  confirm,
  pendingLabel,
  danger = false,
  command,
  canConfirm = true,
  onConfirm,
  onClose,
  testId,
}: {
  title: string;
  children: ReactNode;
  confirm: string;
  pendingLabel: string;
  danger?: boolean;
  command: CommandHandle;
  /** False while what the dialog asks for (a note, a typed word) is missing. */
  canConfirm?: boolean;
  onConfirm: () => Promise<WriteOutcome | undefined>;
  onClose: () => void;
  testId?: string;
}) {
  return (
    <Dialog
      title={title}
      onClose={onClose}
      busy={command.pending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={command.pending}>
            Cancel
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            pending={command.pending}
            pendingLabel={pendingLabel}
            disabled={!canConfirm}
            data-testid={testId}
            onClick={async () => {
              const outcome = await onConfirm();
              if (outcome) onClose();
            }}
          >
            {confirm}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {children}
        <ErrorNote>{command.error}</ErrorNote>
      </div>
    </Dialog>
  );
}

/** What a write answered, shown where it was asked. A `needs_approval` is a notice, not an error. */
export function OutcomeNote({
  command,
  className = "",
}: {
  command: Pick<CommandHandle, "outcome" | "error" | "pending">;
  className?: string;
}) {
  if (command.pending) return null;
  if (command.error) {
    return <ErrorNote className={className}>{command.error}</ErrorNote>;
  }
  const outcome = command.outcome;
  if (!outcome) return null;
  if (outcome.status === "done") {
    return <DoneNote className={className}>{outcome.message}</DoneNote>;
  }
  return <Notice className={className}>{outcome.message}</Notice>;
}

/** Something that waits on a person, neither done nor wrong. */
export function Notice({
  children,
  className = "",
}: {
  children?: ReactNode;
  className?: string;
}) {
  if (!children) return null;
  return (
    <p
      aria-live="polite"
      className={cx(
        "outline-box rounded-sm border-brass bg-brass/15 px-3 py-2 text-sm text-ink",
        className,
      )}
    >
      {children}
    </p>
  );
}
