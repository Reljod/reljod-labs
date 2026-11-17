"use client";

import type { SourceView } from "../../domain/knowledge";
import { formatBytes } from "../api";
import { Badge, Button, cx, Empty, useWrite } from "../ui";
import { dateLabel, KIND_LABEL, STATUS_LABEL, STATUS_TONE } from "./format";

/** The Workspace's Sources: title, kind, date, status, who added it. A seed Source says so. */
export function SourcesList({
  sources,
  selectedId,
  onOpen,
  onOpenConflicts,
}: {
  sources: SourceView[];
  selectedId: string | null;
  onOpen: (sourceId: string) => void;
  onOpenConflicts: () => void;
}) {
  if (sources.length === 0) {
    return (
      <Empty title="No Sources yet">
        Add a guide, a circular or a spreadsheet and the Agent can search and
        cite it.
      </Empty>
    );
  }
  return (
    <ul className="divide-y divide-ink/10 rounded-sm outline-box bg-paper">
      {sources.map((source) => (
        <li key={source.id}>
          <div
            className={cx(
              "flex flex-col gap-1.5 px-3 py-2.5",
              source.id === selectedId && "bg-morning-haze/60",
            )}
          >
            <button
              type="button"
              onClick={() => onOpen(source.id)}
              aria-current={source.id === selectedId ? "true" : undefined}
              className="min-w-0 text-left text-sm font-semibold text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-federal-blue"
            >
              {source.title}
            </button>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge>{KIND_LABEL[source.kind]}</Badge>
              <Badge
                tone={STATUS_TONE[source.status]}
                dot={source.status === "reading"}
                title={
                  source.status === "pending"
                    ? "Attached but not read yet: it has no Passages and search does not find it."
                    : undefined
                }
              >
                {STATUS_LABEL[source.status]}
              </Badge>
              {source.isSeed ? <Badge tone="ink">Seed</Badge> : null}
              {source.openConflicts > 0 ? (
                <button
                  type="button"
                  onClick={onOpenConflicts}
                  className="rounded-sm focus-visible:outline-2 focus-visible:outline-federal-blue"
                >
                  <Badge tone="amber">
                    {source.openConflicts} open Conflict
                    {source.openConflicts === 1 ? "" : "s"}
                  </Badge>
                </button>
              ) : null}
            </div>
            <p className="text-xs text-ink-muted">
              {dateLabel(source.documentDate, source.createdAt)}
              {" · "}
              {source.status === "ready" || source.passages > 0
                ? `${source.passages} Passage${source.passages === 1 ? "" : "s"}`
                : formatBytes(source.bytes)}
              {" · "}
              {source.addedBy
                ? `added by ${source.addedBy.name}`
                : "shipped with the Workspace"}
            </p>
            {source.status === "failed" && source.error ? (
              <p className="text-xs text-seal-red">{source.error}</p>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** A Source attached in a Session and never filed: readable by the Agent, with no Passages. */
export const isAttachedOnly = (source: SourceView) =>
  source.status === "pending" && source.sessionId !== null;

/**
 * Sources attached in a Session and not filed. They are not in the Knowledge
 * base: the Agent can read them and a Pipeline can take them as input, but
 * search does not find them and no Conflict check has run. Filing one reads
 * it into Passages and checks it against the Sources already there.
 */
export function AttachedSources({
  sources,
  canFile,
  deniedReason,
  onFile,
  onOpen,
}: {
  sources: SourceView[];
  canFile: boolean;
  deniedReason: string | null;
  onFile: (sourceId: string) => Promise<unknown>;
  onOpen: (sourceId: string) => void;
}) {
  if (sources.length === 0) return null;
  return (
    <section aria-labelledby="hx-attached-heading" className="space-y-2">
      <div>
        <h3 id="hx-attached-heading" className="text-sm font-semibold text-ink">
          Attached in a Session, not filed
        </h3>
        <p className="text-xs text-ink-muted">
          The Agent can read these and a Pipeline can take them as input. Search
          does not find them and no Conflict check has run until you file one.
        </p>
      </div>
      <ul className="divide-y divide-ink/10 rounded-sm outline-box bg-paper">
        {sources.map((source) => (
          <AttachedRow
            key={source.id}
            source={source}
            canFile={canFile}
            deniedReason={deniedReason}
            onFile={onFile}
            onOpen={onOpen}
          />
        ))}
      </ul>
    </section>
  );
}

function AttachedRow({
  source,
  canFile,
  deniedReason,
  onFile,
  onOpen,
}: {
  source: SourceView;
  canFile: boolean;
  deniedReason: string | null;
  onFile: (sourceId: string) => Promise<unknown>;
  onOpen: (sourceId: string) => void;
}) {
  const file = useWrite(() => onFile(source.id));
  return (
    <li className="flex flex-col gap-1.5 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          onClick={() => onOpen(source.id)}
          className="min-w-0 flex-1 text-left text-sm font-semibold text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-federal-blue"
        >
          {source.title}
        </button>
        <Button
          size="sm"
          variant="primary"
          disabled={!canFile}
          pending={file.pending}
          pendingLabel="Filing…"
          title={canFile ? undefined : (deniedReason ?? undefined)}
          onClick={() => void file.run()}
        >
          File
        </Button>
      </div>
      <p className="text-xs text-ink-muted">
        {KIND_LABEL[source.kind]}
        {" · "}
        {formatBytes(source.bytes)}
        {" · "}
        {source.addedBy ? `attached by ${source.addedBy.name}` : "attached"}
      </p>
      {file.error ? (
        <p role="alert" className="text-xs text-seal-red">
          {file.error}
        </p>
      ) : null}
    </li>
  );
}
