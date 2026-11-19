"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ExaminationDetail } from "../domain/contract";
import { api, streamEvents } from "./api";
import { applyEvents, type ExaminationView, emptyView } from "./view";

type State = {
  id: string | null;
  detail: ExaminationDetail | null;
  view: ExaminationView;
  error: string | null;
  loading: boolean;
};

const IDLE: State = {
  id: null,
  detail: null,
  view: emptyView(),
  error: null,
  loading: false,
};

/**
 * One Examination, live: its first read, then its Trail down the stream.
 * Streamed events are applied at most once per animation frame. Opening
 * another Examination (or the same one again) aborts the reads of the last.
 */
export function useExamination(examinationId: string | null) {
  const [state, setState] = useState<State>(IDLE);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((n) => n + 1), []);
  const lastSeq = useRef(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` re-runs the read on purpose.
  useEffect(() => {
    if (!examinationId) {
      setState(IDLE);
      return;
    }
    const controller = new AbortController();
    const { signal } = controller;
    let frame = 0;
    let queued: Parameters<typeof applyEvents>[1] = [];
    const flush = () => {
      frame = 0;
      const events = queued;
      queued = [];
      setState((current) => {
        if (current.id !== examinationId) return current;
        const view = applyEvents(current.view, events);
        lastSeq.current = view.lastSeq;
        return view === current.view ? current : { ...current, view };
      });
    };
    setState((current) =>
      current.id === examinationId
        ? { ...current, loading: true, error: null }
        : { ...IDLE, id: examinationId, loading: true },
    );

    (async () => {
      try {
        const detail = await api.examination(examinationId, { signal });
        const view = applyEvents(emptyView(detail.status), detail.events);
        // The row knows what the Trail may not have said yet.
        view.status = detail.status;
        if (view.pages.length === 0) view.pages = detail.pages;
        lastSeq.current = view.lastSeq;
        setState({
          id: examinationId,
          detail,
          view,
          error: null,
          loading: false,
        });
        let over = detail.status !== "queued" && detail.status !== "running";
        let failures = 0;
        while (!over && !signal.aborted) {
          let ended = false;
          try {
            await streamEvents(
              examinationId,
              lastSeq.current,
              (events) => {
                queued.push(...events);
                if (events.some((event) => event.type === "end")) ended = true;
                // Without a frame to wait for (a hidden tab), apply at once.
                if (!frame)
                  frame =
                    typeof requestAnimationFrame === "function" &&
                    document.visibilityState === "visible"
                      ? requestAnimationFrame(flush)
                      : (setTimeout(flush, 0) as unknown as number);
              },
              signal,
            );
            failures = 0;
          } catch {
            if (signal.aborted) return;
            failures += 1;
            if (failures > 5) throw new Error("The live stream was lost.");
            await new Promise((resolve) => setTimeout(resolve, 1200));
          }
          over = ended;
        }
        if (signal.aborted) return;
        // The row's last word: the Score, the cost, the Verdict as stored.
        const last = await api.examination(examinationId, { signal });
        setState((current) =>
          current.id === examinationId
            ? {
                ...current,
                detail: last,
                view: applyEvents(current.view, last.events),
              }
            : current,
        );
      } catch (error) {
        if (signal.aborted) return;
        setState((current) => ({
          ...current,
          loading: false,
          error:
            error instanceof Error ? error.message : "It could not be loaded.",
        }));
      }
    })();
    return () => {
      controller.abort();
      if (frame) {
        cancelAnimationFrame(frame);
        clearTimeout(frame);
      }
    };
  }, [examinationId, version]);

  return { ...state, reload };
}
