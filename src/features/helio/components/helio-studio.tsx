"use client";

import "./helio.css";
import { AnimatePresence, motion } from "motion/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DemoBar, DemoBarBadge } from "@/components/demo/demo-bar";
import { LIMITS } from "../domain/limits";
import {
  DIRECTOR_PRESETS,
  findMarket,
  MARKETS,
  SPECIMENS,
} from "../domain/samples";
import type {
  ArtDirectionBrief,
  CampaignFrame,
  FrameVersion,
  HelioModelTier,
  HelioSpecimen,
  HelioTab,
  OpticalTelemetry,
  TelemetryLedgerEntry,
} from "../domain/types";
import {
  fileToDataUrl,
  type ProductPayload,
  postBrandAudit,
  postExtractPlate,
  postSurgicalEdit,
  streamCampaignShoot,
} from "./api";
import { CompareShootout } from "./compare-shootout";
import { ContactSheetStrip } from "./contact-sheet";
import { HelioStage3D } from "./helio-stage-3d";
import { OpticalCurtainStage } from "./optical-curtain";
import { ExecutiveRoiBar, OpticalTelemetryStrip } from "./optical-meters";
import { PlacementsWall } from "./placements-wall";
import { UnderTheHoodPanel } from "./under-the-hood";

type CustomProduct = {
  name: string;
  brand: string;
  category: string;
  priceTag: string;
  materialNotes: string;
  imageDataUrl: string;
  accentHex: string;
};

const VALID_TABS = new Set<HelioTab>([
  "studio",
  "placements",
  "compare",
  "hood",
]);

function readTabParam(raw: string | null): HelioTab {
  if (raw && VALID_TABS.has(raw as HelioTab)) return raw as HelioTab;
  return "studio";
}

export function HelioStudio() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<HelioTab>(() =>
    readTabParam(searchParams.get("tab")),
  );
  const [visitedTabs, setVisitedTabs] = useState<Set<HelioTab>>(
    () => new Set([readTabParam(searchParams.get("tab"))]),
  );

  // Active product: either one of the 4 studio specimens OR a visitor-extracted/synthesized custom RGBA plate
  const [selectedSpecimenSlug, setSelectedSpecimenSlug] = useState<string>(
    SPECIMENS[0].slug,
  );
  const [customProduct, setCustomProduct] = useState<CustomProduct | null>(
    null,
  );

  // Studio controls
  const [tier, setTier] = useState<HelioModelTier>("flash");
  const [selectedMarkets, setSelectedMarkets] = useState<string[]>([
    ...SPECIMENS[0].defaultMarkets,
  ]);
  const [customBrief, setCustomBrief] = useState("");
  const [moodRefDataUrl, setMoodRefDataUrl] = useState<string | null>(null);

  // Create / Isolate custom RGBA drawer
  const [plateMode, setPlateMode] = useState<"closed" | "synthesize">("closed");
  const [synthConcept, setSynthConcept] = useState("");
  const [synthName, setSynthName] = useState("");
  const [plateBusy, setPlateBusy] = useState(false);
  const [plateBusyLabel, setPlateBusyLabel] = useState("");

  // Campaign state
  const [shooting, setShooting] = useState(false);
  const [shootPhaseText, setShootPhaseText] = useState("");
  const [shootElapsedMs, setShootElapsedMs] = useState(0);
  const [brief, setBrief] = useState<ArtDirectionBrief | null>(null);
  const [frames, setFrames] = useState<CampaignFrame[]>([]);
  const [selectedMarketId, setSelectedMarketId] = useState<string | null>(null);

  // Director surgical edit & vision audit state
  const [editInstruction, setEditInstruction] = useState("");
  const [editRefDataUrl, setEditRefDataUrl] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [auditing, setAuditing] = useState(false);

  // Optical telemetry (pure code Canvas measurements) + Gateway ledger
  const [activeTelemetry, setActiveTelemetry] =
    useState<OpticalTelemetry | null>(null);
  const [ledger, setLedger] = useState<TelemetryLedgerEntry[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const shootAbortRef = useRef<AbortController | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const moodInputRef = useRef<HTMLInputElement>(null);
  const editRefInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => shootAbortRef.current?.abort();
  }, []);

  const specimen: HelioSpecimen = useMemo(
    () =>
      SPECIMENS.find((s) => s.slug === selectedSpecimenSlug) ?? SPECIMENS[0],
    [selectedSpecimenSlug],
  );

  const activeProductMeta = useMemo(() => {
    if (customProduct) {
      return {
        name: customProduct.name,
        brand: customProduct.brand,
        category: customProduct.category,
        priceTag: customProduct.priceTag,
        imageSrc: customProduct.imageDataUrl,
        accentHex: customProduct.accentHex,
        traditionalShootUsd: 74000,
        traditionalLeadDays: 34,
        traditionalCrewCount: 15,
      };
    }
    return {
      name: specimen.name,
      brand: specimen.brand,
      category: specimen.category,
      priceTag: specimen.priceTag,
      imageSrc: specimen.imageUrl,
      accentHex: specimen.accentHex,
      traditionalShootUsd: specimen.traditionalShootUsd,
      traditionalLeadDays: specimen.traditionalLeadDays,
      traditionalCrewCount: specimen.traditionalCrewCount,
    };
  }, [customProduct, specimen]);

  const productPayload: ProductPayload = useMemo(() => {
    if (customProduct) {
      return {
        kind: "custom",
        name: customProduct.name,
        category: customProduct.category,
        materialNotes: customProduct.materialNotes,
        imageDataUrl: customProduct.imageDataUrl,
      };
    }
    return { kind: "specimen", slug: specimen.slug };
  }, [customProduct, specimen.slug]);

  const logTelemetry = useCallback((entry: TelemetryLedgerEntry) => {
    setLedger((prev) => [entry, ...prev].slice(0, 40));
  }, []);

  function selectTab(next: HelioTab) {
    setTab(next);
    setVisitedTabs((prev) => {
      if (prev.has(next)) return prev;
      const copy = new Set(prev);
      copy.add(next);
      return copy;
    });
    const params = new URLSearchParams(searchParams.toString());
    if (next === "studio") params.delete("tab");
    else params.set("tab", next);
    const qs = params.toString();
    router.replace(qs ? `/demos/helio?${qs}` : "/demos/helio", {
      scroll: false,
    });
  }

  function handleSelectSpecimen(item: HelioSpecimen) {
    if (shooting) return;
    setCustomProduct(null);
    setSelectedSpecimenSlug(item.slug);
    setSelectedMarkets([...item.defaultMarkets]);
    setBrief(null);
    setFrames([]);
    setSelectedMarketId(null);
    setErrorMessage(null);
  }

  function toggleMarket(id: string) {
    if (shooting) return;
    setSelectedMarkets((prev) => {
      if (prev.includes(id)) {
        return prev.length > 1 ? prev.filter((m) => m !== id) : prev;
      }
      if (prev.length >= LIMITS.maxMarketsPerShoot) {
        return [...prev.slice(1), id];
      }
      return [...prev, id];
    });
  }

  async function handleUploadProduct(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || plateBusy) return;
    if (file.size > LIMITS.maxUploadBytes) {
      setErrorMessage("Image exceeds the 6 MB upload limit.");
      return;
    }
    setErrorMessage(null);
    setPlateBusy(true);
    setPlateBusyLabel("MAI 2.7-Flash Isolating Native RGBA Cutout…");
    try {
      const dataUrl = await fileToDataUrl(file);
      const cleanName = file.name.replace(/\.[^.]+$/, "").slice(0, 48);
      const res = await postExtractPlate({
        mode: "isolate",
        imageDataUrl: dataUrl,
        productName: cleanName || "Uploaded Product",
      });
      setCustomProduct({
        name: cleanName || "Custom Studio SKU",
        brand: "CLIENT UPLOAD",
        category: "Extracted RGBA Plate",
        priceTag: "LAUNCH SKU",
        materialNotes: `Client-uploaded product isolated onto transparent RGBA alpha plate (${cleanName}).`,
        imageDataUrl: res.imageDataUrl,
        accentHex: "#1d4e89",
      });
      setBrief(null);
      setFrames([]);
      setSelectedMarketId(null);
      logTelemetry({
        id: `iso-${Date.now()}`,
        timestamp: Date.now(),
        operation: "extract-rgba",
        model: res.model,
        label: `Isolated "${cleanName || "upload"}" to RGBA`,
        latencyMs: res.latencyMs,
        costUsd: res.costUsd,
        meta: "1024×1024 transparent PNG",
      });
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Could not isolate product.",
      );
    } finally {
      setPlateBusy(false);
    }
  }

  async function handleSynthesizeProduct(e: React.FormEvent) {
    e.preventDefault();
    const concept = synthConcept.trim();
    if (!concept || plateBusy) return;
    setErrorMessage(null);
    setPlateBusy(true);
    setPlateBusyLabel("MAI 2.7-Flash Synthesizing Transparent RGBA SKU…");
    try {
      const res = await postExtractPlate({
        mode: "synthesize",
        concept,
        productName: synthName.trim() || undefined,
      });
      const displayName = synthName.trim() || concept.slice(0, 36);
      setCustomProduct({
        name: displayName,
        brand: "CONCEPT PROTOTYPE",
        category: "Synthesized RGBA SKU",
        priceTag: "PROTOTYPE",
        materialNotes: concept,
        imageDataUrl: res.imageDataUrl,
        accentHex: "#d9a84e",
      });
      setPlateMode("closed");
      setBrief(null);
      setFrames([]);
      setSelectedMarketId(null);
      logTelemetry({
        id: `syn-${Date.now()}`,
        timestamp: Date.now(),
        operation: "synthesize-rgba",
        model: res.model,
        label: `Synthesized "${displayName}" RGBA plate`,
        latencyMs: res.latencyMs,
        costUsd: res.costUsd,
        meta: "1024×1024 transparent PNG",
      });
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Could not synthesize product.",
      );
    } finally {
      setPlateBusy(false);
    }
  }

  async function handleShootCampaign() {
    if (shooting || selectedMarkets.length === 0) return;
    shootAbortRef.current?.abort();
    const controller = new AbortController();
    shootAbortRef.current = controller;

    setShooting(true);
    setErrorMessage(null);
    setShootPhaseText("Waking Gemini 4 Neon Creative Director…");
    setShootElapsedMs(0);

    const initialFrames: CampaignFrame[] = selectedMarkets.map((marketId) => ({
      marketId,
      status: "directing",
      versions: [],
      activeVersionIndex: 0,
    }));
    setFrames(initialFrames);
    setSelectedMarketId(selectedMarkets[0] ?? null);

    try {
      await streamCampaignShoot(
        {
          product: productPayload,
          marketIds: selectedMarkets,
          tier,
          customBrief: customBrief.trim() || undefined,
          moodReferenceDataUrl: moodRefDataUrl || undefined,
        },
        (event) => {
          if (event.type === "phase") {
            setShootPhaseText(event.message);
          } else if (event.type === "direction") {
            setBrief(event.brief);
            const dirMap = new Map(
              event.brief.markets.map((m) => [m.marketId, m]),
            );
            setFrames((prev) =>
              prev.map((frame) => ({
                ...frame,
                status: "developing",
                direction: dirMap.get(frame.marketId),
              })),
            );
            logTelemetry({
              id: `dir-${Date.now()}`,
              timestamp: Date.now(),
              operation: "art-direction",
              model: event.brief.model,
              label: `Directed ${event.brief.markets.length} market briefs`,
              latencyMs: event.brief.latencyMs,
              costUsd: event.brief.costUsd,
              meta: `${event.brief.reasoningTokens} thinking tok`,
            });
          } else if (event.type === "frame-ready") {
            setFrames((prev) =>
              prev.map((frame) =>
                frame.marketId === event.marketId
                  ? {
                      ...frame,
                      status: "ready",
                      versions: [event.version],
                      activeVersionIndex: 0,
                    }
                  : frame,
              ),
            );
            // Automatically focus the first completed frame on the Master Light Table
            setSelectedMarketId((cur) => cur ?? event.marketId);
            logTelemetry({
              id: `shot-${event.marketId}-${Date.now()}`,
              timestamp: Date.now(),
              operation: "campaign-shoot",
              model: event.version.model,
              label: `Shot ${event.marketId} flagship set`,
              latencyMs: event.version.latencyMs,
              costUsd: event.version.costUsd,
              meta: "1024×1024 multi-reference",
            });
          } else if (event.type === "frame-error") {
            setFrames((prev) =>
              prev.map((frame) =>
                frame.marketId === event.marketId
                  ? { ...frame, status: "error", error: event.error }
                  : frame,
              ),
            );
          } else if (event.type === "done") {
            setShootElapsedMs(event.totalLatencyMs);
          }
        },
        controller.signal,
      );
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setErrorMessage(
          err instanceof Error ? err.message : "Campaign shoot failed.",
        );
      }
    } finally {
      setShooting(false);
    }
  }

  const activeFrame = useMemo(
    () => frames.find((f) => f.marketId === selectedMarketId) ?? null,
    [frames, selectedMarketId],
  );
  const activeVersion: FrameVersion | null =
    activeFrame?.versions[activeFrame.activeVersionIndex] ?? null;
  const activeMarket = activeFrame ? findMarket(activeFrame.marketId) : null;

  async function handleSurgicalEdit(
    instructionText: string,
    passLabel: string,
  ) {
    if (!activeFrame || !activeVersion || editing) return;
    const trimmed = instructionText.trim();
    if (!trimmed) return;
    setEditing(true);
    setErrorMessage(null);

    try {
      const res = await postSurgicalEdit({
        product: productPayload,
        baseImageDataUrl: activeVersion.imageDataUrl,
        marketId: activeFrame.marketId,
        instruction: trimmed,
        tier,
        referenceImageDataUrl: editRefDataUrl || undefined,
      });

      const nextPassNum = activeFrame.versions.length + 1;
      const newVersion: FrameVersion = {
        id: `${activeFrame.marketId}-v${nextPassNum}-${Date.now()}`,
        label: `Pass ${String(nextPassNum).padStart(2, "0")} · ${passLabel}`,
        imageDataUrl: res.imageDataUrl,
        model: res.model,
        tier,
        latencyMs: res.latencyMs,
        costUsd: res.costUsd,
        instruction: trimmed,
        createdAt: Date.now(),
      };

      setFrames((prev) =>
        prev.map((frame) => {
          if (frame.marketId !== activeFrame.marketId) return frame;
          const nextVersions = [...frame.versions, newVersion].slice(
            -LIMITS.maxVersionHistory,
          );
          return {
            ...frame,
            versions: nextVersions,
            activeVersionIndex: nextVersions.length - 1,
          };
        }),
      );
      setEditInstruction("");
      setEditRefDataUrl(null);
      logTelemetry({
        id: `edit-${Date.now()}`,
        timestamp: Date.now(),
        operation: "surgical-edit",
        model: res.model,
        label: `Edited ${activeFrame.marketId}: ${passLabel}`,
        latencyMs: res.latencyMs,
        costUsd: res.costUsd,
        meta: editRefDataUrl
          ? "3-image multi-ref fusion"
          : "2-image product lock",
      });
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Surgical edit failed.",
      );
    } finally {
      setEditing(false);
    }
  }

  async function handleRunAudit() {
    if (!activeFrame || !activeVersion || auditing) return;
    setAuditing(true);
    setErrorMessage(null);
    try {
      const audit = await postBrandAudit({
        product: productPayload,
        stagedImageDataUrl: activeVersion.imageDataUrl,
        marketId: activeFrame.marketId,
        directionSummary: activeFrame.direction?.lightingSpec,
      });
      setFrames((prev) =>
        prev.map((frame) => {
          if (frame.marketId !== activeFrame.marketId) return frame;
          const nextVersions = frame.versions.map((v, idx) =>
            idx === frame.activeVersionIndex ? { ...v, audit } : v,
          );
          return { ...frame, versions: nextVersions };
        }),
      );
      logTelemetry({
        id: `audit-${Date.now()}`,
        timestamp: Date.now(),
        operation: "brand-audit",
        model: audit.model,
        label: `Audited ${activeFrame.marketId}: ${audit.verdict} (${audit.overallScore})`,
        latencyMs: audit.latencyMs,
        costUsd: audit.costUsd,
        meta: `${audit.pins.length} spatial pins · ${audit.reasoningTokens} tok`,
      });
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Brand audit failed.",
      );
    } finally {
      setAuditing(false);
    }
  }

  const sessionCostUsd = useMemo(
    () => ledger.reduce((sum, e) => sum + e.costUsd, 0),
    [ledger],
  );
  const readyFrameCount = useMemo(
    () => frames.filter((f) => f.status === "ready").length,
    [frames],
  );

  return (
    <div className="flex min-h-dvh flex-col bg-marble text-ink">
      <DemoBar
        slug="helio"
        name="Helio"
        titleAs="h1"
        current={tab}
        panelsId="helio-panel"
        rowFrom="xl"
        badge={<DemoBarBadge>MAI 2.7 + Gemini 4 Neon</DemoBarBadge>}
        tabs={[
          {
            id: "studio",
            label: "Studio",
            onSelect: () => selectTab("studio"),
          },
          {
            id: "placements",
            label:
              readyFrameCount > 0
                ? `Placements (${readyFrameCount})`
                : "Placements",
            onSelect: () => selectTab("placements"),
          },
          {
            id: "compare",
            label: "Flash vs 2.7",
            onSelect: () => selectTab("compare"),
          },
          {
            id: "hood",
            label: "Under the hood",
            onSelect: () => selectTab("hood"),
          },
        ]}
      >
        {/* Model Tier Switcher in the DemoBar */}
        <fieldset
          aria-label="MAI Image 2.7 model tier"
          className="hidden items-center overflow-hidden rounded-sm border-2 border-ink bg-paper sm:flex"
        >
          {(
            [
              ["flash", "Flash · $0.01"],
              ["flagship", "2.7 Pro · $0.034"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTier(id)}
              aria-pressed={tier === id}
              className={`px-2.5 py-1 font-mono text-[10px] font-bold uppercase transition-colors ${
                tier === id
                  ? "bg-ink text-brass"
                  : "bg-paper text-ink hover:bg-limestone"
              }`}
            >
              {label}
            </button>
          ))}
        </fieldset>

        <span
          title="Accumulated real Vercel AI Gateway spend this session"
          className="rounded-sm border-2 border-ink bg-paper px-2.5 py-1 font-mono text-[11px] font-bold text-ink"
        >
          ${sessionCostUsd.toFixed(4)}
        </span>
      </DemoBar>

      <main className="mx-auto w-full max-w-[1440px] flex-1 space-y-5 px-3 py-5 sm:px-5">
        {/* Executive ROI Odometer — always visible hero bar */}
        <ExecutiveRoiBar
          traditionalUsd={activeProductMeta.traditionalShootUsd}
          traditionalDays={activeProductMeta.traditionalLeadDays}
          traditionalCrew={activeProductMeta.traditionalCrewCount}
          aiCostUsd={sessionCostUsd}
          aiElapsedMs={shootElapsedMs}
          readyFrames={readyFrameCount}
        />

        {errorMessage ? (
          <div
            role="alert"
            className="outline-box flex items-center justify-between gap-3 rounded-sm bg-seal-red/10 px-4 py-2.5 font-mono text-xs font-semibold text-seal-red"
          >
            <span>{errorMessage}</span>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              className="font-bold underline"
            >
              Dismiss
            </button>
          </div>
        ) : null}

        {/* TAB 1: STUDIO (kept mounted once visited) */}
        <section
          id="helio-panel-studio"
          hidden={tab !== "studio"}
          className="space-y-5"
        >
          {/* Specimen SKU Shelf + Upload / Synthesize RGBA actions */}
          <div className="outline-box flex flex-wrap items-center justify-between gap-3 rounded-sm bg-paper p-3 shadow-hard-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="eyebrow mr-1 text-[10px] font-bold text-ink-muted">
                Hero SKU:
              </span>
              {SPECIMENS.map((item) => {
                const active =
                  !customProduct && selectedSpecimenSlug === item.slug;
                return (
                  <button
                    key={item.slug}
                    type="button"
                    disabled={shooting || plateBusy}
                    onClick={() => handleSelectSpecimen(item)}
                    className={`flex items-center gap-2 rounded-sm border-2 px-2.5 py-1.5 text-left transition-all ${
                      active
                        ? "border-ink bg-ink text-paper shadow-hard-sm"
                        : "border-ink bg-marble text-ink hover:bg-limestone"
                    }`}
                  >
                    {/* biome-ignore lint/performance/noImgElement: static specimen thumbnail */}
                    <img
                      src={item.imageUrl}
                      alt=""
                      className="size-7 rounded-[2px] border border-ink/20 bg-paper/90 object-contain p-0.5"
                    />
                    <span>
                      <span className="block font-mono text-[9px] font-bold tracking-[0.08em] uppercase opacity-75">
                        {item.code} · {item.priceTag}
                      </span>
                      <span className="block text-xs font-bold leading-tight">
                        {item.name}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={uploadInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleUploadProduct}
                className="hidden"
              />
              <button
                type="button"
                disabled={plateBusy || shooting}
                onClick={() => uploadInputRef.current?.click()}
                className="press rounded-sm border-2 border-ink bg-paper px-3 py-2 font-mono text-[11px] font-bold text-ink uppercase disabled:opacity-55"
              >
                + Upload Photo → RGBA
              </button>
              <button
                type="button"
                disabled={plateBusy || shooting}
                onClick={() =>
                  setPlateMode((m) =>
                    m === "synthesize" ? "closed" : "synthesize",
                  )
                }
                className={`press rounded-sm border-2 border-ink px-3 py-2 font-mono text-[11px] font-bold uppercase disabled:opacity-55 ${
                  plateMode === "synthesize"
                    ? "bg-brass text-ink"
                    : "bg-federal-blue text-paper"
                }`}
              >
                ✦ Invent SKU Plate
              </button>
            </div>
          </div>

          {/* Synthesize Brand-New RGBA SKU Drawer */}
          <AnimatePresence>
            {plateMode === "synthesize" ? (
              <motion.form
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                onSubmit={handleSynthesizeProduct}
                className="outline-box overflow-hidden rounded-sm bg-paper p-4 shadow-hard-md"
              >
                <div className="flex flex-wrap items-end gap-3">
                  <div className="min-w-[180px] flex-1">
                    <label
                      htmlFor="helio-synth-name"
                      className="eyebrow block text-[10px] font-bold text-ink-muted"
                    >
                      Product Name
                    </label>
                    <input
                      id="helio-synth-name"
                      type="text"
                      value={synthName}
                      onChange={(e) => setSynthName(e.target.value)}
                      placeholder="e.g. Aether Acoustic Speaker"
                      maxLength={80}
                      className="mt-1 w-full rounded-sm border-2 border-ink bg-marble px-3 py-2 text-xs font-semibold text-ink"
                    />
                  </div>
                  <div className="min-w-[260px] flex-[2.2]">
                    <label
                      htmlFor="helio-synth-concept"
                      className="eyebrow block text-[10px] font-bold text-ink-muted"
                    >
                      Physical Design Brief (MAI 2.7-Flash generates native
                      transparent RGBA)
                    </label>
                    <input
                      id="helio-synth-concept"
                      type="text"
                      required
                      value={synthConcept}
                      onChange={(e) => setSynthConcept(e.target.value)}
                      placeholder="e.g. Brushed anodized olive aluminum portable Bluetooth speaker with woven linen grille and knurled brass volume dial"
                      maxLength={LIMITS.maxPromptChars}
                      className="mt-1 w-full rounded-sm border-2 border-ink bg-paper px-3 py-2 text-xs text-ink"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={plateBusy || !synthConcept.trim()}
                    aria-busy={plateBusy}
                    className="press rounded-sm border-2 border-ink bg-brass px-4 py-2 font-mono text-xs font-black text-ink uppercase disabled:opacity-55"
                  >
                    {plateBusy ? "Generating…" : "Render RGBA Plate"}
                  </button>
                </div>
              </motion.form>
            ) : null}
          </AnimatePresence>

          {/* Main Asymmetric Two-Column Light Table Layout */}
          <div className="grid items-start gap-5 lg:grid-cols-[420px_1fr]">
            {/* LEFT COLUMN: 3D Interactive RGBA Light Table + Campaign Launcher */}
            <div className="space-y-4">
              <HelioStage3D
                imageSrc={activeProductMeta.imageSrc}
                productName={activeProductMeta.name}
                brand={activeProductMeta.brand}
                category={activeProductMeta.category}
                accentHex={activeProductMeta.accentHex}
                busy={plateBusy}
                busyLabel={plateBusyLabel}
                onTelemetry={activeVersion ? undefined : setActiveTelemetry}
              />

              {/* Multi-Market Campaign Director Control Panel */}
              <div className="outline-box rounded-sm bg-paper p-4 shadow-hard-md">
                <div className="flex items-center justify-between gap-2">
                  <span className="eyebrow font-bold text-federal-blue">
                    02 · Target Markets (Pick up to {LIMITS.maxMarketsPerShoot})
                  </span>
                  <span className="font-mono text-[10px] font-bold text-ink-muted">
                    {selectedMarkets.length}/{LIMITS.maxMarketsPerShoot} SET
                  </span>
                </div>

                <div className="mt-2.5 grid grid-cols-2 gap-2">
                  {MARKETS.map((market) => {
                    const picked = selectedMarkets.includes(market.id);
                    return (
                      <button
                        key={market.id}
                        type="button"
                        disabled={shooting}
                        onClick={() => toggleMarket(market.id)}
                        aria-pressed={picked}
                        className={`flex items-center justify-between gap-1.5 rounded-sm border-2 px-2.5 py-2 text-left transition-all ${
                          picked
                            ? "border-ink bg-ink text-paper shadow-hard-sm"
                            : "border-ink/40 bg-marble text-ink hover:border-ink"
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-bold">
                            {market.city}
                          </span>
                          <span className="block truncate font-mono text-[9px] opacity-75">
                            {market.kelvin}K · {market.lens}
                          </span>
                        </span>
                        <span
                          className="size-3 shrink-0 rounded-[1px] border border-paper/40"
                          style={{ backgroundColor: market.swatchHex }}
                        />
                      </button>
                    );
                  })}
                </div>

                {/* Optional Director Brief + Mood Reference Swatch */}
                <div className="mt-3 space-y-2">
                  <label
                    htmlFor="helio-campaign-brief"
                    className="eyebrow block text-[10px] font-bold text-ink-muted"
                  >
                    Executive Direction (Optional)
                  </label>
                  <input
                    id="helio-campaign-brief"
                    type="text"
                    value={customBrief}
                    onChange={(e) => setCustomBrief(e.target.value)}
                    placeholder="e.g. Autumn launch mood, emphasize brushed brass reflection"
                    maxLength={LIMITS.maxPromptChars}
                    className="w-full rounded-sm border-2 border-ink bg-marble px-3 py-2 text-xs text-ink placeholder:text-ink-muted/70"
                  />

                  <div className="flex items-center justify-between gap-2">
                    <input
                      ref={moodInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (!file) return;
                        if (file.size > LIMITS.maxUploadBytes) {
                          setErrorMessage("Mood reference exceeds 6 MB.");
                          return;
                        }
                        const url = await fileToDataUrl(file);
                        setMoodRefDataUrl(url);
                      }}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => moodInputRef.current?.click()}
                      className="rounded-sm border border-ink bg-paper px-2.5 py-1 font-mono text-[10px] font-bold text-ink uppercase hover:bg-limestone"
                    >
                      {moodRefDataUrl
                        ? "✓ Mood Swatch Attached"
                        : "+ Add 2nd Mood Reference"}
                    </button>
                    {moodRefDataUrl ? (
                      <button
                        type="button"
                        onClick={() => setMoodRefDataUrl(null)}
                        className="font-mono text-[10px] font-bold text-seal-red underline"
                      >
                        Clear
                      </button>
                    ) : null}
                  </div>
                </div>

                {/* Primary Launch Shoot Trigger */}
                <button
                  type="button"
                  disabled={shooting || plateBusy}
                  aria-busy={shooting}
                  onClick={handleShootCampaign}
                  data-testid="helio-shoot-button"
                  className="press mt-4 flex w-full items-center justify-center gap-2 rounded-sm border-2 border-ink bg-brass px-4 py-3 font-mono text-xs font-black tracking-[0.08em] text-ink uppercase disabled:opacity-60"
                >
                  {shooting ? (
                    <>
                      <span className="helio-aperture-orbit inline-block size-4 rounded-full border-2 border-dashed border-ink" />
                      <span>Shooting {selectedMarkets.length} Markets…</span>
                    </>
                  ) : (
                    <span>
                      Shoot {selectedMarkets.length}-Market Global Campaign →
                    </span>
                  )}
                </button>
                <p className="mt-2 text-center font-mono text-[10px] text-ink-muted">
                  Gemini 4 Neon directs → MAI Image 2.7{" "}
                  {tier === "flagship" ? "Pro" : "Flash"} shoots in parallel
                </p>
              </div>
            </div>

            {/* RIGHT COLUMN: Live Art Direction Brief + Contact Sheet + Master Light Table + Surgical Director */}
            <div className="space-y-4">
              {/* Live Neon Creative Director Brief Strip */}
              <AnimatePresence mode="wait">
                {brief || shooting ? (
                  <motion.div
                    key={brief?.campaignTitle || "directing"}
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="outline-box rounded-sm bg-paper p-3.5 shadow-hard-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="eyebrow text-[10px] font-bold text-federal-blue">
                        Gemini 4 Neon · Executive Creative Director
                      </span>
                      {brief ? (
                        <span className="font-mono text-[10px] text-ink-muted">
                          {(brief.latencyMs / 1000).toFixed(1)}s ·{" "}
                          {brief.reasoningTokens} thinking tok · $
                          {brief.costUsd.toFixed(4)}
                        </span>
                      ) : (
                        <span className="font-mono text-[10px] font-bold text-brass uppercase">
                          {shootPhaseText}
                        </span>
                      )}
                    </div>
                    {brief ? (
                      <>
                        <p className="mt-1 text-base font-bold text-ink">
                          {brief.campaignTitle}
                        </p>
                        <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
                          {brief.executiveSummary}
                        </p>
                      </>
                    ) : (
                      <p className="mt-1 font-mono text-xs text-ink-muted">
                        Analyzing material sheen, silhouette geometry, and
                        regional lighting temperatures…
                      </p>
                    )}
                  </motion.div>
                ) : null}
              </AnimatePresence>

              {/* 35mm Contact Sheet Strip */}
              <ContactSheetStrip
                frames={frames}
                selectedMarketId={selectedMarketId}
                onSelectMarket={(id) => setSelectedMarketId(id)}
                onSelectVersion={(mId, idx) => {
                  setFrames((prev) =>
                    prev.map((f) =>
                      f.marketId === mId
                        ? { ...f, activeVersionIndex: idx }
                        : f,
                    ),
                  );
                }}
              />

              {/* Master Director's Light Table OR Cinematic Standby Call-to-Action */}
              {activeFrame && activeVersion && activeMarket ? (
                <>
                  <OpticalCurtainStage
                    originalPlateSrc={activeProductMeta.imageSrc}
                    stagedImageSrc={activeVersion.imageDataUrl}
                    versionKey={activeVersion.id}
                    marketLabel={`${activeMarket.city} · ${activeMarket.label}`}
                    headline={
                      activeFrame.direction?.headline ||
                      activeMarket.defaultHeadline
                    }
                    subcopy={
                      activeFrame.direction?.subcopy ||
                      activeMarket.defaultSubcopy
                    }
                    modelLabel={activeVersion.model}
                    latencyMs={activeVersion.latencyMs}
                    costUsd={activeVersion.costUsd}
                    audit={activeVersion.audit}
                    auditing={auditing}
                    editing={editing}
                    onRunAudit={handleRunAudit}
                    onTelemetry={setActiveTelemetry}
                  />

                  {/* Pure-code Canvas Pixel Telemetry Strip */}
                  <OpticalTelemetryStrip telemetry={activeTelemetry} />

                  {/* Surgical Multi-Reference Retouching & Relighting Console */}
                  <div className="outline-box rounded-sm bg-paper p-4 shadow-hard-md">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="eyebrow text-[10px] font-bold text-federal-blue">
                          03 · Surgical Multi-Reference Director
                        </span>
                        <p className="text-xs text-ink-muted">
                          Relight, localize packaging, or fuse a material
                          reference without losing the hero SKU silhouette.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => selectTab("placements")}
                        className="rounded-sm border border-ink bg-marble px-2.5 py-1 font-mono text-[10px] font-bold text-ink uppercase hover:bg-limestone"
                      >
                        Open Live Placements →
                      </button>
                    </div>

                    {/* One-tap Surgical Director Presets */}
                    <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                      {DIRECTOR_PRESETS.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          disabled={editing || auditing}
                          onClick={() =>
                            handleSurgicalEdit(
                              preset.instruction,
                              preset.shortTag,
                            )
                          }
                          className="press flex flex-col items-start rounded-sm border-2 border-ink bg-marble p-2.5 text-left disabled:opacity-55"
                        >
                          <span className="rounded-[2px] border border-ink bg-paper px-1.5 py-0.5 font-mono text-[9px] font-bold text-federal-blue uppercase">
                            {preset.kelvinLabel}
                          </span>
                          <span className="mt-1.5 text-xs font-bold text-ink">
                            {preset.label}
                          </span>
                        </button>
                      ))}
                    </div>

                    {/* Freeform Surgical Edit + Optional 3rd Reference Image Fusion */}
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleSurgicalEdit(editInstruction, "Director Edit");
                      }}
                      className="mt-3 flex flex-wrap items-center gap-2"
                    >
                      <input
                        type="text"
                        value={editInstruction}
                        onChange={(e) => setEditInstruction(e.target.value)}
                        placeholder="Custom surgical note: e.g. 'Add espresso steam curling up from the spout and place a folded linen napkin to the left'"
                        maxLength={LIMITS.maxPromptChars}
                        className="min-w-[240px] flex-1 rounded-sm border-2 border-ink bg-paper px-3 py-2 text-xs text-ink placeholder:text-ink-muted/70"
                      />
                      <input
                        ref={editRefInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (!file) return;
                          const url = await fileToDataUrl(file);
                          setEditRefDataUrl(url);
                        }}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => editRefInputRef.current?.click()}
                        className="rounded-sm border-2 border-ink bg-marble px-2.5 py-2 font-mono text-[10px] font-bold text-ink uppercase hover:bg-limestone"
                      >
                        {editRefDataUrl ? "✓ Ref Added" : "+ Ref Image"}
                      </button>
                      <button
                        type="submit"
                        disabled={editing || !editInstruction.trim()}
                        aria-busy={editing}
                        className="press rounded-sm border-2 border-ink bg-ink px-4 py-2 font-mono text-xs font-bold text-paper uppercase disabled:opacity-55"
                      >
                        {editing ? "Applying…" : "Apply Edit"}
                      </button>
                    </form>
                  </div>
                </>
              ) : (
                <>
                  {/* Architectural Darkroom Ready Stage before first shoot */}
                  <div className="outline-box helio-darkroom-grid relative overflow-hidden rounded-sm p-6 text-paper shadow-hard-md sm:p-8">
                    <div className="relative z-10 max-w-xl space-y-4">
                      <span className="inline-block rounded-sm border border-brass bg-brass/15 px-2.5 py-1 font-mono text-[10px] font-bold tracking-[0.12em] text-brass uppercase">
                        Nov 17–18, 2026 · MAI Image 2.7 + Gemini 4 Neon
                      </span>
                      <h2 className="text-2xl font-black leading-tight tracking-tight sm:text-3xl">
                        One transparent product plate. Three global flagships.
                        Fifteen seconds.
                      </h2>
                      <p className="text-sm leading-relaxed text-paper/75">
                        Move your pointer over the floating RGBA plate on the
                        left — or flip <strong>Alpha X-Ray</strong> — to inspect
                        native alpha-channel isolation from{" "}
                        <strong>Microsoft MAI Image 2.7-Flash</strong>. Then hit{" "}
                        <strong>Shoot 3-Market Global Campaign</strong> to watch{" "}
                        <strong>Google Gemini 4 Neon</strong> write regional
                        lighting briefs and shoot all three sets in parallel
                        with physically coherent shadows and reflections.
                      </p>

                      <div className="grid gap-3 pt-2 sm:grid-cols-3">
                        {[
                          {
                            k: "01",
                            t: "Native RGBA Layers",
                            d: "True PNG alpha cutouts you can tilt, X-ray, and drop into any layout.",
                          },
                          {
                            k: "02",
                            t: "Multi-Ref Relighting",
                            d: "Exact SKU silhouette locks across Tokyo basalt, Milan stone & Manila sun.",
                          },
                          {
                            k: "03",
                            t: "Vision + Code Audit",
                            d: "Neon pins geometry & lighting fidelity while Canvas scores pixels.",
                          },
                        ].map((card) => (
                          <div
                            key={card.k}
                            className="rounded-sm border border-paper/20 bg-[#131e36]/85 p-3"
                          >
                            <span className="font-mono text-[10px] font-bold text-brass">
                              {card.k}
                            </span>
                            <p className="mt-1 text-xs font-bold text-paper">
                              {card.t}
                            </p>
                            <p className="mt-1 text-[11px] leading-relaxed text-paper/65">
                              {card.d}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Pure-code Canvas Pixel Telemetry for the active RGBA specimen plate */}
                  <OpticalTelemetryStrip telemetry={activeTelemetry} />
                </>
              )}
            </div>
          </div>
        </section>

        {/* TAB 2: PLACEMENTS */}
        {visitedTabs.has("placements") ? (
          <section id="helio-panel-placements" hidden={tab !== "placements"}>
            <PlacementsWall
              productName={activeProductMeta.name}
              brand={activeProductMeta.brand}
              priceTag={activeProductMeta.priceTag}
              originalPlateSrc={activeProductMeta.imageSrc}
              frames={frames}
              telemetry={activeTelemetry}
              onJumpToStudio={() => selectTab("studio")}
            />
          </section>
        ) : null}

        {/* TAB 3: COMPARE FLASH VS FLAGSHIP 2.7 */}
        {visitedTabs.has("compare") ? (
          <section id="helio-panel-compare" hidden={tab !== "compare"}>
            <CompareShootout
              product={productPayload}
              productName={activeProductMeta.name}
              onLogTelemetry={logTelemetry}
            />
          </section>
        ) : null}

        {/* TAB 4: UNDER THE HOOD */}
        {visitedTabs.has("hood") ? (
          <section id="helio-panel-hood" hidden={tab !== "hood"}>
            <UnderTheHoodPanel ledger={ledger} />
          </section>
        ) : null}
      </main>
    </div>
  );
}
