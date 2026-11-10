"use client";

import { LayoutGroup, motion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CatPose } from "@/features/ledger/components/cat";
import type { ChatEvent } from "../domain/chat-events";
import { JOBS, type JobId } from "../domain/jobs";
import type { ModelSettingsByPurpose } from "../domain/model-config";
import { PIPELINE_IDS, PIPELINES } from "../domain/pipelines";
import type { Answer } from "../domain/run-events";
import {
  answer,
  getSpend,
  newDesk,
  openDesk,
  uploadDocuments,
} from "../server/actions";
import type { DeskView, DocView, SpendView } from "../view";
import { Cabinet } from "./cabinet";
import "./casework.css";
import { type CatCue, CatLayer } from "./cat-layer";
import { type ChatItem, ChatPanel } from "./chat-panel";
import { DecisionFile, DocViewer } from "./doc-viewer";
import { JobGlyph, RECOMMENDATION_STYLE } from "./glyphs";
import { prepareUpload } from "./prepare-upload";
import { SettingsDrawer } from "./settings-drawer";
import { Stage } from "./stage";
import { Terminal, type TerminalLine } from "./terminal";
import { useRun } from "./use-run";

const JOB_POSE: Record<JobId, CatPose> = {
  sort: "search",
  read: "search",
  match_identity: "think",
  check_eligibility: "think",
  verify_payee: "search",
  screen: "search",
  adjudicate: "think",
  verify_entity: "search",
  check_census: "search",
  reconcile: "conduct",
  map_ownership: "unstitch",
  rate_risk: "think",
  decide: "stamp",
};

const JOB_LINE: Partial<Record<JobId, string>> = {
  sort: "Sorting the pile",
  read: "Reading every page",
  match_identity: "Is it really them?",
  check_eligibility: "Checking the Act",
  verify_payee: "Following the money",
  screen: "Checking the lists",
  adjudicate: "Weighing the hits",
  verify_entity: "Company papers",
  check_census: "Counting heads",
  reconcile: "Balancing the books",
  map_ownership: "Unwinding it",
  rate_risk: "Rating the risk",
  decide: "Writing it up",
};

function toItems(desk: DeskView, docs: Map<string, DocView>): ChatItem[] {
  return desk.messages.map((message) => ({
    id: `m${message.id}`,
    role: message.role,
    text: message.text,
    documentNames: message.documentIds.flatMap(
      (id) => docs.get(id)?.name ?? [],
    ),
    tools: message.tools.map((name) => ({ name })),
  }));
}

/** The Casework desk: Cabinet, the Specialist's chat, and the stage where runs play out. */
export function Desk() {
  const [desk, setDesk] = useState<DeskView | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [tray, setTray] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [talking, setTalking] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [cabinetOpen, setCabinetOpen] = useState(false);
  const [mobileCabinet, setMobileCabinet] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const [fileOpen, setFileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<ModelSettingsByPurpose | null>(null);
  const [spend, setSpend] = useState<SpendView>({ totalUsd: 0, rows: [] });
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [chatLines, setChatLines] = useState<TerminalLine[]>([]);
  const [uploading, setUploading] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [greeted, setGreeted] = useState(false);
  const run = useRun(runId);

  const load = useCallback(async () => {
    try {
      const view = await openDesk();
      setDesk(view);
      setSettings(view.settings);
      setSpend(view.spend);
      const map = new Map(
        [
          ...view.folders.flatMap((folder) => folder.documents),
          ...view.uploads,
        ].map((doc) => [doc.id, doc]),
      );
      setItems((current) =>
        current.some((item) => item.pending) ? current : toItems(view, map),
      );
      const live =
        view.runs.find(
          (item) => item.status === "running" || item.status === "waiting",
        ) ?? view.runs[0];
      setRunId(live?.id ?? null);
    } catch (error) {
      setFailed(
        error instanceof Error ? error.message : "The desk could not open.",
      );
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setTimeout(() => setGreeted(true), 2600);
    return () => clearTimeout(timer);
  }, [load]);

  const docs = useMemo(() => {
    if (!desk) return new Map<string, DocView>();
    return new Map(
      [
        ...desk.folders.flatMap((folder) => folder.documents),
        ...desk.uploads,
      ].map((doc) => [doc.id, doc]),
    );
  }, [desk]);
  const trayDocs = tray.flatMap((id) => docs.get(id) ?? []);

  // Spend catches up whenever a run reaches a resting point.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh on status changes only
  useEffect(() => {
    if (run.status !== "running") void getSpend().then(setSpend);
  }, [run.status, run.decision]);

  const terminal: TerminalLine[] = useMemo(
    () =>
      [
        ...chatLines,
        ...run.logs.map((log) => ({
          ...log,
          level:
            log.text.includes("$0.") && log.text.startsWith("  ")
              ? ("cost" as const)
              : log.level,
        })),
      ].sort((a, b) => a.at - b.at),
    [chatLines, run.logs],
  );

  const log = (level: TerminalLine["level"], text: string) =>
    setChatLines((lines) =>
      [...lines, { at: Date.now(), level, text }].slice(-200),
    );

  function addToTray(ids: string[]) {
    setTray((current) => [...new Set([...current, ...ids])].slice(0, 12));
  }

  async function send(text: string) {
    const documentIds = tray;
    const names = documentIds.flatMap((id) => docs.get(id)?.name ?? []);
    const pendingId = `p${Date.now()}`;
    setItems((current) => [
      ...current,
      {
        id: `u${Date.now()}`,
        role: "user",
        text,
        documentNames: names,
        tools: [],
      },
      {
        id: pendingId,
        role: "specialist",
        text: "",
        documentNames: [],
        tools: [],
        pending: true,
      },
    ]);
    setTray([]);
    setBusy(true);
    log(
      "mcp",
      `chat → "${text || "(documents)"}" with ${documentIds.length} document${documentIds.length === 1 ? "" : "s"}`,
    );
    const patch = (fn: (item: ChatItem) => ChatItem) =>
      setItems((current) =>
        current.map((item) => (item.id === pendingId ? fn(item) : item)),
      );
    try {
      const response = await fetch("/api/casework/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, documentIds }),
      });
      if (!response.body) throw new Error("No response");
      const reader = response.body
        .pipeThrough(new TextDecoderStream())
        .getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as ChatEvent;
          if (event.type === "delta") {
            setTalking(true);
            patch((item) => ({ ...item, text: item.text + event.text }));
          } else if (event.type === "tool") {
            patch((item) => ({
              ...item,
              tools: [...item.tools, { name: event.name }],
            }));
            log(
              "mcp",
              `mcp → tools/call ${event.name} ${JSON.stringify(event.input).slice(0, 140)}`,
            );
          } else if (event.type === "tool-result") {
            patch((item) => ({
              ...item,
              tools: item.tools.map((tool, index, all) =>
                index ===
                all.findLastIndex((entry) => entry.name === event.name)
                  ? { ...tool, ok: event.ok }
                  : tool,
              ),
            }));
            log(
              event.ok ? "mcp" : "error",
              `mcp ← ${event.name}: ${event.summary.slice(0, 160)}`,
            );
            if (event.runId) setRunId(event.runId);
          } else if (event.type === "cost") {
            log(
              "cost",
              `  chat · ${event.model} · $${event.costUsd.toFixed(4)}`,
            );
          } else if (event.type === "error") {
            patch((item) => ({ ...item, text: event.message }));
            log("error", event.message);
          }
        }
      }
    } catch (error) {
      patch((item) => ({
        ...item,
        text: error instanceof Error ? error.message : "Something went wrong",
      }));
    } finally {
      patch((item) => ({
        ...item,
        pending: false,
        text: item.text || (item.tools.length ? "" : "…"),
      }));
      setBusy(false);
      setTalking(false);
      void getSpend().then(setSpend);
    }
  }

  async function reply(value: Answer) {
    if (!run.question) return;
    setAnswering(true);
    const names =
      value.documentIds?.flatMap((id) => docs.get(id)?.name ?? []) ?? [];
    setItems((current) => [
      ...current,
      {
        id: `a${Date.now()}`,
        role: "user",
        text: value.skip
          ? "Go on without it"
          : value.choice
            ? (PIPELINES[value.choice as keyof typeof PIPELINES]?.title ??
              value.choice)
            : "",
        documentNames: names,
        tools: [],
      },
    ]);
    if (value.documentIds)
      setTray((current) =>
        current.filter((id) => !value.documentIds?.includes(id)),
      );
    try {
      await answer(run.question.questionId, value);
    } finally {
      setAnswering(false);
    }
  }

  async function upload(files: File[]) {
    setUploading(true);
    try {
      const created = await uploadDocuments(await prepareUpload(files));
      setDesk((current) =>
        current
          ? { ...current, uploads: [...current.uploads, ...created] }
          : current,
      );
      addToTray(created.map((doc) => doc.id));
      log("info", `uploaded ${created.map((doc) => doc.name).join(", ")}`);
    } catch (error) {
      log("error", error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  // Ledger's cues --------------------------------------------------------------------
  const perchRef = useRef<HTMLDivElement>(null);
  const questionRef = useRef<HTMLDivElement>(null);
  const focusRef = useRef<HTMLElement | null>(null);
  const nodes = useRef(new Map<number, HTMLElement>());
  const [cue, setCue] = useState<CatCue>({ target: null, pose: "wave" });
  const stageOn = runId !== null && run.jobs.length > 0;
  const currentJob = run.jobs[run.current];

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (run.question && questionRef.current) {
        setCue({
          target: questionRef.current,
          pose: "confused",
          line: "Need this from you",
          align: "left",
        });
      } else if (run.decision && focusRef.current) {
        const style = RECOMMENDATION_STYLE[run.decision.recommendation];
        setCue({
          target: focusRef.current,
          pose: style.pose,
          line: style.stamp,
          align: "right",
        });
      } else if (stageOn && currentJob && run.status === "running") {
        setCue({
          target: nodes.current.get(run.current) ?? null,
          pose: JOB_POSE[currentJob.job],
          line: JOB_LINE[currentJob.job],
        });
      } else if (busy) {
        setCue({ target: perchRef.current, pose: talking ? "talk" : "think" });
      } else if (dragging) {
        setCue({
          target: perchRef.current,
          pose: "carry",
          line: "Drop it here",
        });
      } else {
        setCue({
          target: perchRef.current,
          pose: greeted ? "idle" : "wave",
          line: greeted ? undefined : desk ? "Hi! Drop me a case" : undefined,
        });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [
    run.question,
    run.decision,
    run.status,
    run.current,
    currentJob,
    stageOn,
    busy,
    talking,
    dragging,
    greeted,
    desk,
  ]);

  // Layout --------------------------------------------------------------------------
  const compact = stageOn && !cabinetOpen;

  if (failed) {
    return (
      <div className="flex h-dvh items-center justify-center p-6">
        <p className="outline-box rounded-sm bg-paper p-6 text-sm">{failed}</p>
      </div>
    );
  }

  return (
    <div className="cw-desk flex h-dvh min-h-[640px] flex-col overflow-hidden text-ink">
      <header className="flex h-14 shrink-0 items-center gap-3 border-ink border-b-2 bg-paper px-4">
        <Link
          href="/#demos"
          className="eyebrow font-bold text-federal-blue underline"
        >
          ← Labs
        </Link>
        <h1 className="font-mono text-sm font-bold tracking-[0.12em] uppercase sm:text-base">
          Casework desk
        </h1>
        <span className="hidden rounded-sm border-2 border-ink px-1.5 font-mono text-[10px] font-bold tracking-[0.08em] uppercase md:inline">
          Synthetic data · Cayman
        </span>
        <button
          type="button"
          onClick={() => setMobileCabinet(true)}
          className="outline-box ml-auto rounded-sm bg-paper px-2 py-1 font-mono text-xs font-bold uppercase lg:hidden"
        >
          Cabinet
        </button>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="outline-box press flex items-center gap-2 rounded-sm bg-paper px-2.5 py-1 font-mono text-xs font-bold lg:ml-auto"
          title="Models and spend"
        >
          <span className="text-ink-muted">$</span>
          {spend.totalUsd.toFixed(4)}
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
          </svg>
        </button>
        <button
          type="button"
          onClick={async () => {
            await newDesk();
            setRunId(null);
            setTray([]);
            setChatLines([]);
            await load();
          }}
          className="hidden font-mono text-xs font-bold text-ink-muted uppercase underline hover:text-ink sm:block"
        >
          New desk
        </button>
      </header>

      <LayoutGroup>
        <div className="relative flex min-h-0 flex-1 gap-5 px-4 py-5 lg:px-6">
          {/* Cabinet */}
          <motion.aside
            layout
            transition={{ type: "spring", stiffness: 260, damping: 32 }}
            className={`outline-box hidden min-h-0 shrink-0 rounded-sm bg-marble/90 lg:block ${compact ? "w-16" : "w-[300px] xl:w-[320px]"}`}
            onMouseLeave={() => stageOn && setCabinetOpen(false)}
          >
            {desk ? (
              <Cabinet
                folders={desk.folders}
                uploads={desk.uploads}
                picked={new Set(tray)}
                onPick={(picked) => addToTray(picked.map((doc) => doc.id))}
                onOpen={(doc) => setViewing(doc.id)}
                onUpload={upload}
                uploading={uploading}
                onDragStart={() => setDragging(true)}
                onDragEnd={() => setDragging(false)}
                compact={compact}
                onExpand={() => setCabinetOpen(true)}
              />
            ) : (
              <div className="p-4 font-mono text-xs text-stone uppercase">
                Opening the cabinet…
              </div>
            )}
          </motion.aside>

          {/* Stage, or the quiet middle before any work */}
          <motion.main
            layout
            className={`min-h-0 min-w-0 ${stageOn ? "flex-1" : "hidden flex-1 lg:flex"}`}
          >
            {stageOn ? (
              <Stage
                run={run}
                docs={docs}
                onOpenDoc={setViewing}
                registerNode={(index, element) => {
                  if (element) nodes.current.set(index, element);
                  else nodes.current.delete(index);
                }}
                focusRef={(element) => {
                  focusRef.current = element;
                }}
                onOpenFile={() => setFileOpen(true)}
              />
            ) : (
              <Welcome />
            )}
          </motion.main>

          {/* The Specialist, a little right of centre until work begins */}
          <motion.div
            layout
            transition={{ type: "spring", stiffness: 260, damping: 32 }}
            className={`flex min-h-0 w-full shrink-0 pt-16 ${stageOn ? "lg:w-[380px] xl:w-[420px]" : "lg:mr-[8vw] lg:w-[500px]"}`}
          >
            <ChatPanel
              items={items}
              tray={trayDocs}
              onRemoveFromTray={(id) =>
                setTray((current) => current.filter((item) => item !== id))
              }
              onAddToTray={addToTray}
              onSend={send}
              busy={busy || !desk}
              dragging={dragging}
              question={run.question}
              onAnswer={reply}
              answering={answering}
              perchRef={perchRef}
              questionRef={questionRef}
              wide={!stageOn}
            />
          </motion.div>
        </div>
      </LayoutGroup>

      <Terminal
        lines={terminal}
        open={terminalOpen}
        onToggle={() => setTerminalOpen(!terminalOpen)}
        costUsd={spend.totalUsd}
      />

      <CatLayer cue={cue} />

      {mobileCabinet && desk ? (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div className="h-full w-[88vw] max-w-sm border-ink border-r-2 bg-marble">
            <Cabinet
              folders={desk.folders}
              uploads={desk.uploads}
              picked={new Set(tray)}
              onPick={(picked) => addToTray(picked.map((doc) => doc.id))}
              onOpen={(doc) => setViewing(doc.id)}
              onUpload={upload}
              uploading={uploading}
              onDragStart={() => setDragging(true)}
              onDragEnd={() => setDragging(false)}
              compact={false}
              onExpand={() => {}}
            />
          </div>
          <button
            type="button"
            aria-label="Close the Cabinet"
            className="flex-1 bg-ink/30"
            onClick={() => setMobileCabinet(false)}
          />
        </div>
      ) : null}

      <DocViewer
        documentId={viewing}
        run={run}
        onClose={() => setViewing(null)}
      />
      <DecisionFile
        open={fileOpen}
        run={run}
        onClose={() => setFileOpen(false)}
      />
      {settings ? (
        <SettingsDrawer
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          settings={settings}
          onSettings={setSettings}
          spend={spend}
        />
      ) : null}
    </div>
  );
}

/** Before any work: what the desk can do, at a glance. */
function Welcome() {
  return (
    <div className="flex h-full w-full flex-col justify-center gap-8 pl-4 xl:pl-10">
      <div>
        <p className="eyebrow text-federal-blue">
          A specialist agent on four pipelines
        </p>
        <p className="mt-3 max-w-md font-mono text-4xl leading-[1.02] font-bold tracking-[-0.02em] uppercase xl:text-5xl">
          Drop a case.
          <br />
          Watch it work.
        </p>
      </div>
      <ul className="grid max-w-md gap-2">
        {PIPELINE_IDS.map((id, index) => (
          <motion.li
            key={id}
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 + index * 0.08 }}
            className="flex items-center gap-3"
          >
            <span className="flex -space-x-1.5">
              {PIPELINES[id].jobs.slice(2, 5).map((job) => (
                <span
                  key={job}
                  className="flex size-7 items-center justify-center rounded-sm border-2 border-ink bg-paper"
                  title={JOBS[job].title}
                >
                  <JobGlyph job={job} size={14} />
                </span>
              ))}
            </span>
            <span className="font-mono text-xs font-bold tracking-[0.06em] uppercase">
              {PIPELINES[id].title}
            </span>
          </motion.li>
        ))}
      </ul>
    </div>
  );
}
