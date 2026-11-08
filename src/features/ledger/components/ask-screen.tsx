"use client";

import { useMutation } from "@tanstack/react-query";
import { MotionConfig, motion } from "motion/react";
import { useRouter } from "next/navigation";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { LogLine, LogTone } from "@/components/ui/terminal";
import { QueryProvider } from "@/features/document-compliance/components/query-provider";
import type { AskSessionView, StoredBuild } from "../domain/build-events";
import { cutBlock, type PlanStep, type Sentence } from "../domain/build-plan";
import { contentTree } from "../domain/content-tree";
import { startAskSession } from "../server/actions";
import { AnswerPage } from "./answer-page";
import type { CatPose } from "./cat";
import { type ChatMessage, ChatPanel } from "./chat-panel";
import { type LedgerDesk, LedgerDeskContext } from "./ledger-desk";
import { LedgerStage } from "./ledger-stage";
import type { PlacedBlock } from "./placed-block";
import { requestBuild } from "./request-build";
import { Stack } from "./stack";
import { StepQueue } from "./step-queue";
import { useDirector } from "./use-director";

type Shown = {
  question: string;
  title: string;
  blocks: PlacedBlock[];
  writeup: Sentence[];
  /** The stored Build it came from, for Replay; null while it is still being stored. */
  buildIndex: number | null;
};
type Live = { question: string; answer: string };
type Phase = "copy" | "stack" | "answer";

const LIMITED_NOTICE =
  "Ledger has answered enough questions for now and is napping. Here's a recent answer instead.";
const ALL_WRITTEN = Number.POSITIVE_INFINITY;

/** The fetch steps of a stored Build, as the Source blocks its answer cites. */
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

function shownOf(build: StoredBuild, buildIndex: number): Shown | null {
  if (build.plan.verdict !== "answer") return null;
  return {
    question: build.question,
    title: build.plan.title,
    blocks: blocksOf(build),
    writeup: build.plan.writeup,
    buildIndex,
  };
}

type AskScreenProps = {
  /** null on the home page until the visitor asks. */
  session: AskSessionView | null;
  limited?: boolean;
  /** The home page's sections, which Ledger takes apart. */
  pageCopy: ReactNode;
  header: ReactNode;
  footer: ReactNode;
};

/**
 * The site with Ledger in it. The home page and an Ask session are the same
 * screen: asking pushes the chat into the dock and the page rebuilds in place.
 */
export function AskScreen(props: AskScreenProps) {
  return (
    <QueryProvider>
      <Screen {...props} />
    </QueryProvider>
  );
}

function Screen({
  session,
  limited = false,
  pageCopy,
  header,
  footer,
}: AskScreenProps) {
  const router = useRouter();
  const [sessionId, setSessionId] = useState(session?.id ?? null);
  const [builds, setBuilds] = useState(session?.builds ?? []);
  const buildsRef = useRef(builds);
  buildsRef.current = builds;
  const lastIndex = (session?.builds.length ?? 0) - 1;
  const last = session?.builds.at(-1);
  const [shown, setShown] = useState<Shown | null>(
    last ? shownOf(last, lastIndex) : null,
  );
  const [phase, setPhase] = useState<Phase>(
    last && shownOf(last, lastIndex) ? "answer" : "copy",
  );
  const [typed, setTyped] = useState(ALL_WRITTEN);
  const [sweep, setSweep] = useState(false);
  const [stacked, setStacked] = useState<PlacedBlock[]>([]);
  const [stackQuestion, setStackQuestion] = useState("");
  const [stacking, setStacking] = useState(false);
  const [live, setLive] = useState<Live | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(
    limited ? LIMITED_NOTICE : null,
  );
  const [docked, setDocked] = useState(!!session);
  /** The dock slides in only when the chat is pushed there from the hero. */
  const [pushedIn, setPushedIn] = useState(false);
  const [inHero, setInHero] = useState(!session);
  const [catLeft, setCatLeft] = useState(!!session);
  const [heroPose, setHeroPose] = useState<CatPose>("wave");
  const [lines, setLines] = useState<LogLine[]>([]);

  const boxRef = useRef<HTMLElement>(null);
  const heroCatRef = useRef<HTMLDivElement>(null);
  const stackedRef = useRef<PlacedBlock[]>([]);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const lineIds = useRef(0);
  const logStart = useRef(0);

  const log = useCallback((text: string, tone: LogTone = "muted") => {
    if (lineIds.current === 0) logStart.current = performance.now();
    const line = {
      id: ++lineIds.current,
      at: performance.now() - logStart.current,
      tone,
      text,
    };
    setLines((current) => [...current.slice(-199), line]);
  }, []);

  const director = useDirector(log);

  const stackItem = useCallback((item: PlacedBlock) => {
    stackedRef.current = [...stackedRef.current, item];
    setStacked(stackedRef.current);
  }, []);

  const rewind = useCallback(() => {
    for (const torn of director.copyRef.current?.querySelectorAll(
      ".ldg-torn",
    ) ?? []) {
      torn.classList.remove("ldg-torn");
    }
    stackedRef.current = [];
    setStacked([]);
    setShown(null);
    setSweep(false);
    setPhase("copy");
  }, [director.copyRef]);

  /** Plays a Build whose steps come from `steps`, then settles the screen on its written answer. */
  const perform = useCallback(
    (input: {
      buildId: string;
      question: string;
      steps: AsyncIterable<PlanStep>;
      frame: () => { title: string };
      writeup: () => Promise<Sentence[]>;
      buildIndex: () => number | null;
    }) => {
      stackedRef.current = [];
      setStacked([]);
      setStackQuestion(input.question);
      const playing = director.play({
        buildId: input.buildId,
        steps: input.steps,
        followUp: phaseRef.current === "answer",
        writeup: input.writeup,
        onBegin: () => {
          setShown(null);
          setStacking(true);
          setPhase("stack");
        },
        onStack: stackItem,
        onStacked: () => setStacking(false),
        onRewind: rewind,
        onWrite: (writeup) => {
          setTyped(0);
          setSweep(false);
          setShown({
            question: input.question,
            title: input.frame().title,
            blocks: stackedRef.current,
            writeup,
            buildIndex: input.buildIndex(),
          });
          setPhase("answer");
        },
        onType: setTyped,
        onSettle: () => {
          setTyped(ALL_WRITTEN);
          setSweep(true);
        },
      });
      return playing.then((result) => {
        if (result === "not_found") setPhase("copy");
        return result;
      });
    },
    [director.play, rewind, stackItem],
  );

  const build = useCallback(
    async (id: string, question: string, ready?: Promise<unknown>) => {
      setBusy(true);
      setNotice(null);
      setLive({ question, answer: "" });
      log(`POST /ask/${id.slice(0, 8)}/builds “${question}”`, "info");
      const queue = new StepQueue<PlanStep>();
      const frame = { title: "" };
      let stored: StoredBuild | null = null;
      let answered = false;
      let steps = 0;

      const streaming = requestBuild(id, question, (event) => {
        if (event.type === "frame") {
          frame.title = event.title;
          log(`← plan “${event.title}”`, "info");
        } else if (event.type === "answer") {
          if (!answered) log("← answer streaming into chat", "muted");
          answered = true;
          setLive(
            (current) =>
              current && { ...current, answer: current.answer + event.delta },
          );
        } else if (event.type === "step") {
          steps++;
          log(
            `← step ${steps}: ${event.step.action} ${event.step.source} (${event.step.pace})`,
            event.step.action === "toss" ? "warn" : "muted",
          );
          queue.push(event.step);
        } else if (event.type === "done") {
          stored = event.build;
          frame.title = event.build.plan.title;
          log(`← stored · ${event.build.plan.writeup.length} sentences`, "ok");
        } else {
          log(`! ${event.message}`, "bad");
          setNotice(event.message);
        }
      })
        .catch(() => {
          log("! the stream broke", "bad");
          setNotice("Ledger lost his place. Please try again.");
        })
        .finally(() => queue.close());

      /* Without a stored plan, the chat answer stands in, citing everything stacked. */
      const writeup = async (): Promise<Sentence[]> => {
        await streaming;
        const plan = (stored as StoredBuild | null)?.plan;
        if (plan?.writeup.length) return plan.writeup;
        return [
          {
            text: plan?.answer ?? "Here's what the site says.",
            cites: stackedRef.current.map((_, index) => index + 1),
          },
        ];
      };

      await ready;
      let index: number | null = null;
      const playing = perform({
        buildId: `live-${Date.now()}`,
        question,
        steps: queue,
        frame: () => frame,
        writeup,
        buildIndex: () => index,
      });
      await streaming;
      const done = stored as StoredBuild | null;
      if (done) {
        index = buildsRef.current.length;
        setBuilds((list) => [...list, done]);
      }
      setLive(null);
      await playing;
      if (done) {
        setShown((current) => current && { ...current, buildIndex: index });
      }
      setBusy(false);
    },
    [log, perform],
  );

  const ask = useCallback(
    (question: string) => {
      if (busy || !sessionId) return;
      void build(sessionId, question);
    },
    [build, busy, sessionId],
  );

  const replay = useCallback(
    async (index: number) => {
      const stored = builds[index];
      if (!stored || busy) return;
      setBusy(true);
      log(`$ ledger replay “${stored.question}”`, "info");
      await perform({
        buildId: `${stored.id}-replay-${Date.now()}`,
        question: stored.question,
        steps: StepQueue.from(stored.plan.steps),
        frame: () => ({ title: stored.plan.title }),
        writeup: () => Promise.resolve(stored.plan.writeup),
        buildIndex: () => index,
      });
      setBusy(false);
    },
    [builds, busy, log, perform],
  );

  /* ---------- the home page: the chat in the hero ---------- */

  const start = useMutation({ mutationFn: startAskSession });

  const askFromHero = useCallback(
    async (question: string) => {
      if (start.isPending || busy) return;
      setNotice(null);
      setHeroPose("search");
      const result = await start.mutateAsync(question).catch(() => null);
      if (!result || result.status === "empty") {
        setHeroPose("confused");
        setNotice("Ledger couldn't open his books just now. Please try again.");
        return;
      }
      if (result.status === "limited") {
        if (result.sessionId) {
          router.push(`/ask/${result.sessionId}?notice=limited`);
        } else {
          setHeroPose("sleep");
          setNotice(result.message);
        }
        return;
      }

      const id = result.sessionId;
      setSessionId(id);
      // Same screen, new address: a reload or a shared link opens this session.
      window.history.pushState(null, "", `/ask/${id}`);
      log(`$ ledger open-session ${id.slice(0, 8)}`, "info");
      const box = boxRef.current;
      const heroCat = heroCatRef.current;
      const pushed =
        box && heroCat
          ? director.dock({
              box,
              heroCat,
              onLeave: () => setCatLeft(true),
              onPush: () => {
                setPushedIn(true);
                setDocked(true);
              },
              onPushed: () => setInHero(false),
            })
          : Promise.resolve().then(() => {
              setCatLeft(true);
              setDocked(true);
              setInHero(false);
            });
      void build(id, question, pushed);
    },
    [
      build,
      busy,
      director.dock,
      log,
      router,
      start.isPending,
      start.mutateAsync,
    ],
  );

  const desk = useMemo<LedgerDesk>(
    () => ({
      inHero,
      catLeft,
      pose: heroPose,
      pending: start.isPending || busy,
      notice: inHero ? notice : null,
      boxRef,
      catRef: heroCatRef,
      ask: (question) => void askFromHero(question),
      typing: (active) =>
        setHeroPose((pose) =>
          pose === "search" ? pose : active ? "think" : "wave",
        ),
    }),
    [askFromHero, busy, catLeft, heroPose, inHero, notice, start.isPending],
  );

  /* ---------- arriving, leaving ---------- */

  const started = useRef(false);
  useEffect(() => {
    if (started.current || !session) return;
    started.current = true;
    void director.settle(session.builds.length > 0 ? "wave" : "idle");
  }, [director.settle, session]);

  // Back from a session opened on the home page: put the home page back.
  const { stop, restore, catRef } = director;
  useEffect(() => {
    if (session) return;
    const onPop = () => {
      if (window.location.pathname !== "/") return;
      stop();
      restore();
      rewind();
      setDocked(false);
      setPushedIn(false);
      setInHero(true);
      setCatLeft(false);
      setHeroPose("wave");
      setSessionId(null);
      setBuilds([]);
      setLive(null);
      setBusy(false);
      setLines([]);
      lineIds.current = 0;
      if (catRef.current) catRef.current.style.opacity = "0";
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [catRef, restore, rewind, session, stop]);

  // Stop when the screen really goes away, not on Strict Mode's instant
  // cleanup-and-remount in development.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      queueMicrotask(() => {
        if (!mounted.current) stop();
      });
    };
  }, [stop]);

  const messages = useMemo<ChatMessage[]>(() => {
    const list: ChatMessage[] = builds.flatMap((stored, index) => [
      { id: `${stored.id}-q`, role: "visitor" as const, text: stored.question },
      {
        id: `${stored.id}-a`,
        role: "ledger" as const,
        text: stored.plan.answer,
        buildIndex: index,
        notFound: stored.plan.verdict === "not_found",
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

  const narrow =
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 1023px)").matches;

  return (
    <MotionConfig reducedMotion="user">
      <LedgerDeskContext.Provider value={desk}>
        <div
          data-testid="ask-screen"
          data-phase={phase}
          data-busy={busy}
          data-docked={docked}
        >
          {header}
          <div
            ref={director.pageRef}
            className={`transition-[padding] duration-700 ease-out ${docked ? "max-lg:pb-[50vh] lg:pr-[24rem]" : ""}`}
          >
            <main>
              {phase === "answer" && shown ? (
                <AnswerPage
                  question={shown.question}
                  title={shown.title}
                  blocks={shown.blocks}
                  writeup={shown.writeup}
                  typed={typed}
                  sweep={sweep}
                  busy={busy}
                  onReplay={() => {
                    if (shown.buildIndex !== null)
                      void replay(shown.buildIndex);
                  }}
                  onRedo={() => ask(shown.question)}
                />
              ) : null}
              {phase === "stack" ? (
                <Stack
                  question={stackQuestion}
                  items={stacked}
                  building={busy && stacking}
                  stackRef={director.stackRef}
                  slotRef={director.slotRef}
                />
              ) : null}
              <div
                ref={director.copyRef}
                data-testid="page-copy"
                hidden={phase === "answer"}
              >
                {pageCopy}
              </div>
            </main>
            {footer}
          </div>

          {docked && sessionId ? (
            <motion.aside
              ref={director.dockRef}
              aria-label="Ledger's desk"
              data-testid="dock"
              initial={
                pushedIn ? (narrow ? { y: "100%" } : { x: "105%" }) : false
              }
              animate={{ x: 0, y: 0 }}
              transition={{ duration: 0.9, ease: [0.2, 0.8, 0.2, 1] }}
              className="fixed z-30 flex flex-col bg-paper max-lg:inset-x-0 max-lg:bottom-0 max-lg:h-[46vh] max-lg:border-ink max-lg:border-t-2 lg:top-16 lg:right-0 lg:bottom-0 lg:w-[24rem] lg:border-ink lg:border-l-2"
            >
              <ChatPanel
                messages={messages}
                busy={busy}
                notice={notice}
                onAsk={ask}
                onReplay={replay}
                log={lines}
                sessionId={sessionId}
              />
            </motion.aside>
          ) : null}

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
      </LedgerDeskContext.Provider>
    </MotionConfig>
  );
}
