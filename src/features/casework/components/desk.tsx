"use client";

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
  openEarlierDesk,
  stop,
} from "../server/actions";
import type { DeskView, DocView, RunSummary, SpendView } from "../view";
import { Cabinet, SCENARIO_TONE } from "./cabinet";
import "./casework.css";
import { type CatCue, CatLayer } from "./cat-layer";
import {
  type ChatItem,
  ChatPanel,
  type RunCard,
  toolTitle,
} from "./chat-panel";
import { DocViewer } from "./doc-viewer";
import { JobGlyph, RECOMMENDATION_STYLE, ScenarioGlyph } from "./glyphs";
import { modelSummary } from "./model-form";
import { PipelineFlow } from "./pipeline-flow";
import { isOver } from "./run-reducer";
import { SettingsDrawer } from "./settings-drawer";
import { Stage } from "./stage";
import { Terminal, type TerminalLine } from "./terminal";
import { filesFromDrop, hasFiles, uploadFiles } from "./upload";
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

const JOB_LINE: Record<JobId, string> = {
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

const TERMINAL_BAR = 36;
const TERMINAL_BODY = 220;
const TRAY_LIMIT = 12;

/** Tools that start a Run; their message carries the Run's card. */
function startsRun(name: string) {
  return (
    name.startsWith("pipeline_") ||
    name.startsWith("job_") ||
    name === "review_documents"
  );
}

function toItems(desk: DeskView, docs: Map<string, DocView>): ChatItem[] {
  return desk.messages.map((message) => ({
    id: `m${message.id}`,
    role: message.role,
    text: message.text,
    documentNames: message.documentIds.flatMap(
      (id) => docs.get(id)?.name ?? [],
    ),
    tools: message.tools,
    choices: message.choices,
    runId: message.tools.some((tool) => startsRun(tool.name))
      ? message.runId
      : null,
  }));
}

function ago(iso: string) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} d ago`;
}

/** Teller, the Casework desk: the Cabinet, the stage where Runs play out, and the Specialist's chat. */
export function Desk() {
  const [desk, setDesk] = useState<DeskView | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [tray, setTray] = useState<string[]>([]);
  const [busy, setBusy] = useState<{ label: string; since: number } | null>(
    null,
  );
  const [talking, setTalking] = useState(false);
  /** The Run on the stage. `instant`: it was over when opened, so it lands finished. */
  const [shown, setShown] = useState<{ id: string; instant: boolean } | null>(
    null,
  );
  const [localRuns, setLocalRuns] = useState<RunSummary[]>([]);
  const [dragging, setDragging] = useState(false);
  const [dropping, setDropping] = useState(false);
  /** The person's own choice for the Cabinet; null lets the desk decide. */
  const [cabinetChoice, setCabinetChoice] = useState<boolean | null>(null);
  const [panel, setPanel] = useState<"chat" | "stage" | "cabinet">("chat");
  const [page, setPage] = useState<"desk" | "pipelines">("desk");
  const [viewing, setViewing] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [desksOpen, setDesksOpen] = useState(false);
  const [settings, setSettings] = useState<ModelSettingsByPurpose | null>(null);
  const [spend, setSpend] = useState<SpendView>({ totalUsd: 0, rows: [] });
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [chatLines, setChatLines] = useState<TerminalLine[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const [answering, setAnswering] = useState(false);
  const [greeted, setGreeted] = useState(false);
  const chatAbort = useRef<AbortController | null>(null);
  const run = useRun(shown?.id ?? null, shown?.instant ?? false);

  const load = useCallback(async () => {
    try {
      const view = await openDesk();
      const map = new Map(
        [
          ...view.folders.flatMap((folder) => folder.documents),
          ...view.uploads,
        ].map((doc) => [doc.id, doc]),
      );
      setDesk(view);
      setSettings(view.settings);
      setSpend(view.spend);
      setItems(toItems(view, map));
      setLocalRuns([]);
      const latest = view.runs[0];
      setShown(
        latest
          ? {
              id: latest.id,
              instant:
                latest.status === "completed" ||
                latest.status === "failed" ||
                latest.status === "stopped",
            }
          : null,
      );
    } catch (error) {
      setFailed(
        error instanceof Error ? error.message : "The desk could not open.",
      );
    }
  }, []);

  /** Runs and spend again, without touching the transcript. */
  const refresh = useCallback(async () => {
    try {
      const view = await openDesk();
      setDesk((current) =>
        current ? { ...current, runs: view.runs, desks: view.desks } : view,
      );
      setSpend(view.spend);
    } catch {
      // The next refresh will catch up.
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setTimeout(() => setGreeted(true), 4000);
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

  const live = Boolean(shown) && !shown?.instant && run.seen > 0;
  const going = live && !isOver(run);

  // When a Run comes to rest, its cost and the session's spend catch up.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh on status changes only
  useEffect(() => {
    if (!shown || shown.instant || run.seen === 0) return;
    if (isOver(run)) void refresh();
    else if (run.status === "waiting") void getSpend().then(setSpend);
  }, [run.status]);

  /** Every Run of this desk as its card in the chat shows it. */
  const runs = useMemo(() => {
    const cards = new Map<string, RunCard>();
    for (const summary of [...localRuns, ...(desk?.runs ?? [])]) {
      const selected = summary.id === shown?.id;
      const followed = selected && run.seen > 0;
      cards.set(summary.id, {
        ...summary,
        selected,
        ...(followed
          ? {
              pipeline: run.pipeline ?? summary.pipeline,
              jobs: run.jobs.length
                ? run.jobs.map((item) => item.job)
                : summary.jobs,
              status: run.status,
              recommendation:
                run.decision?.recommendation ?? summary.recommendation,
              headline: run.decision?.headline,
              // Events carry each call's cost; the stored total wins once it is in.
              costUsd: Math.max(summary.costUsd, run.costUsd),
              calls: Math.max(summary.calls, run.calls),
              seconds:
                run.startedAt && run.lastAt
                  ? (run.lastAt - run.startedAt) / 1000
                  : undefined,
            }
          : {}),
      });
    }
    return cards;
  }, [localRuns, desk?.runs, shown?.id, run]);

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

  const log = useCallback(
    (level: TerminalLine["level"], text: string) =>
      setChatLines((lines) =>
        [...lines, { at: Date.now(), level, text }].slice(-200),
      ),
    [],
  );

  const addToTray = useCallback(
    (ids: string[]) =>
      setTray((current) =>
        [...new Set([...current, ...ids])].slice(0, TRAY_LIMIT),
      ),
    [],
  );

  async function send(text: string) {
    if (busy) return;
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
    setBusy({ label: "Thinking", since: Date.now() });
    setPanel("chat");
    log(
      "mcp",
      `chat → "${text || "(documents)"}" with ${documentIds.length} document${documentIds.length === 1 ? "" : "s"}`,
    );
    const patch = (fn: (item: ChatItem) => ChatItem) =>
      setItems((current) =>
        current.map((item) => (item.id === pendingId ? fn(item) : item)),
      );
    const controller = new AbortController();
    chatAbort.current = controller;
    try {
      const response = await fetch("/api/casework/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, documentIds }),
        signal: controller.signal,
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
          } else if (event.type === "reasoning") {
            patch((item) => ({
              ...item,
              reasoning: (item.reasoning ?? "") + event.text,
            }));
          } else if (event.type === "choices") {
            patch((item) => ({
              ...item,
              choices: { question: event.question, options: event.options },
            }));
          } else if (event.type === "tool") {
            patch((item) => ({
              ...item,
              tools: [...item.tools, { name: event.name, input: event.input }],
            }));
            setBusy((current) =>
              current ? { ...current, label: toolTitle(event.name) } : current,
            );
            log(
              "mcp",
              `mcp → tools/call ${event.name} ${JSON.stringify(event.input).slice(0, 140)}`,
            );
          } else if (event.type === "tool-result") {
            patch((item) => ({
              ...item,
              runId:
                event.runId && startsRun(event.name) ? event.runId : item.runId,
              tools: item.tools.map((tool, index, all) =>
                index ===
                all.findLastIndex((entry) => entry.name === event.name)
                  ? { ...tool, ok: event.ok, summary: event.summary }
                  : tool,
              ),
            }));
            setBusy((current) =>
              current ? { ...current, label: "Thinking" } : current,
            );
            log(
              event.ok ? "mcp" : "error",
              `mcp ← ${event.name}: ${event.summary.slice(0, 160)}`,
            );
            const started = event.runId;
            if (started && startsRun(event.name) && event.ok) {
              setLocalRuns((current) => [
                {
                  id: started,
                  pipeline: null,
                  jobs: [],
                  status: "running",
                  recommendation: null,
                  createdAt: new Date().toISOString(),
                  costUsd: 0,
                  calls: 0,
                  documentIds: [],
                },
                ...current,
              ]);
              setShown({ id: started, instant: false });
              setPage("desk");
            }
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
      if (controller.signal.aborted) {
        patch((item) => ({
          ...item,
          text: item.text ? `${item.text} (stopped)` : "Stopped.",
        }));
      } else {
        patch((item) => ({
          ...item,
          text: error instanceof Error ? error.message : "Something went wrong",
        }));
      }
    } finally {
      patch((item) => ({
        ...item,
        pending: false,
        text:
          item.text || (item.tools.length || item.choices ? "" : "No reply."),
      }));
      chatAbort.current = null;
      setBusy(null);
      setTalking(false);
      void getSpend().then(setSpend);
    }
  }

  /** Stops whatever is going: the Specialist mid-answer, and the Run on the stage. */
  const stopAll = useCallback(async () => {
    const answering = chatAbort.current;
    answering?.abort();
    const runId = shown && !shown.instant ? shown.id : null;
    log("warn", "■ stop requested");
    try {
      let result = await stop(runId);
      // A Run the Specialist was just starting may only exist a moment later.
      if (answering && !result.stopped) {
        await new Promise((resolve) => setTimeout(resolve, 4000));
        result = await stop(null);
      }
      // Stopping mid-answer already says so in the transcript.
      if (result.stopped && !answering) {
        setItems((current) => [
          ...current,
          {
            id: `s${Date.now()}`,
            role: "specialist",
            text: "Stopped. Nothing else will run.",
            documentNames: [],
            tools: [],
          },
        ]);
      }
    } catch (error) {
      log("error", error instanceof Error ? error.message : "Could not stop");
    }
    void refresh();
  }, [shown, log, refresh]);

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

  const upload = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setUploading(
        `Preparing ${files.length} file${files.length === 1 ? "" : "s"}…`,
      );
      try {
        const report = await uploadFiles(files, (done, total, name) =>
          setUploading(
            done < total
              ? `Uploading ${done + 1} of ${total}: ${name}`
              : "Filing them…",
          ),
        );
        if (report.created.length > 0) {
          setDesk((current) =>
            current
              ? { ...current, uploads: [...current.uploads, ...report.created] }
              : current,
          );
          addToTray(report.created.map((doc) => doc.id));
          log(
            "info",
            `uploaded ${report.created.map((doc) => doc.name).join(", ")}`,
          );
        }
        for (const item of report.skipped)
          log("warn", `skipped ${item.name}: ${item.reason}`);
        if (report.skipped.length > 0) {
          setItems((current) => [
            ...current,
            {
              id: `k${Date.now()}`,
              role: "specialist",
              text: `I left out ${report.skipped.length} file${report.skipped.length === 1 ? "" : "s"}: ${report.skipped
                .slice(0, 4)
                .map((item) => `**${item.name}** (${item.reason})`)
                .join(", ")}${report.skipped.length > 4 ? " and more" : ""}.`,
              documentNames: [],
              tools: [],
            },
          ]);
        }
        if (report.created.length > TRAY_LIMIT)
          log(
            "warn",
            `a message takes ${TRAY_LIMIT} documents; the rest are in Your uploads`,
          );
      } catch (error) {
        log("error", error instanceof Error ? error.message : "Upload failed");
      } finally {
        setUploading(null);
      }
    },
    [addToTray, log],
  );

  // Files and folders dragged in from the computer land anywhere on the desk.
  useEffect(() => {
    let depth = 0;
    const enter = (event: DragEvent) => {
      if (!hasFiles(event.dataTransfer)) return;
      depth++;
      setDropping(true);
    };
    const leave = (event: DragEvent) => {
      if (!hasFiles(event.dataTransfer)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDropping(false);
    };
    const over = (event: DragEvent) => {
      if (hasFiles(event.dataTransfer)) event.preventDefault();
    };
    const drop = async (event: DragEvent) => {
      depth = 0;
      setDropping(false);
      if (!event.dataTransfer || !hasFiles(event.dataTransfer)) return;
      event.preventDefault();
      void upload(await filesFromDrop(event.dataTransfer));
    };
    // Panels that take the drop themselves stop it from reaching the window.
    const clear = () => {
      depth = 0;
      setDropping(false);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    window.addEventListener("drop", clear, true);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
      window.removeEventListener("drop", clear, true);
    };
  }, [upload]);

  async function switchDesk(id: string | null) {
    chatAbort.current?.abort();
    setDesksOpen(false);
    setShown(null);
    setTray([]);
    setChatLines([]);
    setItems([]);
    setDesk(null);
    if (id) await openEarlierDesk(id);
    else await newDesk();
    await load();
  }

  // Ledger's cues: he stays at his post; only his pose and words change. -----------
  const questionRef = useRef<HTMLDivElement>(null);
  const focusRef = useRef<HTMLElement | null>(null);
  const stageOn = shown !== null && run.jobs.length > 0;
  const currentJob = run.jobs[run.current];
  const cue: CatCue =
    going && run.question
      ? { pose: "confused", line: "Need this from you" }
      : live && run.status === "stopped"
        ? { pose: "idle", line: "Stopped" }
        : live && run.decision
          ? {
              pose: RECOMMENDATION_STYLE[run.decision.recommendation].pose,
              line: RECOMMENDATION_STYLE[run.decision.recommendation].stamp,
            }
          : going && currentJob
            ? {
                pose: JOB_POSE[currentJob.job],
                line: JOB_LINE[currentJob.job],
              }
            : busy
              ? { pose: talking ? "talk" : "think" }
              : dragging || dropping
                ? { pose: "carry", line: "Drop it on the chat" }
                : uploading
                  ? { pose: "carry", line: "Filing it" }
                  : !greeted && desk
                    ? { pose: "wave", line: "Hi! Hand me a case" }
                    : { pose: "idle" };

  // The Cabinet steps aside while a Run has the stage, and comes back when
  // the Run asks for a Document that is on file.
  const suggested = useMemo(
    () =>
      new Set(going ? run.question?.suggestions.map((item) => item.id) : []),
    [going, run.question],
  );
  const cabinetOpen = cabinetChoice ?? (!stageOn || suggested.size > 0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new Run or a new Question hands the choice back to the desk
  useEffect(
    () => setCabinetChoice(null),
    [shown?.id, run.question?.questionId],
  );

  const working = busy
    ? { label: busy.label, costUsd: 0, since: busy.since }
    : going
      ? {
          label:
            run.status === "waiting"
              ? "Waiting on your answer"
              : currentJob
                ? JOBS[currentJob.job].doing
                : "Starting the run",
          costUsd: run.costUsd,
          since: run.startedAt ?? Date.now(),
        }
      : null;

  if (failed) {
    return (
      <div className="flex h-dvh items-center justify-center p-6">
        <p className="outline-box rounded-sm bg-paper p-6 text-sm">{failed}</p>
      </div>
    );
  }

  const cabinet = desk ? (
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
      onCollapse={() => setCabinetChoice(false)}
      highlight={suggested}
    />
  ) : (
    <div className="cw-shimmer p-4 font-mono text-xs uppercase">
      Opening the cabinet…
    </div>
  );

  return (
    <div className="cw-desk flex h-dvh min-h-[620px] flex-col overflow-hidden text-ink">
      <header className="relative z-30 flex h-12 shrink-0 items-center gap-3 bg-ink px-4 text-paper">
        <Link
          href="/#demos"
          className="font-mono text-[11px] font-bold tracking-[0.1em] text-paper/70 uppercase hover:text-paper"
        >
          ← Labs
        </Link>
        <span className="h-5 w-px bg-paper/25" />
        <h1 className="font-mono text-sm font-bold tracking-[0.14em] uppercase">
          Teller
        </h1>
        <span className="hidden rounded-sm border border-brass/70 px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-[0.08em] text-brass uppercase md:inline">
          Synthetic data
        </span>
        <nav className="ml-3 flex gap-1" aria-label="Pages">
          {(
            [
              ["desk", "Desk"],
              ["pipelines", "Pipelines"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={page === value}
              onClick={() => setPage(value)}
              className={`h-8 rounded-sm px-3 font-mono text-[11px] font-bold tracking-[0.08em] uppercase transition-colors ${page === value ? "bg-paper text-ink" : "text-paper/70 hover:bg-paper/10 hover:text-paper"}`}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <button
              type="button"
              onClick={() => setDesksOpen(!desksOpen)}
              aria-expanded={desksOpen}
              className="flex h-8 items-center gap-1.5 rounded-sm border border-paper/30 px-2.5 font-mono text-[11px] font-bold tracking-[0.06em] uppercase hover:bg-paper/10"
            >
              Desks
              <span className="text-paper/60">{desk?.desks.length ?? ""}</span>
              <span aria-hidden="true">▾</span>
            </button>
            {desksOpen && desk ? (
              <>
                <button
                  type="button"
                  aria-label="Close the list of desks"
                  className="fixed inset-0 z-40 cursor-default"
                  onClick={() => setDesksOpen(false)}
                />
                <div className="cw-reveal absolute top-10 right-0 z-50 w-80 rounded-sm border-2 border-ink bg-paper text-ink shadow-hard-md">
                  <p className="border-ink/15 border-b px-3 py-2 text-xs text-ink-muted">
                    Each desk keeps its own chat, runs and spend. Go back to one
                    any time from this browser.
                  </p>
                  <ul className="cw-scroll max-h-72 overflow-y-auto">
                    {desk.desks.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          disabled={item.current}
                          onClick={() => switchDesk(item.id)}
                          className={`flex w-full items-baseline gap-2 border-ink/10 border-b px-3 py-2 text-left ${item.current ? "bg-morning-haze/60" : "hover:bg-marble"}`}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-semibold">
                              {item.title}
                            </span>
                            <span className="block font-mono text-[10px] text-ink-muted">
                              {item.current
                                ? "This desk"
                                : ago(item.lastActiveAt)}{" "}
                              · ${item.spendUsd.toFixed(4)}
                            </span>
                          </span>
                          {item.current ? null : (
                            <span className="font-mono text-[10px] font-bold text-federal-blue uppercase">
                              Open
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    onClick={() => switchDesk(null)}
                    className="w-full px-3 py-2 text-left font-mono text-[11px] font-bold tracking-[0.06em] text-federal-blue uppercase hover:bg-marble"
                  >
                    + New desk
                  </button>
                </div>
              </>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="flex h-8 items-center gap-2 rounded-sm border border-paper/30 px-2.5 font-mono text-[11px] font-bold hover:bg-paper/10"
            title="Spend and model settings"
          >
            <span className="text-paper/60 uppercase">Spend</span>$
            {spend.totalUsd.toFixed(4)}
          </button>
        </div>
      </header>

      {page === "pipelines" ? (
        <div className="min-h-0 flex-1 px-3 py-3 lg:px-4 lg:py-4">
          {settings ? (
            <PipelineFlow
              settings={settings}
              onSettings={setSettings}
              run={run}
            />
          ) : null}
        </div>
      ) : (
        <>
          {/* Phones and tablets see one panel at a time. */}
          <nav className="flex shrink-0 border-ink border-b-2 bg-paper lg:hidden">
            {(["chat", "stage", "cabinet"] as const).map((name) => (
              <button
                key={name}
                type="button"
                aria-pressed={panel === name}
                onClick={() => setPanel(name)}
                className={`flex-1 py-2 font-mono text-[11px] font-bold tracking-[0.08em] uppercase ${panel === name ? "bg-ink text-paper" : "text-ink-muted"}`}
              >
                {name}
              </button>
            ))}
          </nav>

          <div className="relative flex min-h-0 flex-1 gap-4 px-3 pt-3 pb-3 lg:px-4 lg:pt-4 lg:pb-4">
            {/* Cabinet */}
            <aside
              className={`min-h-0 shrink-0 overflow-hidden rounded-sm border-2 border-ink bg-marble shadow-hard-md transition-[width] duration-300 ease-out ${panel === "cabinet" ? "block w-full" : "hidden"} lg:block ${cabinetOpen ? "lg:w-[344px]" : "lg:w-12"}`}
            >
              {cabinetOpen || panel === "cabinet" ? (
                cabinet
              ) : (
                <button
                  type="button"
                  onClick={() => setCabinetChoice(true)}
                  className="flex h-full w-full flex-col items-center gap-3 bg-ink py-3 text-paper hover:bg-ink/90"
                  aria-label="Open the Cabinet"
                  title="Open the Cabinet"
                >
                  <span className="font-mono text-sm">»</span>
                  <span className="font-mono text-[11px] font-bold tracking-[0.2em] uppercase [writing-mode:vertical-rl]">
                    Cabinet
                  </span>
                </button>
              )}
            </aside>

            {/* The stage: a Run as it goes, then its result */}
            <main
              className={`min-h-0 min-w-0 flex-1 flex-col gap-3 ${panel === "stage" ? "flex" : "hidden"} lg:flex`}
            >
              <div className="min-h-0 flex-1">
                {stageOn ? (
                  <Stage
                    run={run}
                    docs={docs}
                    onOpenDoc={setViewing}
                    registerNode={() => {}}
                    focusRef={(element) => {
                      focusRef.current = element;
                    }}
                    cost={runs.get(shown?.id ?? "")}
                  />
                ) : (
                  <Welcome
                    desk={desk}
                    onPipelines={() => setPage("pipelines")}
                    onTry={(ids) => {
                      addToTray(ids);
                      setPanel("chat");
                    }}
                  />
                )}
              </div>
            </main>

            {/* The Specialist: the same width whether or not a Run is on the stage */}
            <div
              className={`min-h-0 w-full shrink-0 ${panel === "chat" ? "flex" : "hidden"} lg:flex lg:w-[400px] xl:w-[440px]`}
            >
              <ChatPanel
                items={items}
                tray={trayDocs}
                onRemoveFromTray={(id) =>
                  setTray((current) => current.filter((item) => item !== id))
                }
                onAddToTray={addToTray}
                onSend={send}
                busy={Boolean(busy)}
                disabled={!desk}
                dragging={dragging}
                question={going ? run.question : null}
                onAnswer={reply}
                answering={answering}
                questionRef={questionRef}
                runs={runs}
                onSelectRun={(id) => {
                  const summary = runs.get(id);
                  setShown({
                    id,
                    instant: summary ? isOver(summary) : true,
                  });
                  setPage("desk");
                  setPanel("stage");
                }}
                working={working}
                onStop={stopAll}
                onDropFiles={upload}
                model={settings ? modelSummary(settings.chat) : ""}
              />
            </div>
          </div>
        </>
      )}

      <Terminal
        lines={terminal}
        open={terminalOpen}
        onToggle={() => setTerminalOpen(!terminalOpen)}
        costUsd={spend.totalUsd}
      />

      {dropping ? (
        <div className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center bg-ink/55">
          <div className="rounded-sm border-2 border-dashed border-paper bg-ink px-10 py-8 text-center text-paper">
            <p className="font-mono text-2xl font-bold tracking-[0.04em] uppercase">
              Drop files or folders
            </p>
            <p className="mt-2 text-sm text-paper/75">
              PDF, JPEG, PNG or CSV. They go to your uploads and onto the
              message.
            </p>
          </div>
        </div>
      ) : null}

      <CatLayer
        cue={cue}
        floor={TERMINAL_BAR + (terminalOpen ? TERMINAL_BODY : 0)}
      />

      <DocViewer
        doc={viewing ? (docs.get(viewing) ?? null) : null}
        run={run}
        picked={viewing ? tray.includes(viewing) : false}
        onPick={(id) => addToTray([id])}
        onClose={() => setViewing(null)}
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

/** Before any work: what the desk can do, and a case to try. */
function Welcome({
  desk,
  onPipelines,
  onTry,
}: {
  desk: DeskView | null;
  onPipelines: () => void;
  onTry: (ids: string[]) => void;
}) {
  // One case from each scenario, as something to click.
  const samples = PIPELINE_IDS.flatMap((id) => {
    const folder = desk?.folders.find((item) => item.scenario === id);
    return folder ? [folder] : [];
  });
  return (
    <div className="cw-scroll flex h-full flex-col gap-5 overflow-y-auto pr-1">
      <div className="cw-reveal rounded-sm border-2 border-ink bg-ink p-6 text-paper shadow-hard-md">
        <p className="font-mono text-[11px] font-bold tracking-[0.12em] text-brass uppercase">
          A specialist agent on four pipelines
        </p>
        <p className="mt-3 max-w-xl font-mono text-3xl leading-[1.05] font-bold tracking-[-0.02em] uppercase xl:text-4xl">
          Hand Teller a case. Watch it work.
        </p>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-paper/75">
          Thirteen reusable jobs make four reviews. Models sort, read and write;
          rules decide. Every job is a tool on an MCP server, and every run is a
          durable workflow that stops to ask when something is missing.
        </p>
        <button
          type="button"
          onClick={onPipelines}
          className="press mt-4 rounded-sm border-2 border-paper bg-paper px-3 py-1.5 font-mono text-[11px] font-bold tracking-[0.08em] text-ink uppercase"
        >
          See the pipelines as graphs →
        </button>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        {PIPELINE_IDS.map((id, index) => {
          const tone = SCENARIO_TONE[id];
          const sample = samples.find((folder) => folder.scenario === id);
          return (
            <div
              key={id}
              className="cw-reveal overflow-hidden rounded-sm border-2 border-ink bg-paper shadow-hard-sm"
              style={{ animationDelay: `${index * 60}ms` }}
            >
              <div className={`h-1.5 ${tone.bar}`} />
              <div className="p-3.5">
                <div className="flex items-center gap-2">
                  <span className={tone.text}>
                    <ScenarioGlyph scenario={id} />
                  </span>
                  <p className="font-mono text-xs font-bold tracking-[0.06em] uppercase">
                    {PIPELINES[id].title}
                  </p>
                </div>
                <p className="mt-1.5 text-[13px] text-ink-muted">
                  {PIPELINES[id].blurb}.
                </p>
                <div className="mt-2.5 flex flex-wrap items-center gap-1">
                  {PIPELINES[id].jobs.map((job) => (
                    <span
                      key={job}
                      className={`flex size-6 items-center justify-center rounded-sm border border-ink/40 ${JOBS[job].model ? "bg-morning-haze" : "bg-marble"}`}
                      title={`${JOBS[job].title}${JOBS[job].model ? " (model)" : " (rules)"}`}
                    >
                      <JobGlyph job={job} size={13} />
                    </span>
                  ))}
                </div>
                {sample ? (
                  <button
                    type="button"
                    onClick={() => onTry(sample.documents.map((doc) => doc.id))}
                    className="mt-3 flex w-full items-center gap-2.5 rounded-sm border border-ink/25 bg-marble/60 p-1.5 text-left transition-colors hover:border-ink hover:bg-morning-haze/50"
                  >
                    <span className="flex -space-x-3">
                      {sample.documents.slice(0, 3).map((doc) => (
                        <span
                          key={doc.id}
                          className="block h-11 w-8 overflow-hidden rounded-[2px] border border-ink/60 bg-paper"
                        >
                          {doc.thumbUrl ? (
                            // biome-ignore lint/performance/noImgElement: signed Storage URLs
                            <img
                              src={doc.thumbUrl}
                              alt=""
                              className="h-full w-full object-cover object-top"
                            />
                          ) : null}
                        </span>
                      ))}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-semibold">
                        Try: {sample.title}
                      </span>
                      <span className="block font-mono text-[10px] text-ink-muted">
                        Adds {sample.documents.length} documents to the message
                      </span>
                    </span>
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
