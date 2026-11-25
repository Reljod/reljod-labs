"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DemoBar } from "@/components/demo/demo-bar";
import { Badge, Button, cx, Panel } from "@/features/harness/components/ui";
import { answerKeyFor } from "../domain/answer-key";
import type { Allowance, AskAnswer, Moment, Source } from "../domain/api";
import { LIMITS, VIDEO_TYPES } from "../domain/limits";
import { defaultStandard, type Standard } from "../domain/rules";
import { SITES, type Site } from "../domain/sites";
import { scoreWalk } from "../domain/walk";
import { prepareUpload } from "../server/actions";
import { getAllowance, putFile } from "./api";
import { AskFootage } from "./ask";
import { AnswerKeyCard, FindingCard, ScoreCard, WalkMeta } from "./findings";
import { paintFrame } from "./frames";
import { HoodTab } from "./hood";
import { SEVERITY_COLOR, severityOf } from "./look";
import { FloorPlan } from "./plan";
import { Stage } from "./stage";
import { StandardTab } from "./standard";
import { Timeline } from "./timeline";
import { type Footage, useWalk } from "./use-walk";
import "./floorwalk.css";

type Tab = "walk" | "standard" | "hood";

const SUGGESTIONS: Record<string, string[]> = {
  "cold-store": [
    "Was everyone wearing hi-vis?",
    "Which doors were open?",
    "Where was the forklift?",
  ],
  grocer: [
    "Which shelves need restocking?",
    "Was any chiller door open?",
    "Is the fire exit clear?",
  ],
  upload: [
    "What is the biggest risk here?",
    "Is anything blocking an exit?",
    "Is anyone working unsafely?",
  ],
};

const sampleFootage = (site: Site): Footage => ({
  kind: "sample",
  site,
  src: `/floorwalk/samples/${site.slug}.mp4`,
  poster: `/floorwalk/samples/${site.slug}.jpg`,
});

export function Floorwalk({
  initialAllowance,
}: {
  initialAllowance: Allowance | null;
}) {
  const [tab, setTab] = useState<Tab>("walk");
  const [allowance, setAllowance] = useState(initialAllowance);
  const refreshAllowance = useCallback(() => {
    void getAllowance().then((a) => a && setAllowance(a));
  }, []);
  const { state, replay, live, reset } = useWalk(refreshAllowance);
  const [footage, setFootage] = useState<Footage | null>(null);
  const [standard, setStandard] = useState<Standard>(() => defaultStandard());
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const [answer, setAnswer] = useState<AskAnswer | null>(null);
  const [captured, setCaptured] = useState<Record<string, string>>({});
  const [upload, setUpload] = useState<{
    share: number;
    error: string | null;
  } | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const objectUrl = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const playedBack = useRef(-1);

  useEffect(
    () => () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    },
    [],
  );

  const site = footage?.kind === "sample" ? footage.site : null;
  const source: Source | null = footage
    ? footage.kind === "sample"
      ? { kind: "sample", slug: footage.site.slug }
      : { kind: "upload", path: footage.path }
    : null;
  const scored = useMemo(
    () => scoreWalk(state.findings, standard),
    [state.findings, standard],
  );
  const countedIds = new Set(scored.counted.map((c) => c.finding.id));
  const ordered =
    state.phase === "done"
      ? [...scored.counted.map((c) => c.finding), ...scored.ignored]
      : state.findings;
  const answerKey = site ? answerKeyFor(site.slug) : null;
  const seconds =
    state.seconds || videoRef.current?.duration || answerKey?.seconds || 0;
  const watching = state.phase === "loading" || state.phase === "walking";
  const walksLeft = allowance
    ? Math.max(0, allowance.walksPerHour - allowance.walksUsed)
    : null;
  const moments: Moment[] = answer?.moments ?? [];

  const seek = useCallback((t: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = t;
    setTime(t);
    void v.play().catch(() => {});
  }, []);

  // As the playhead passes a Finding, take its thumbnail from the video on
  // screen: it is decoded already, where a hidden seek may not be.
  const onTime = (t: number) => {
    setTime(t);
    const v = videoRef.current;
    if (!v) return;
    for (const finding of state.findings) {
      if (captured[finding.id] || Math.abs(t - finding.at) > 0.35) continue;
      const url = paintFrame(
        v,
        finding.box,
        SEVERITY_COLOR[severityOf(finding, standard)],
      );
      if (url) setCaptured((all) => ({ ...all, [finding.id]: url }));
    }
  };

  const begin = (next: Footage, how: "replay" | "live") => {
    setFootage(next);
    setAnswer(null);
    setCaptured({});
    setFocus(null);
    setTime(0);
    setStandard(
      defaultStandard(next.kind === "sample" ? next.site.kind : undefined),
    );
    playedBack.current = -1;
    setTab("walk");
    if (how === "replay" && next.kind === "sample") void replay(next.site.slug);
    else
      void live(
        next.kind === "sample"
          ? { kind: "sample", slug: next.site.slug }
          : { kind: "upload", path: next.path },
      );
    // Play the footage while the Walker watches it.
    window.setTimeout(() => {
      const v = videoRef.current;
      if (v) {
        v.currentTime = 0;
        void v.play().catch(() => {});
      }
    }, 150);
  };

  // Once the Walk is in, play the footage back from the start with every Finding on it.
  useEffect(() => {
    if (
      state.phase !== "done" ||
      playedBack.current === state.runId ||
      !state.findings.length
    )
      return;
    playedBack.current = state.runId;
    const id = window.setTimeout(() => seek(0), 1400);
    return () => window.clearTimeout(id);
  }, [state.phase, state.runId, state.findings.length, seek]);

  const takeFile = async (file: File | undefined) => {
    // One upload at a time; a second drop waits for the first to finish.
    if (!file || (upload && !upload.error)) return;
    if (!(VIDEO_TYPES as readonly string[]).includes(file.type)) {
      setUpload({ share: 0, error: "Upload an MP4 or MOV video." });
      return;
    }
    if (file.size > LIMITS.uploadBytes) {
      setUpload({ share: 0, error: "That file is over 25 MB." });
      return;
    }
    setUpload({ share: 0, error: null });
    const ticket = await prepareUpload({ type: file.type, size: file.size });
    if (!ticket.ok) {
      setUpload({ share: 0, error: ticket.error });
      return;
    }
    try {
      await putFile(ticket.value.signedUrl, file, (share) =>
        setUpload({ share, error: null }),
      );
    } catch (error) {
      setUpload({
        share: 0,
        error: error instanceof Error ? error.message : "The upload failed.",
      });
      return;
    }
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = URL.createObjectURL(file);
    setUpload(null);
    begin(
      {
        kind: "upload",
        path: ticket.value.path,
        src: objectUrl.current,
        name: file.name.slice(0, 60),
      },
      "live",
    );
  };

  const tabs = [
    {
      id: "walk",
      label: "Walk",
      testId: "floorwalk-tab-walk",
      onSelect: () => setTab("walk"),
    },
    {
      id: "standard",
      label: "Standard",
      testId: "floorwalk-tab-standard",
      onSelect: () => setTab("standard"),
    },
    {
      id: "hood",
      label: "Under the hood",
      testId: "floorwalk-tab-hood",
      onSelect: () => setTab("hood"),
    },
  ];

  return (
    <div className="min-h-dvh bg-marble text-ink">
      <DemoBar
        slug="floorwalk"
        name="Floorwalk"
        tabs={tabs}
        current={tab}
        panelsId="floorwalk"
        titleAs="h1"
      >
        {walksLeft !== null ? (
          <Badge
            tone={walksLeft ? "blue" : "red"}
            title="Live Walks call the model; replays are free"
          >
            {walksLeft}/{allowance?.walksPerHour} live walks left
          </Badge>
        ) : null}
      </DemoBar>

      <main className="mx-auto max-w-[1500px] px-3 py-4 sm:px-5">
        <div
          id="floorwalk-panel-walk"
          role="tabpanel"
          aria-labelledby="floorwalk-tab-walk"
          hidden={tab !== "walk"}
        >
          <Picker
            footage={footage}
            busy={watching}
            walksLeft={walksLeft}
            upload={upload}
            onReplay={(s) => begin(sampleFootage(s), "replay")}
            onLive={(s) => begin(sampleFootage(s), "live")}
            onUpload={() => fileInput.current?.click()}
            onDrop={(file) => void takeFile(file)}
          />
          <input
            ref={fileInput}
            type="file"
            accept={VIDEO_TYPES.join(",")}
            className="hidden"
            onChange={(e) => {
              void takeFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />

          {footage ? (
            <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_25rem]">
              <div className="min-w-0 space-y-3">
                <Stage
                  videoRef={videoRef}
                  src={footage.src}
                  poster={
                    footage.kind === "sample" ? footage.poster : undefined
                  }
                  time={time}
                  watching={watching}
                  readHead={state.readHead}
                  seconds={seconds}
                  findings={state.findings}
                  noticed={state.noticed}
                  moments={moments}
                  standard={standard}
                  onTime={onTime}
                  onPlaying={setPlaying}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      const v = videoRef.current;
                      if (!v) return;
                      if (v.paused) void v.play().catch(() => {});
                      else v.pause();
                    }}
                  >
                    {playing ? "❚❚ Pause" : "▶ Play"}
                  </Button>
                  <StatusLine state={state} />
                </div>
                <Timeline
                  seconds={seconds}
                  time={time}
                  readHead={state.readHead}
                  showReadHead={watching}
                  zones={state.zones}
                  findings={state.findings}
                  noticed={state.noticed}
                  moments={moments}
                  standard={standard}
                  onSeek={seek}
                />
                {state.error ? (
                  <p
                    role="alert"
                    className="rounded-sm border-2 border-seal-red bg-seal-red/10 px-3 py-2 text-sm text-seal-red"
                  >
                    {state.error}
                  </p>
                ) : null}
                <Panel
                  title="Findings"
                  eyebrow={
                    state.findings.length
                      ? `${state.findings.length} from this Walk`
                      : "As the Walker reports them"
                  }
                  bodyClassName="p-3"
                >
                  {ordered.length ? (
                    <ul className="grid gap-2 md:grid-cols-2">
                      <AnimatePresence>
                        {ordered.map((finding) => (
                          <FindingCard
                            key={finding.id}
                            finding={finding}
                            index={state.findings.findIndex(
                              (f) => f.id === finding.id,
                            )}
                            src={footage.src}
                            standard={standard}
                            clockStart={site?.clock}
                            captured={captured[finding.id] ?? null}
                            counted={countedIds.has(finding.id)}
                            onSeek={(t) => {
                              setFocus(finding.id);
                              seek(t);
                            }}
                          />
                        ))}
                      </AnimatePresence>
                    </ul>
                  ) : (
                    <EmptyFindings state={state} />
                  )}
                  {state.noticed.length ? (
                    <div className="mt-3 border-ink/20 border-t-2 pt-2">
                      <p className="eyebrow text-[10px] text-ink-muted">
                        Noticed, but no Rule covers it
                      </p>
                      <ul className="mt-1 space-y-1 text-sm">
                        {state.noticed.map((n) => (
                          <li key={n.id}>
                            <button
                              type="button"
                              className="hover:underline"
                              onClick={() => seek(Math.max(0, n.at - 0.5))}
                            >
                              ▶ {n.saw}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </Panel>
              </div>

              <aside className="space-y-4">
                <Panel
                  title={
                    site?.name ??
                    (footage.kind === "upload" ? footage.name : "")
                  }
                  eyebrow={site ? "Floor plan" : "Your footage"}
                  bodyClassName="p-2"
                >
                  {site ? (
                    <div className="aspect-[3/2]">
                      <FloorPlan
                        site={site}
                        time={time}
                        zonesSeen={state.zones.map((z) => z.zone)}
                        findings={scored.counted.map((c) => c.finding)}
                        standard={standard}
                        focus={focus}
                        numberOf={(id) =>
                          state.findings.findIndex((f) => f.id === id) + 1
                        }
                        onPick={(f) => {
                          setFocus(f.id);
                          seek(Math.max(0, f.at - 0.6));
                        }}
                      />
                    </div>
                  ) : (
                    <ZoneSteps zones={state.zones} time={time} />
                  )}
                </Panel>
                <Panel
                  title="Fit to open?"
                  eyebrow="Scored by code from the Standard"
                  bodyClassName="p-4"
                >
                  <ScoreCard
                    scored={scored}
                    state={state}
                    findingsCount={state.findings.length}
                  />
                  <div className="mt-3">
                    <WalkMeta state={state} />
                  </div>
                </Panel>
                {answerKey && state.phase === "done" ? (
                  <Panel
                    title="Checked against the answer key"
                    eyebrow="Planted in the footage on purpose"
                    bodyClassName="p-4"
                  >
                    <AnswerKeyCard
                      answerKey={answerKey}
                      findings={state.findings}
                      onSeek={seek}
                    />
                  </Panel>
                ) : null}
                {source ? (
                  <Panel
                    title="Ask the footage"
                    eyebrow="One more look, with moments to jump to"
                    bodyClassName="p-4"
                  >
                    <AskFootage
                      key={footage.src}
                      source={source}
                      suggestions={SUGGESTIONS[site?.slug ?? "upload"] ?? []}
                      onAnswer={setAnswer}
                      onAsked={refreshAllowance}
                      onSeek={seek}
                      disabled={watching}
                    />
                  </Panel>
                ) : null}
              </aside>
            </div>
          ) : null}
        </div>

        <div
          id="floorwalk-panel-standard"
          role="tabpanel"
          aria-labelledby="floorwalk-tab-standard"
          hidden={tab !== "standard"}
        >
          <StandardTab
            standard={standard}
            onChange={setStandard}
            onReset={() => setStandard(defaultStandard(site?.kind))}
            scored={state.findings.length ? scored : null}
            hasWalk={state.phase === "done"}
            kind={site?.kind ?? null}
          />
        </div>
        <div
          id="floorwalk-panel-hood"
          role="tabpanel"
          aria-labelledby="floorwalk-tab-hood"
          hidden={tab !== "hood"}
        >
          <HoodTab state={state} site={site} />
        </div>
        {footage ? (
          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() => {
                reset();
                setFootage(null);
              }}
              className="font-mono text-[11px] text-ink-muted uppercase hover:text-ink"
            >
              Start over
            </button>
          </div>
        ) : null}
      </main>
    </div>
  );
}

function StatusLine({ state }: { state: ReturnType<typeof useWalk>["state"] }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (state.phase !== "loading" && state.phase !== "walking") return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [state.phase]);
  const elapsed = state.startedAt
    ? Math.max(0, (now - state.startedAt) / 1000)
    : 0;
  const words =
    state.phase === "loading"
      ? "Sending the footage"
      : state.phase === "walking"
        ? state.findings.length
          ? `${state.findings.length} found so far · ${elapsed.toFixed(0)} s`
          : `Watching the whole walk · ${elapsed.toFixed(0)} s`
        : state.phase === "done"
          ? `Done · ${state.findings.length} Findings, playing back`
          : state.phase === "error"
            ? "Stopped"
            : "";
  return (
    <span
      className="font-mono text-[11px] text-ink-muted uppercase"
      aria-live="polite"
      data-testid="floorwalk-status"
    >
      {state.mode === "replay" && state.phase !== "idle" ? (
        <Badge tone="amber" className="mr-2">
          Recorded
        </Badge>
      ) : null}
      {state.mode === "live" && state.phase !== "idle" ? (
        <Badge tone="green" className="mr-2" dot={state.phase === "walking"}>
          Live
        </Badge>
      ) : null}
      {words}
    </span>
  );
}

function EmptyFindings({
  state,
}: {
  state: ReturnType<typeof useWalk>["state"];
}) {
  if (state.phase === "done")
    return <p className="text-sm">Nothing broke a Rule on this walk.</p>;
  return (
    <div className="fw-filmstrip flex h-20 items-center justify-center rounded-sm border-2 border-ink/30 border-dashed text-sm text-ink-muted">
      The Walker reports each problem the moment it is sure of it.
    </div>
  );
}

function ZoneSteps({
  zones,
  time,
}: {
  zones: { at: number; zone: string }[];
  time: number;
}) {
  if (!zones.length)
    return (
      <p className="p-3 text-sm text-ink-muted">
        The areas the Walker names will line up here.
      </p>
    );
  return (
    <ol className="flex flex-wrap gap-1.5 p-2">
      {zones.map((z, i) => {
        const current =
          time >= z.at && time < (zones[i + 1]?.at ?? Number.POSITIVE_INFINITY);
        return (
          <motion.li
            key={`${z.at}-${z.zone}`}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            className={cx(
              "rounded-sm border-2 border-ink px-2 py-1 font-mono text-[11px] font-bold uppercase",
              current ? "bg-federal-blue text-paper" : "bg-paper",
            )}
          >
            {z.zone}
          </motion.li>
        );
      })}
    </ol>
  );
}

/** The Samples as index cards whose footage plays on hover, and a drop zone for your own. */
function Picker({
  footage,
  busy,
  walksLeft,
  upload,
  onReplay,
  onLive,
  onUpload,
  onDrop,
}: {
  footage: Footage | null;
  busy: boolean;
  walksLeft: number | null;
  upload: { share: number; error: string | null } | null;
  onReplay: (site: Site) => void;
  onLive: (site: Site) => void;
  onUpload: () => void;
  onDrop: (file: File | undefined) => void;
}) {
  const compact = footage !== null;
  const [over, setOver] = useState(false);
  return (
    <section aria-label="Pick a walk">
      {!compact ? (
        <div className="mb-4 max-w-3xl">
          <p className="eyebrow text-[11px] text-ink-muted">
            Gemini 4 Neon · watches video · 18 Nov 2026
          </p>
          <h2 className="mt-1 font-mono text-2xl font-black tracking-tight uppercase sm:text-3xl">
            Walk the floor once. The audit is done before you reach the door.
          </h2>
        </div>
      ) : null}
      <div
        className={cx(
          "grid gap-3",
          compact ? "sm:grid-cols-3" : "md:grid-cols-3",
        )}
      >
        {SITES.map((site) => {
          const selected =
            footage?.kind === "sample" && footage.site.slug === site.slug;
          return (
            <article
              key={site.slug}
              className={cx(
                "outline-box group overflow-hidden rounded-sm bg-paper",
                selected && "ring-4 ring-federal-blue/40",
              )}
              data-testid={`floorwalk-sample-${site.slug}`}
            >
              {!compact ? <HoverClip site={site} /> : null}
              <div className="p-3">
                <p className="eyebrow text-[10px] text-ink-muted">
                  {site.kind === "warehouse" ? "Warehouse" : "Retail"} ·{" "}
                  {site.place.split(" · ")[0]}
                </p>
                <h3 className="font-mono text-sm font-bold uppercase">
                  {site.name}
                </h3>
                {!compact ? <p className="mt-1 text-sm">{site.blurb}</p> : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={busy}
                    onClick={() => onReplay(site)}
                  >
                    ▶ Watch it walk
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy || walksLeft === 0}
                    onClick={() => onLive(site)}
                    title="Calls the model now (about 4 cents)"
                  >
                    Walk it live
                  </Button>
                </div>
              </div>
            </article>
          );
        })}
        <button
          type="button"
          onClick={onUpload}
          disabled={busy || walksLeft === 0}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            onDrop(e.dataTransfer.files[0]);
          }}
          className={cx(
            "press flex flex-col items-center justify-center gap-2 rounded-sm border-2 border-ink border-dashed p-4 text-center disabled:opacity-50",
            over ? "bg-morning-haze" : "bg-paper/60",
          )}
          data-testid="floorwalk-upload"
        >
          <span className="text-3xl" aria-hidden="true">
            ⬆
          </span>
          <span className="font-mono text-sm font-bold uppercase">
            Walk your own footage
          </span>
          <span className="text-[12px] text-ink-muted">
            An MP4 or MOV up to {LIMITS.uploadSeconds} s and 25 MB. Kept
            private, and cleared about {LIMITS.uploadHours} hours later.
          </span>
          {upload && !upload.error ? (
            <span className="mt-1 h-2 w-full overflow-hidden rounded-sm border border-ink bg-paper">
              <span
                className="block h-full bg-federal-blue transition-[width]"
                style={{ width: `${Math.round(upload.share * 100)}%` }}
              />
            </span>
          ) : null}
          {upload?.error ? (
            <span role="alert" className="text-[12px] text-seal-red">
              {upload.error}
            </span>
          ) : null}
        </button>
      </div>
    </section>
  );
}

function HoverClip({ site }: { site: Site }) {
  const ref = useRef<HTMLVideoElement>(null);
  return (
    <div
      className="relative aspect-video overflow-hidden border-ink border-b-2 bg-ink"
      onPointerEnter={() => void ref.current?.play().catch(() => {})}
      onPointerLeave={() => ref.current?.pause()}
    >
      <video
        ref={ref}
        src={`/floorwalk/samples/${site.slug}.mp4`}
        poster={`/floorwalk/samples/${site.slug}.jpg`}
        muted
        loop
        playsInline
        preload="none"
        className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
      />
      <span className="absolute bottom-2 left-2 rounded-sm bg-ink/80 px-1.5 py-0.5 font-mono text-[10px] text-paper">
        {site.planted.filter((p) => !p.decoy).length} problems hidden ·{" "}
        {site.planted.filter((p) => p.decoy).length} decoys
      </span>
    </div>
  );
}
