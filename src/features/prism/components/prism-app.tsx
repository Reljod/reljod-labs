"use client";

import { useState } from "react";
import {
  DemoBar,
  DemoBarBadge,
  type DemoTab,
} from "@/components/demo/demo-bar";
import { DEFAULT_MODEL_ID, type DecisionModelId } from "../domain/models";
import { CascadeView } from "./cascade-view";
import { LabView } from "./lab-view";
import { PrismStage } from "./prism-stage";
import { TribunalView } from "./tribunal-view";

type PrismTabId = "stage" | "tribunal" | "cascade" | "lab";

export function PrismApp() {
  const [tab, setTab] = useState<PrismTabId>("stage");
  const [visited, setVisited] = useState<Set<PrismTabId>>(
    () => new Set<PrismTabId>(["stage"]),
  );
  const [modelId, setModelId] = useState<DecisionModelId>(DEFAULT_MODEL_ID);

  const openTab = (next: PrismTabId) => {
    setTab(next);
    setVisited((prev) => {
      if (prev.has(next)) return prev;
      const copy = new Set(prev);
      copy.add(next);
      return copy;
    });
  };

  const tabs: DemoTab[] = [
    {
      id: "stage",
      label: "Prism",
      onSelect: () => openTab("stage"),
    },
    {
      id: "tribunal",
      label: "Tribunal",
      onSelect: () => openTab("tribunal"),
    },
    {
      id: "cascade",
      label: "Cascade",
      onSelect: () => openTab("cascade"),
    },
    {
      id: "lab",
      label: "Lab",
      onSelect: () => openTab("lab"),
    },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-marble text-ink">
      <DemoBar
        slug="prism"
        name="Prism"
        titleAs="h1"
        tabs={tabs}
        current={tab}
        panelsId="prism"
        badge={<DemoBarBadge>Decision Models · 0 Output Tokens</DemoBarBadge>}
      >
        <span className="hidden rounded-sm border border-ink bg-paper px-2 py-1 font-mono text-[11px] font-bold text-ink-muted xl:inline">
          Nov 2026 · experimental_decide
        </span>
      </DemoBar>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        <div
          id="prism-panel-stage"
          role="tabpanel"
          aria-labelledby="prism-tab-stage"
          hidden={tab !== "stage"}
        >
          <PrismStage modelId={modelId} onModelChange={setModelId} />
        </div>

        {visited.has("tribunal") && (
          <div
            id="prism-panel-tribunal"
            role="tabpanel"
            aria-labelledby="prism-tab-tribunal"
            hidden={tab !== "tribunal"}
          >
            <TribunalView />
          </div>
        )}

        {visited.has("cascade") && (
          <div
            id="prism-panel-cascade"
            role="tabpanel"
            aria-labelledby="prism-tab-cascade"
            hidden={tab !== "cascade"}
          >
            <CascadeView modelId={modelId} onModelChange={setModelId} />
          </div>
        )}

        {visited.has("lab") && (
          <div
            id="prism-panel-lab"
            role="tabpanel"
            aria-labelledby="prism-tab-lab"
            hidden={tab !== "lab"}
          >
            <LabView modelId={modelId} onModelChange={setModelId} />
          </div>
        )}
      </main>
    </div>
  );
}
