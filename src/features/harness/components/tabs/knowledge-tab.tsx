"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Resolution } from "../../domain/knowledge";
import { SAMPLES, sampleById } from "../../domain/samples";
import { api, keys, messageOf } from "../api";
import { useController, useHarness } from "../harness-context";
import {
  type ConflictFilter,
  ConflictsPanel,
} from "../knowledge/conflicts-panel";
import { ADMIN_ONLY } from "../knowledge/format";
import { SearchPanel } from "../knowledge/search-panel";
import { SourceReader } from "../knowledge/source-reader";
import {
  AttachedSources,
  isAttachedOnly,
  SourcesList,
} from "../knowledge/sources-list";
import { UploadPanel } from "../knowledge/upload-panel";
import { useUploads } from "../knowledge/use-uploads";
import { Badge, cx, Empty, ErrorNote, Loading, Tabs } from "../ui";

type View = "sources" | "search" | "conflicts";

const TAB_PREFIX = "hx-knowledge";
const POLL_MS = 2_500;
const SAMPLE_ROOT = "/harness/samples/";

/** A sample (by id or by path under `/harness/samples/`) as a File, as a visitor's own pick would be. */
async function sampleFile(idOrPath: string): Promise<File> {
  const sample =
    sampleById(idOrPath) ?? SAMPLES.find((item) => item.path === idOrPath);
  const path = sample?.path ?? idOrPath;
  if (!path.startsWith(SAMPLE_ROOT) || path.includes("..")) {
    throw new Error("That sample is not available.");
  }
  const response = await fetch(path, { cache: "force-cache" });
  if (!response.ok) throw new Error("That sample could not be loaded.");
  const blob = await response.blob();
  return new File([blob], sample?.name ?? path.slice(SAMPLE_ROOT.length), {
    type: sample?.type ?? blob.type,
  });
}

/**
 * The Knowledge base: the Sources the Agent may search and cite, hybrid
 * search over their Passages, and the Conflicts a new Source raises (ADR
 * 0016). Anyone may add a Source and search; only an admin settles a
 * Conflict or removes a Source, and the buttons say so when they are off.
 */
export default function KnowledgeTab() {
  const { can, place, openTab } = useHarness();
  const queryClient = useQueryClient();
  const sourceParam = place.params.source ?? null;
  const conflictParam = place.params.conflict ?? null;
  const previewParam =
    place.params.preview === "original" || place.params.preview === "text"
      ? place.params.preview
      : null;

  const [view, setView] = useState<View>(
    conflictParam ? "conflicts" : "sources",
  );
  const [filter, setFilter] = useState<ConflictFilter>("open");
  const uploads = useUploads(null);

  // An address that names a Source or a Conflict opens it.
  useEffect(() => {
    if (conflictParam) setView("conflicts");
    else if (sourceParam) setView("sources");
  }, [conflictParam, sourceParam]);

  const sources = useQuery({
    queryKey: keys.sources,
    queryFn: api.sources.list,
    refetchInterval: (query) => {
      const list = query.state.data ?? [];
      const reading = list.some((source) => source.status === "reading");
      const waiting =
        uploads.busy && list.some((source) => source.status === "pending");
      return reading || waiting ? POLL_MS : false;
    },
  });
  const conflicts = useQuery({
    queryKey: keys.conflicts(),
    queryFn: () => api.knowledge.conflicts(),
  });

  const refresh = useCallback(() => {
    for (const root of ["sources", "source", "conflicts", "search"]) {
      void queryClient.invalidateQueries({ queryKey: ["harness", root] });
    }
  }, [queryClient]);

  const openSource = useCallback(
    (sourceId: string) => {
      setView("sources");
      openTab("knowledge", {
        source: sourceId,
        conflict: null,
        preview: null,
      });
    },
    [openTab],
  );
  const closeSource = useCallback(
    () => openTab("knowledge", { source: null, preview: null }),
    [openTab],
  );
  const openConflicts = useCallback(
    (conflictId: string | null = null) => {
      setView("conflicts");
      openTab("knowledge", { conflict: conflictId, source: null });
    },
    [openTab],
  );

  const resolve = useCallback(
    async (conflictId: string, resolution: Resolution) => {
      await api.knowledge.resolve(conflictId, { resolution });
      refresh();
    },
    [refresh],
  );

  // Demo mode ------------------------------------------------------------------
  const latest = useRef({ can, conflictParam });
  latest.current = { can, conflictParam };
  const focused = useRef<string | null>(null);

  useController("knowledge", {
    async uploadFixture(idOrPath) {
      if (!latest.current.can("source.add")) {
        throw new Error("Your Role may not add a Source.");
      }
      setView("sources");
      const outcome = await uploads.add(await sampleFile(idOrPath));
      if (!outcome.ok) throw new Error(outcome.error);
    },
    async openConflict(conflictId) {
      const list = await queryClient.fetchQuery({
        queryKey: keys.conflicts(),
        queryFn: () => api.knowledge.conflicts(),
        staleTime: 0,
      });
      const target = conflictId
        ? list.find((conflict) => conflict.id === conflictId)
        : list.find((conflict) => conflict.status === "open");
      if (!target) {
        throw new Error(
          conflictId
            ? "That Conflict is not in this Workspace."
            : "There is no open Conflict.",
        );
      }
      focused.current = target.id;
      openConflicts(target.id);
      return target.id;
    },
    async resolve(resolution) {
      const id = focused.current ?? latest.current.conflictParam;
      if (!id) throw new Error("Open a Conflict first.");
      if (!latest.current.can("conflict.resolve")) throw new Error(ADMIN_ONLY);
      await resolve(id, resolution);
    },
  });

  const openCount = (conflicts.data ?? []).filter(
    (conflict) => conflict.status === "open",
  ).length;

  const attached = (sources.data ?? []).filter(isAttachedOnly);
  const filed = (sources.data ?? []).filter(
    (source) => !isAttachedOnly(source),
  );
  const fileAttached = useCallback(
    async (sourceId: string) => {
      try {
        return await api.sources.ingest(sourceId);
      } finally {
        refresh();
      }
    },
    [refresh],
  );

  const onFiles = (files: File[]) => {
    for (const file of files) void uploads.add(file);
  };

  const addDenied = can("source.add")
    ? null
    : "Your Role may not add a Source.";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-ink border-b-2 bg-paper px-2 sm:px-4">
        <Tabs<View>
          label="Knowledge base"
          idPrefix={TAB_PREFIX}
          size="sm"
          value={view}
          onChange={(next) => {
            setView(next);
            if (next !== "sources" && sourceParam) {
              openTab("knowledge", { source: null });
            }
          }}
          tabs={[
            { id: "sources", label: "Sources" },
            { id: "search", label: "Search" },
            {
              id: "conflicts",
              label: "Conflicts",
              badge:
                openCount > 0 ? <Badge tone="amber">{openCount}</Badge> : null,
            },
          ]}
        />
      </div>

      <div
        role="tabpanel"
        id={`${TAB_PREFIX}-${view}-panel`}
        aria-labelledby={`${TAB_PREFIX}-${view}`}
        className="hx-scroll min-h-0 flex-1 p-3 sm:p-4"
      >
        {view === "sources" ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:items-start">
            <div
              className={cx(
                "min-w-0 space-y-3",
                sourceParam && "hidden lg:block lg:space-y-3",
              )}
            >
              <p className="text-sm text-ink-muted">
                The documents the Agent may search and cite. The Workspace
                starts with the bank's guides; add more and any that disagree
                with what is there raise a Conflict.
              </p>
              <UploadPanel
                jobs={uploads.jobs}
                busy={uploads.busy}
                disabledReason={addDenied}
                onFiles={onFiles}
                onSample={async (id) => {
                  const outcome = await uploads.add(await sampleFile(id));
                  if (!outcome.ok) throw new Error(outcome.error);
                }}
                onRetry={(key) => void uploads.retry(key)}
                onDismiss={uploads.dismiss}
                onOpen={openSource}
              />
              {sources.isPending ? (
                <Loading rows={4} />
              ) : sources.isError ? (
                <ErrorNote onRetry={() => void sources.refetch()}>
                  {messageOf(sources.error)}
                </ErrorNote>
              ) : (
                <>
                  <AttachedSources
                    sources={attached}
                    canFile={can("source.add")}
                    deniedReason={addDenied}
                    onFile={fileAttached}
                    onOpen={openSource}
                  />
                  <SourcesList
                    sources={filed}
                    selectedId={sourceParam}
                    onOpen={openSource}
                    onOpenConflicts={() => openConflicts()}
                  />
                </>
              )}
            </div>
            <div className={cx("min-w-0", !sourceParam && "hidden lg:block")}>
              {sourceParam ? (
                <SourceReader
                  key={sourceParam}
                  sourceId={sourceParam}
                  initialPreview={previewParam}
                  onClose={closeSource}
                  onRemoved={() => {
                    refresh();
                    closeSource();
                  }}
                  onChanged={refresh}
                  onOpenSource={openSource}
                  onOpenConflict={(id) => openConflicts(id)}
                />
              ) : (
                <Empty title="Pick a Source">
                  Its Passages appear here, in order, with any that a Conflict
                  has superseded struck through.
                </Empty>
              )}
            </div>
          </div>
        ) : view === "search" ? (
          <SearchPanel
            onOpenSource={openSource}
            onOpenConflicts={() => openConflicts()}
          />
        ) : conflicts.isPending ? (
          <Loading rows={3} />
        ) : conflicts.isError ? (
          <ErrorNote onRetry={() => void conflicts.refetch()}>
            {messageOf(conflicts.error)}
          </ErrorNote>
        ) : (
          <ConflictsPanel
            conflicts={conflicts.data}
            filter={filter}
            onFilter={setFilter}
            focusId={conflictParam}
            canResolve={can("conflict.resolve")}
            onResolve={resolve}
            onOpenSource={openSource}
          />
        )}
      </div>
    </div>
  );
}
