"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DemoBar, DemoBarBadge } from "@/components/demo/demo-bar";
import type { ExaminationSummary, SampleCard } from "../domain/contract";
import { DEFAULT_RULEBOOK, type RulebookVersion } from "../domain/rules";
import type { Calibration } from "../domain/score";
import { overall } from "../domain/score";
import { api } from "./api";
import { Examination, Shelf } from "./examine";
import { Connect, Hood } from "./hood";
import "./loupe.css";
import { Rules } from "./rules";
import { ErrorNote } from "./ui";
import { useExamination } from "./use-examination";

const TABS = [
  ["examine", "Examine"],
  ["rules", "Rules"],
  ["hood", "Under the hood"],
  ["connect", "Connect"],
] as const;
type TabId = (typeof TABS)[number][0];

const DEFAULTS: RulebookVersion = {
  version: 0,
  rulebook: DEFAULT_RULEBOOK,
  createdAt: new Date(0).toISOString(),
  note: null,
  changes: [],
};

function fromUrl(): { tab: TabId; x: string | null } {
  if (typeof window === "undefined") return { tab: "examine", x: null };
  const params = new URLSearchParams(window.location.search);
  const tab = params.get("tab");
  return {
    tab: TABS.some(([id]) => id === tab) ? (tab as TabId) : "examine",
    x: params.get("x"),
  };
}

/**
 * Loupe's page. The first view (the Owner's Examinations and Rulebook
 * versions) arrives with the page; the Samples and the Default Calibration
 * are seed data from the static shell. `?tab=` and `?x=` address a place.
 */
export function Loupe({
  samples,
  calibration,
  initialExaminations,
  initialRulebooks,
}: {
  samples: SampleCard[];
  calibration: Calibration;
  initialExaminations: ExaminationSummary[] | null;
  initialRulebooks: RulebookVersion[] | null;
}) {
  const [tab, setTab] = useState<TabId>("examine");
  const [openId, setOpenId] = useState<string | null>(null);
  const [visited, setVisited] = useState<Set<TabId>>(new Set(["examine"]));
  const [examinations, setExaminations] = useState(initialExaminations ?? []);
  const [rulebooks, setRulebooks] = useState(initialRulebooks ?? [DEFAULTS]);
  const [error, setError] = useState<string | null>(
    initialExaminations === null
      ? "Your saved Examinations could not be loaded."
      : null,
  );
  const live = useExamination(openId);
  const refreshing = useRef<AbortController | null>(null);

  // The address names the place; read it once, after hydration.
  useEffect(() => {
    const place = fromUrl();
    setTab(place.tab);
    setVisited((seen) => new Set(seen).add(place.tab));
    if (place.x) setOpenId(place.x);
  }, []);

  const go = useCallback((next: { tab?: TabId; x?: string | null }) => {
    const params = new URLSearchParams(window.location.search);
    if (next.tab) {
      if (next.tab === "examine") params.delete("tab");
      else params.set("tab", next.tab);
      setTab(next.tab);
      setVisited((seen) => new Set(seen).add(next.tab as TabId));
    }
    if (next.x !== undefined) {
      if (next.x) params.set("x", next.x);
      else params.delete("x");
      setOpenId(next.x);
    }
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}`,
    );
  }, []);

  // A newer refresh aborts the older one, so a read in flight never undoes a write.
  const refresh = useCallback(async () => {
    refreshing.current?.abort();
    const controller = new AbortController();
    refreshing.current = controller;
    try {
      const [list, books] = await Promise.all([
        api.examinations({ signal: controller.signal }),
        api.rulebooks({ signal: controller.signal }),
      ]);
      setExaminations(list);
      setRulebooks(books);
      setError(null);
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(reason instanceof Error ? reason.message : "Could not refresh.");
    }
  }, []);

  // When an Examination ends, the list has a new Verdict to show.
  const ended = live.view.ended;
  useEffect(() => {
    if (ended) void refresh();
  }, [ended, refresh]);

  const all = overall(calibration);
  const current = rulebooks[0] ?? DEFAULTS;

  return (
    <div className="flex min-h-dvh flex-col bg-marble text-ink">
      <DemoBar
        slug="loupe"
        name="Loupe"
        titleAs="h1"
        panelsId="loupe"
        current={tab}
        badge={<DemoBarBadge>Synthetic data</DemoBarBadge>}
        tabs={TABS.map(([id, label]) => ({
          id,
          label,
          testId: `loupe-tab-${id}`,
          onSelect: () => go({ tab: id }),
        }))}
      />
      <main className="mx-auto w-full max-w-[100rem] flex-1 space-y-5 px-3 py-5 sm:px-5">
        <p
          className="outline-box rounded-sm bg-paper px-3 py-2 text-sm shadow-hard-sm"
          data-testid="loupe-claim"
        >
          <strong>Evidence for a human reviewer, not a decision.</strong> On
          our {all.documents}-document synthetic Corpus the model-free Sweep
          flagged {all.falsePositives} of {all.genuine} genuine documents
          (false-positive rate {(all.falsePositiveRate * 100).toFixed(0)}%) and
          detected {all.detected} of {all.tampered} tampered ones (
          {(all.detectionRate * 100).toFixed(0)}%). A small sample: expect
          misses and false alarms on real paperwork.
        </p>
        {error ? <ErrorNote>{error}</ErrorNote> : null}

        <section
          id="loupe-panel-examine"
          role="tabpanel"
          aria-labelledby="loupe-tab-examine"
          hidden={tab !== "examine"}
        >
          {openId ? (
            <Examination
              live={live}
              currentRulebookVersion={current.version}
              onClose={() => go({ x: null })}
              onChanged={refresh}
            />
          ) : (
            <Shelf
              samples={samples}
              examinations={examinations}
              currentRulebookVersion={current.version}
              onOpen={(id) => go({ x: id })}
              onStarted={(id) => {
                go({ x: id });
                void refresh();
              }}
            />
          )}
        </section>

        {/* A tab mounts when first visited and stays mounted, so coming back shows what it showed. */}
        <section
          id="loupe-panel-rules"
          role="tabpanel"
          aria-labelledby="loupe-tab-rules"
          hidden={tab !== "rules"}
        >
          {visited.has("rules") ? (
            <Rules versions={rulebooks} onSaved={refresh} />
          ) : null}
        </section>
        <section
          id="loupe-panel-hood"
          role="tabpanel"
          aria-labelledby="loupe-tab-hood"
          hidden={tab !== "hood"}
        >
          {visited.has("hood") ? (
            <Hood
              view={openId ? live.view : null}
              title={openId ? (live.detail?.title ?? null) : null}
              calibration={calibration}
            />
          ) : null}
        </section>
        <section
          id="loupe-panel-connect"
          role="tabpanel"
          aria-labelledby="loupe-tab-connect"
          hidden={tab !== "connect"}
        >
          {visited.has("connect") ? <Connect /> : null}
        </section>
      </main>
    </div>
  );
}

/** The page's shape while its first view loads. */
export function LoupeSkeleton() {
  return (
    <div className="flex min-h-dvh flex-col bg-marble" aria-busy="true">
      <div className="h-14 border-ink border-b-2 bg-marble" />
      <div className="mx-auto w-full max-w-[100rem] flex-1 space-y-5 px-3 py-5 sm:px-5">
        <span className="sr-only" role="status" aria-live="polite">
          Loading Loupe
        </span>
        <div className="outline-box h-10 rounded-sm bg-paper" />
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="outline-box rounded-sm bg-paper p-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
              {Array.from({ length: 10 }, (_, index) => (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: a fixed row of placeholders.
                  key={index}
                  className="outline-box aspect-[4/5] rounded-sm bg-limestone motion-safe:animate-pulse"
                />
              ))}
            </div>
          </div>
          <div className="outline-box h-72 rounded-sm bg-paper" />
        </div>
      </div>
    </div>
  );
}
