"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { LIMITS } from "../../domain/limits";
import { ApiFailure, api, formatBytes, keys, messageOf } from "../api";
import type { Attachment } from "./chat-state";

let counter = 0;
const nextId = () => {
  counter += 1;
  return `attachment-${counter}`;
};

export type AttachmentStore = ReturnType<typeof useAttachments>;

/**
 * The files waiting to go with the next message, one list per draft (a
 * Session id, or `new`). An attachment is a pending Source: it is uploaded
 * as soon as it is added but not filed (no Passages, no Conflict check), and its id goes in the ChatRequest.
 * Drafts survive switching Sessions because this lives in the tab.
 */
export function useAttachments({
  onLimit,
}: {
  /** Called with the message of a 429, so the composer can say why it is off. */
  onLimit?: (message: string) => void;
} = {}) {
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, Attachment[]>>({});
  // The ref is the truth; state only triggers a render. `take` can then run
  // straight after an `await add(...)`, before React has rendered.
  const ref = useRef(drafts);
  const onLimitRef = useRef(onLimit);
  onLimitRef.current = onLimit;

  const write = useCallback(
    (
      change: (
        all: Record<string, Attachment[]>,
      ) => Record<string, Attachment[]>,
    ) => {
      ref.current = change(ref.current);
      setDrafts(ref.current);
    },
    [],
  );

  const patch = useCallback(
    (key: string, localId: string, change: Partial<Attachment>) =>
      write((all) => ({
        ...all,
        [key]: (all[key] ?? []).map((item) =>
          item.localId === localId ? { ...item, ...change } : item,
        ),
      })),
    [write],
  );

  /** Uploads files into a draft. Resolves when every one has finished; rejects with the first failure's message. */
  const add = useCallback(
    async (
      key: string,
      files: File[],
      sessionId: string | null,
    ): Promise<void> => {
      const items = files.map<Attachment>((file) => ({
        localId: nextId(),
        name: file.name,
        bytes: file.size,
        state: "uploading",
        progress: 0,
        sourceId: null,
        error: null,
      }));
      write((all) => ({ ...all, [key]: [...(all[key] ?? []), ...items] }));
      const failures: string[] = [];
      await Promise.all(
        files.map(async (file, index) => {
          const item = items[index];
          if (!item) return;
          if (file.size > LIMITS.uploadBytes) {
            const error = `${file.name} is larger than ${formatBytes(LIMITS.uploadBytes)}.`;
            patch(key, item.localId, { state: "failed", error });
            failures.push(error);
            return;
          }
          try {
            const source = await api.sources.attach(file, {
              sessionId,
              onProgress: (fraction) =>
                patch(key, item.localId, { progress: fraction }),
            });
            patch(key, item.localId, {
              state: "ready",
              progress: 1,
              sourceId: source.id,
            });
            void queryClient.invalidateQueries({ queryKey: keys.sources });
          } catch (caught) {
            const error = messageOf(caught);
            patch(key, item.localId, { state: "failed", error });
            failures.push(error);
            if (caught instanceof ApiFailure && caught.status === 429) {
              onLimitRef.current?.(caught.message);
            }
          }
        }),
      );
      if (failures[0]) throw new Error(failures[0]);
    },
    [patch, queryClient, write],
  );

  const remove = useCallback(
    (key: string, localId: string) =>
      write((all) => ({
        ...all,
        [key]: (all[key] ?? []).filter((item) => item.localId !== localId),
      })),
    [write],
  );

  /** The ids of the ready files of a draft; the draft is emptied. */
  const take = useCallback(
    (key: string): string[] => {
      const ids = (ref.current[key] ?? []).flatMap((item) =>
        item.state === "ready" && item.sourceId ? [item.sourceId] : [],
      );
      write((all) => ({ ...all, [key]: [] }));
      return ids;
    },
    [write],
  );

  /** The names and ids of a draft, without emptying it. */
  const peek = useCallback((key: string) => ref.current[key] ?? [], []);

  return { drafts, add, remove, take, peek };
}
