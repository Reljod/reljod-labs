"use client";

import { useState } from "react";
import {
  type ConflictSide,
  type ConflictView,
  RESOLUTION_LABEL,
  RESOLUTIONS,
  type Resolution,
} from "../../domain/knowledge";
import { formatDocumentDate } from "../../domain/knowledge/dates";
import { Badge, Button, ConfirmDialog, cx, Panel } from "../ui";
import { ADMIN_ONLY, RESOLUTION_EFFECT, RESOLUTION_SHORT } from "./format";

function Side({
  label,
  side,
  onOpenSource,
  tone,
}: {
  label: string;
  side: ConflictSide;
  onOpenSource: (sourceId: string) => void;
  tone: "new" | "old";
}) {
  return (
    <div
      className={cx(
        "min-w-0 rounded-sm border border-ink px-3 py-2",
        tone === "new" ? "bg-morning-haze" : "bg-marble",
      )}
    >
      <p className="eyebrow text-[0.65rem] text-ink-muted">{label}</p>
      <button
        type="button"
        onClick={() => onOpenSource(side.sourceId)}
        className="mt-0.5 text-left text-sm font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-federal-blue"
      >
        {side.sourceTitle}
      </button>
      <p className="text-xs text-ink-muted">
        {formatDocumentDate(side.documentDate)}
        {side.heading ? ` · ${side.heading}` : ""}
      </p>
      <p className="mt-1.5 max-h-56 overflow-y-auto text-sm break-words whitespace-pre-wrap hx-scroll">
        {side.body}
      </p>
    </div>
  );
}

/**
 * One Conflict: the two Passages side by side with their Sources and dates,
 * what the Agent found, what it proposes and why, and the three decisions. The
 * Agent proposes; only an admin decides, and the buttons say why when they
 * are off. Settling asks first, because it cannot be taken back.
 */
export function ConflictCard({
  conflict,
  canResolve,
  highlighted,
  onResolve,
  onOpenSource,
}: {
  conflict: ConflictView;
  canResolve: boolean;
  highlighted: boolean;
  /** Does the write; resolves to nothing, throws a message on failure. */
  onResolve: (conflictId: string, resolution: Resolution) => Promise<void>;
  onOpenSource: (sourceId: string) => void;
}) {
  const [choice, setChoice] = useState<Resolution | null>(null);
  const open = conflict.status === "open";
  return (
    <Panel
      as="article"
      eyebrow={open ? "Open Conflict" : "Settled Conflict"}
      title={conflict.summary}
      className={cx(highlighted && "outline-2 outline-federal-blue")}
      actions={
        open ? (
          <Badge tone="amber">Needs a decision</Badge>
        ) : (
          <Badge tone="green">Settled</Badge>
        )
      }
      bodyClassName="space-y-3 p-3"
    >
      <div id={`conflict-${conflict.id}`} className="grid gap-2 md:grid-cols-2">
        <Side
          label="New Passage"
          side={conflict.newPassage}
          onOpenSource={onOpenSource}
          tone="new"
        />
        <Side
          label="Existing Passage"
          side={conflict.oldPassage}
          onOpenSource={onOpenSource}
          tone="old"
        />
      </div>

      <div className="rounded-sm outline-box bg-paper px-3 py-2 text-sm">
        <p className="eyebrow text-[0.65rem] text-ink-muted">
          What the Agent proposes
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-2">
          <Badge tone="blue">{RESOLUTION_SHORT[conflict.proposal]}</Badge>
          <span className="text-xs text-ink-muted">
            A proposal. A person decides.
          </span>
        </p>
        {conflict.reasoning ? (
          <p className="mt-1.5 text-ink-muted">{conflict.reasoning}</p>
        ) : null}
      </div>

      {open ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {RESOLUTIONS.map((resolution) => (
              <Button
                key={resolution}
                size="sm"
                variant={
                  resolution === conflict.proposal ? "primary" : "secondary"
                }
                disabled={!canResolve}
                onClick={() => setChoice(resolution)}
                title={RESOLUTION_LABEL[resolution]}
              >
                {RESOLUTION_SHORT[resolution]}
                {resolution === conflict.proposal ? " (proposed)" : ""}
              </Button>
            ))}
          </div>
          {!canResolve ? (
            <p className="text-xs text-ink-muted">{ADMIN_ONLY}</p>
          ) : null}
        </div>
      ) : (
        <p className="text-sm">
          <span className="font-semibold">
            {conflict.resolution
              ? RESOLUTION_LABEL[conflict.resolution]
              : "Settled"}
          </span>
          <span className="text-ink-muted">
            {conflict.decidedBy ? ` · by ${conflict.decidedBy.name}` : ""}
            {conflict.decidedAt
              ? ` · ${new Date(conflict.decidedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
              : ""}
          </span>
        </p>
      )}

      {choice ? (
        <ConfirmDialog
          title={RESOLUTION_SHORT[choice]}
          confirm={`Settle: ${RESOLUTION_SHORT[choice]}`}
          pendingLabel="Settling…"
          onClose={() => setChoice(null)}
          onConfirm={() => onResolve(conflict.id, choice)}
        >
          <p>{RESOLUTION_EFFECT[choice]}</p>
          <p className="mt-2">A settled Conflict cannot be reopened.</p>
        </ConfirmDialog>
      ) : null}
    </Panel>
  );
}
