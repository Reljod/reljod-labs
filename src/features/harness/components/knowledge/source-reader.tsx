"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, formatBytes, keys, messageOf } from "../api";
import { useHarness } from "../harness-context";
import {
  Badge,
  Button,
  ConfirmDialog,
  cx,
  DoneNote,
  Empty,
  ErrorNote,
  Loading,
  Panel,
  segmentClass,
  segmentsClass,
  useWrite,
} from "../ui";
import {
  dateLabel,
  KIND_LABEL,
  replacementOf,
  STATUS_LABEL,
  STATUS_TONE,
} from "./format";
import { type PreviewMode, SourcePreview } from "./source-preview";

const REMOVE_DENIED =
  "Only an admin may remove a Source. Switch Staff to try it.";

/** A Source and its Passages. A superseded Passage is struck through, with what replaced it. */
export function SourceReader({
  sourceId,
  initialPreview = null,
  onClose,
  onRemoved,
  onChanged,
  onOpenSource,
  onOpenConflict,
}: {
  sourceId: string;
  /** Opens on the Preview, in this view, instead of the Passages. */
  initialPreview?: PreviewMode | null;
  onClose: () => void;
  onRemoved: () => void;
  onChanged: () => void;
  onOpenSource: (sourceId: string) => void;
  onOpenConflict: (conflictId: string) => void;
}) {
  const { can } = useHarness();
  const detail = useQuery({
    queryKey: keys.source(sourceId),
    queryFn: () => api.sources.get(sourceId),
    // A Source being read is on its way to filed: watch it.
    refetchInterval: (query) => {
      const status = query.state.data?.source.status;
      return status === "reading" || status === "pending" ? 2_000 : false;
    },
  });
  const conflicts = useQuery({
    queryKey: keys.conflicts(),
    queryFn: () => api.knowledge.conflicts(),
  });
  const [confirming, setConfirming] = useState(false);
  const [pane, setPane] = useState<"passages" | "preview">(
    initialPreview ? "preview" : "passages",
  );
  const [previewMode, setPreviewMode] = useState<PreviewMode>(
    initialPreview ?? "original",
  );
  // A link that asks for the Preview (a chat chip) opens it, even on a Source already open.
  useEffect(() => {
    if (initialPreview) {
      setPane("preview");
      setPreviewMode(initialPreview);
    }
  }, [initialPreview]);
  const reread = useWrite(async () => {
    const result = await api.sources.ingest(sourceId);
    onChanged();
    return result.source.status === "ready"
      ? `Filed: ${result.source.passages} Passages, ${result.conflicts.length} Conflict${result.conflicts.length === 1 ? "" : "s"}.`
      : (result.source.error ?? "It was not read.");
  });

  if (detail.isPending) return <Loading rows={4} />;
  if (detail.isError) {
    return (
      <div className="space-y-2">
        <ErrorNote onRetry={() => void detail.refetch()}>
          {messageOf(detail.error)}
        </ErrorNote>
        <Button size="sm" onClick={onClose}>
          Back to Sources
        </Button>
      </div>
    );
  }

  const { source, passages } = detail.data;
  const canRemove = can("source.remove") && !source.isSeed;
  const settled = conflicts.data ?? [];

  return (
    <Panel
      eyebrow={`${KIND_LABEL[source.kind]} · ${dateLabel(source.documentDate, source.createdAt)}`}
      title={source.title}
      actions={
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
      bodyClassName="space-y-3 p-3"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge
          tone={STATUS_TONE[source.status]}
          dot={source.status === "reading"}
        >
          {STATUS_LABEL[source.status]}
        </Badge>
        {source.isSeed ? <Badge tone="ink">Seed</Badge> : null}
        {source.openConflicts > 0 ? (
          <Badge tone="amber">
            {source.openConflicts} open Conflict
            {source.openConflicts === 1 ? "" : "s"}
          </Badge>
        ) : null}
        <span className="text-xs text-ink-muted">
          {formatBytes(source.bytes)}
          {" · "}
          {source.addedBy
            ? `added by ${source.addedBy.name}`
            : "shipped with the Workspace"}
        </span>
      </div>

      <div
        role="radiogroup"
        aria-label="What to show"
        className={segmentsClass}
      >
        {(
          [
            ["passages", "Passages"],
            ["preview", "Preview"],
          ] as const
        ).map(([id, label]) => (
          // biome-ignore lint/a11y/useSemanticElements: a two-way switch drawn as buttons
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={pane === id}
            onClick={() => setPane(id)}
            className={segmentClass(pane === id)}
          >
            {label}
          </button>
        ))}
      </div>

      {pane === "preview" ? (
        <SourcePreview
          sourceId={source.id}
          mode={previewMode}
          onMode={setPreviewMode}
        />
      ) : null}

      {source.status === "pending" || source.status === "failed" ? (
        <div className="space-y-2 rounded-sm outline-box bg-marble/60 p-3 text-sm">
          <p className="text-ink-muted">
            {source.status === "pending"
              ? "This Source is attached but not yet filed. It has no Passages and search does not find it."
              : "This Source could not be read."}
          </p>
          {source.error ? <ErrorNote>{source.error}</ErrorNote> : null}
          {can("source.add") ? (
            <Button
              size="sm"
              variant="primary"
              pending={reread.pending}
              pendingLabel="Reading…"
              onClick={() => void reread.run()}
            >
              {source.status === "failed" ? "Try reading again" : "File it now"}
            </Button>
          ) : null}
          <ErrorNote>{reread.error}</ErrorNote>
          {typeof reread.result === "string" ? (
            <DoneNote>{reread.result}</DoneNote>
          ) : null}
        </div>
      ) : null}
      {source.status === "reading" ? (
        <p className="text-sm text-ink-muted" aria-live="polite">
          Reading this Source into Passages and checking for Conflicts…
        </p>
      ) : null}

      {pane === "passages" &&
      passages.length === 0 &&
      source.status === "ready" ? (
        <Empty title="No Passages">Nothing readable was found.</Empty>
      ) : null}
      <ol className={cx("space-y-2", pane !== "passages" && "hidden")}>
        {passages.map((passage) => {
          const replaced = replacementOf(passage, settled);
          const superseded = passage.supersededBy !== null;
          return (
            <li
              key={passage.id}
              id={`passage-${passage.id}`}
              className={cx(
                "rounded-sm border border-ink px-3 py-2",
                superseded ? "bg-marble text-ink-muted" : "bg-paper",
              )}
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="font-mono text-[0.65rem] text-ink-muted">
                  #{passage.ordinal + 1}
                </span>
                {passage.heading ? (
                  <span className="min-w-0 flex-1 text-xs font-semibold">
                    {passage.heading}
                  </span>
                ) : null}
                {superseded ? <Badge tone="neutral">Superseded</Badge> : null}
              </div>
              <p
                className={cx(
                  "mt-1 text-sm break-words whitespace-pre-wrap",
                  superseded && "line-through decoration-ink/40",
                )}
              >
                {passage.body}
              </p>
              {superseded ? (
                <p className="mt-1 text-xs">
                  Replaced
                  {replaced ? (
                    <>
                      {" by "}
                      <button
                        type="button"
                        className="font-medium text-federal-blue underline underline-offset-2"
                        onClick={() => onOpenSource(replaced.sourceId)}
                      >
                        {replaced.sourceTitle}
                      </button>
                      {" ("}
                      <button
                        type="button"
                        className="font-medium text-federal-blue underline underline-offset-2"
                        onClick={() => onOpenConflict(replaced.conflictId)}
                      >
                        the Conflict
                      </button>
                      {")"}
                    </>
                  ) : (
                    ` by Passage ${passage.supersededBy}`
                  )}
                  {passage.supersededAt
                    ? ` on ${new Date(passage.supersededAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
                    : ""}
                  . Kept, and no longer found by search.
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center gap-2 border-ink border-t-2 pt-3">
        {source.isSeed ? (
          <p className="text-xs text-ink-muted">
            A seed Source is part of the Workspace and cannot be removed.
          </p>
        ) : (
          <>
            <Button
              size="sm"
              variant="danger"
              disabled={!canRemove}
              onClick={() => setConfirming(true)}
            >
              Remove this Source
            </Button>
            {!canRemove ? (
              <p className="text-xs text-ink-muted">{REMOVE_DENIED}</p>
            ) : null}
          </>
        )}
      </div>
      {confirming ? (
        <ConfirmDialog
          title="Remove this Source?"
          confirm="Remove Source"
          pendingLabel="Removing…"
          danger
          onClose={() => setConfirming(false)}
          onConfirm={async () => {
            await api.sources.remove(source.id);
            onRemoved();
          }}
        >
          <p>
            {source.title} leaves the Knowledge base with its {source.passages}{" "}
            Passages and its Conflicts, and search stops finding it. A Passage
            it had superseded will be found by search again. Its file is kept
            for 30 days, then purged.
          </p>
        </ConfirmDialog>
      ) : null}
    </Panel>
  );
}
