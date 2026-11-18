"use client";

import { type ReactNode, useCallback, useState } from "react";
import type { CommandName } from "../../domain/commands";
import { Button, ErrorNote, Loading } from "../ui";
import { useRead } from "../use-bank";

/**
 * "Load older" for a list whose newest page is read live (polled). Each older
 * page is its own read, keyed by its cursor, so a refetch of the newest page
 * never reshuffles the pages under it.
 *
 * When new rows push rows out of the newest page after older pages were
 * attached, a bridge read fills the gap between the newest page's end and the
 * first older page's start, so no row goes missing between them.
 */

export type Paged<T> = { items: T[]; next: number | null };

/** The cursors of the older pages, reset whenever the list's filters change (`listKey`). */
export function useOlderPages(listKey: string) {
  const [state, setState] = useState<{ key: string; cursors: number[] }>({
    key: listKey,
    cursors: [],
  });
  const cursors = state.key === listKey ? state.cursors : [];
  const more = useCallback(
    (cursor: number) =>
      setState((current) => {
        const list = current.key === listKey ? current.cursors : [];
        return list.includes(cursor)
          ? current
          : { key: listKey, cursors: [...list, cursor] };
      }),
    [listKey],
  );
  const reset = useCallback(
    () => setState({ key: listKey, cursors: [] }),
    [listKey],
  );
  return { cursors, more, reset };
}

type PageProps<V, T> = {
  name: CommandName;
  input: Record<string, unknown>;
  select: (view: V) => Paged<T>;
  render: (items: T[]) => ReactNode;
};

/**
 * Everything below the newest page: the bridge (when needed) and the older
 * pages, then the Load older button or the end of the list.
 */
export function OlderPages<V, T extends { id: number }>({
  head,
  cursors,
  onMore,
  endLabel,
  testId,
  ...page
}: PageProps<V, T> & {
  /** The newest page as it stands now. */
  head: Paged<T>;
  cursors: number[];
  onMore: (cursor: number) => void;
  endLabel: string;
  testId?: string;
}) {
  const first = cursors[0];
  const headLast = head.items.at(-1)?.id;
  const needsBridge =
    first !== undefined && headLast !== undefined && headLast > first;
  return (
    <>
      {needsBridge ? (
        <OlderPage {...page} beforeId={headLast} keepFrom={first} />
      ) : null}
      {cursors.map((cursor, index) => (
        <OlderPage
          key={cursor}
          {...page}
          beforeId={cursor}
          last={index === cursors.length - 1}
          onMore={onMore}
          endLabel={endLabel}
          testId={testId}
        />
      ))}
      {cursors.length === 0 ? (
        <More
          next={head.next}
          onMore={onMore}
          endLabel={endLabel}
          testId={testId}
        />
      ) : null}
    </>
  );
}

function OlderPage<V, T extends { id: number }>({
  name,
  input,
  select,
  render,
  beforeId,
  keepFrom,
  last = false,
  onMore,
  endLabel = "",
  testId,
}: PageProps<V, T> & {
  beforeId: number;
  keepFrom?: number;
  last?: boolean;
  onMore?: (cursor: number) => void;
  endLabel?: string;
  testId?: string;
}) {
  const read = useRead<V>(name, { ...input, beforeId });
  if (read.isPending) {
    return (
      <li className="list-none p-3">
        <Loading rows={3} />
      </li>
    );
  }
  if (read.isError || !read.data) {
    return (
      <li className="list-none p-3">
        <ErrorNote onRetry={() => void read.refetch()}>
          {read.error?.message ?? "Could not read the older rows."}
        </ErrorNote>
      </li>
    );
  }
  const page = select(read.data);
  const items =
    keepFrom === undefined
      ? page.items
      : page.items.filter((item) => item.id >= keepFrom);
  return (
    <>
      {render(items)}
      {last && onMore ? (
        <More
          next={page.next}
          onMore={onMore}
          endLabel={endLabel}
          testId={testId}
        />
      ) : null}
    </>
  );
}

function More({
  next,
  onMore,
  endLabel,
  testId,
}: {
  next: number | null;
  onMore: (cursor: number) => void;
  endLabel: string;
  testId?: string;
}) {
  return (
    <li className="flex list-none justify-center p-3">
      {next ? (
        <Button size="sm" onClick={() => onMore(next)} data-testid={testId}>
          Load older
        </Button>
      ) : (
        <span className="text-xs text-ink-muted">{endLabel}</span>
      )}
    </li>
  );
}
