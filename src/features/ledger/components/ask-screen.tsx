"use client";

import { MotionConfig } from "motion/react";
import Link from "next/link";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AskSessionView, StoredBuild } from "../domain/build-events";
import { cutBlock, type Layout, type PlanStep } from "../domain/build-plan";
import { contentTree } from "../domain/content-tree";
import { AnswerPage } from "./answer-page";
import { BuildBoard } from "./build-board";
import { type ChatMessage, ChatPanel } from "./chat-panel";
import { LedgerStage } from "./ledger-stage";
import type { PlacedBlock } from "./placed-block";
import { requestBuild } from "./request-build";
import { StepQueue } from "./step-queue";
import { useDirector } from "./use-director";

type Shown = {
  question: string;
  title: string;
  layout: Layout;
  blocks: PlacedBlock[];
};
type Live = { question: string; answer: string; notFound: boolean };

const LIMITED_NOTICE =
  "Ledger has answered enough questions for now and is napping. Here's a recent answer instead.";

/** The fetch steps of a stored Build, as the blocks its answer page shows. */
function blocksOf(build: StoredBuild, buildId = build.id): PlacedBlock[] {
  return build.plan.steps.flatMap((step, index) => {
    const node = contentTree.get(step.source);
    if (step.action !== "fetch" || !node) return [];
    return [
      {
        id: `${buildId}-${index}`,
        source: step.source,
        excerpt: step.excerpt,
        block: cutBlock(node, step.excerpt),
      },
    ];
  });
}

function shownOf(build: StoredBuild): Shown | null {
  if (build.plan.verdict !== "answer") return null;
  return {
    question: build.question,
    title: build.plan.title,
    layout: build.plan.layout,
    blocks: blocksOf(build),
  };
}

type AskScreenProps = {
  session: AskSessionView;
  /** Asked from the home page: the session's first Build plays on arrival. */
  initialQuestion: string | null;
  limited: boolean;
  /** The home page's sections, which Ledger takes apart. */
  pageCopy: ReactNode;
};

export function AskScreen({
  session,
  initialQuestion,
  limited,
  pageCopy,
}: AskScreenProps) {
  const slotRef = useRef<HTMLDivElement>(null);
  const homeRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const director = useDirector({
    slot: slotRef,
    home: homeRef,
    copy: copyRef,
    panel: panelRef,
  });

  const latest = session.builds.at(-1);
  const [builds, setBuilds] = useState(session.builds);
  const [shown, setShown] = useState<Shown | null>(
    latest ? shownOf(latest) : null,
  );
  const [phase, setPhase] = useState<"copy" | "answer">(
    latest && shownOf(latest) ? "answer" : "copy",
  );
  const [placed, setPlaced] = useState<PlacedBlock[]>([]);
  const [live, setLive] = useState<Live | null>(null);
  const [busy, setBusy] = useState(false);
  const [sweep, setSweep] = useState(false);
  const [notice, setNotice] = useState<string | null>(
    limited ? LIMITED_NOTICE : null,
  );

  const placedRef = useRef<PlacedBlock[]>([]);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const started = useRef(false);

  const place = useCallback((item: PlacedBlock) => {
    placedRef.current = [...placedRef.current, item];
    setPlaced(placedRef.current);
  }, []);

  const rewind = useCallback(() => {
    for (const torn of copyRef.current?.querySelectorAll(".ldg-torn") ?? []) {
      torn.classList.remove("ldg-torn");
    }
    placedRef.current = [];
    setPlaced([]);
    setShown(null);
    setSweep(false);
    setPhase("copy");
  }, []);

  /** Plays a Build whose steps come from `steps`, then settles the screen on its answer. */
  const perform = useCallback(
    async (input: {
      buildId: string;
      question: string;
      steps: AsyncIterable<PlanStep>;
      frame: () => { title: string; layout: Layout };
    }) => {
      placedRef.current = [];
      setPlaced([]);
      return director.play({
        buildId: input.buildId,
        steps: input.steps,
        followUp: phaseRef.current === "answer",
        title: () => input.frame().title,
        onPlace: place,
        onRewind: rewind,
        onReform: () => {
          const { title, layout } = input.frame();
          setShown({
            question: input.question,
            title,
            layout,
            blocks: placedRef.current,
          });
          setPhase("answer");
          setSweep(true);
        },
      });
    },
    [director.play, place, rewind],
  );

  const ask = useCallback(
    async (question: string) => {
      if (busy) return;
      setBusy(true);
      setNotice(null);
      setLive({ question, answer: "", notFound: false });
      const queue = new StepQueue<PlanStep>();
      const frame = { title: "", layout: "mixed" as Layout };
      let stored: StoredBuild | null = null;

      const streaming = requestBuild(session.id, question, (event) => {
        if (event.type === "frame") {
          frame.title = event.title;
          frame.layout = event.layout;
        } else if (event.type === "answer") {
          setLive(
            (current) =>
              current && { ...current, answer: current.answer + event.delta },
          );
        } else if (event.type === "step") {
          queue.push(event.step);
        } else if (event.type === "done") {
          stored = event.build;
          frame.title = event.build.plan.title;
          frame.layout = event.build.plan.layout;
        } else if (event.type === "limited") {
          setNotice(event.message);
        } else {
          setNotice(event.message);
        }
      })
        .catch(() => setNotice("Ledger lost his place. Please try again."))
        .finally(() => queue.close());

      const playing = perform({
        buildId: `live-${Date.now()}`,
        question,
        steps: queue,
        frame: () => frame,
      });
      await Promise.all([streaming, playing]);
      const build = stored as StoredBuild | null;
      if (build) setBuilds((list) => [...list, build]);
      setLive(null);
      setBusy(false);
    },
    [busy, perform, session.id],
  );

  const replay = useCallback(
    async (index: number) => {
      const build = builds[index];
      if (!build || busy) return;
      setBusy(true);
      await perform({
        buildId: `${build.id}-replay-${Date.now()}`,
        question: build.question,
        steps: StepQueue.from(build.plan.steps),
        frame: () => ({ title: build.plan.title, layout: build.plan.layout }),
      });
      setBusy(false);
    },
    [builds, busy, perform],
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (initialQuestion && session.builds.length === 0) {
      // Drop `?ask=` so a reload replays the stored Build instead of asking again.
      // A plain history update: a router navigation would re-render the session mid-Build.
      window.history.replaceState(null, "", `/ask/${session.id}`);
      void ask(initialQuestion);
    } else {
      void director.settle(session.builds.length > 0 ? "wave" : "idle");
    }
  }, [ask, director.settle, initialQuestion, session]);

  // Stop when the screen really goes away (or Next hides it for Back), not on
  // Strict Mode's instant cleanup-and-remount in development.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      queueMicrotask(() => {
        if (!mounted.current) director.stop();
      });
    };
  }, [director.stop]);

  const messages = useMemo<ChatMessage[]>(() => {
    const list: ChatMessage[] = builds.flatMap((build, index) => [
      { id: `${build.id}-q`, role: "visitor" as const, text: build.question },
      {
        id: `${build.id}-a`,
        role: "ledger" as const,
        text: build.plan.answer,
        buildIndex: index,
        notFound: build.plan.verdict === "not_found",
      },
    ]);
    if (live) {
      list.push(
        { id: "live-q", role: "visitor", text: live.question },
        { id: "live-a", role: "ledger", text: live.answer },
      );
    }
    return list;
  }, [builds, live]);

  return (
    <MotionConfig reducedMotion="user">
      <div data-testid="ask-screen" data-phase={phase} data-busy={busy}>
        <header className="sticky top-0 z-20 border-ink border-b-2 bg-marble">
          <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-6">
            <Link
              href="/"
              className="eyebrow font-bold text-federal-blue underline"
            >
              ← Reljod Labs
            </Link>
            <p className="eyebrow text-ink-muted">
              Ask session · Ledger rebuilds the site
            </p>
          </div>
        </header>

        <div className="max-lg:pb-[50vh] lg:pr-[24rem]">
          <div
            ref={copyRef}
            data-testid="page-copy"
            hidden={phase === "answer"}
          >
            {pageCopy}
          </div>
          {phase === "answer" && shown ? (
            <AnswerPage
              question={shown.question}
              title={shown.title}
              layout={shown.layout}
              blocks={shown.blocks}
              sweep={sweep}
            />
          ) : null}
        </div>

        <aside
          ref={panelRef}
          aria-label="Ledger's desk"
          className="fixed z-30 flex flex-col bg-paper max-lg:inset-x-0 max-lg:bottom-0 max-lg:h-[46vh] max-lg:border-ink max-lg:border-t-2 lg:top-16 lg:right-0 lg:bottom-0 lg:w-[24rem] lg:border-ink lg:border-l-2"
        >
          <div className="flex min-h-0 flex-col max-lg:h-[40%] lg:flex-1">
            <BuildBoard
              placed={placed}
              reformed={phase === "answer"}
              building={busy && phase === "copy"}
              slotRef={slotRef}
            />
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            <ChatPanel
              messages={messages}
              busy={busy}
              notice={notice}
              onAsk={ask}
              onReplay={replay}
              homeRef={homeRef}
            />
          </div>
        </aside>

        <LedgerStage
          cat={director.cat}
          size={director.size}
          flight={director.flight}
          fx={director.fx}
          prints={director.prints}
          catRef={director.catRef}
          flightRef={director.flightRef}
        />
      </div>
    </MotionConfig>
  );
}
