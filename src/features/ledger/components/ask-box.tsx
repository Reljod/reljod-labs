"use client";

import { useMutation } from "@tanstack/react-query";
import { animate, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { QueryProvider } from "@/features/document-compliance/components/query-provider";
import { cleanQuestion, MAX_QUESTION_LENGTH } from "../domain/presets";
import { startAskSession } from "../server/actions";
import { Cat, type CatPose } from "./cat";
import { PresetChips } from "./preset-chips";

const GREETING_MS = 2700;
const TYPING_DEBOUNCE_MS = 400;

/** The hero's chat box: Ask Ledger anything, and he rebuilds the site to answer. */
export function AskBox() {
  return (
    <QueryProvider>
      <AskForm />
    </QueryProvider>
  );
}

function AskForm() {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const catRef = useRef<HTMLDivElement>(null);
  const [question, setQuestion] = useState("");
  const [pose, setPose] = useState<CatPose>("wave");
  const [typing, setTyping] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setPose("idle"), GREETING_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!typing) return;
    const timer = setTimeout(() => setTyping(false), TYPING_DEBOUNCE_MS * 3);
    return () => clearTimeout(timer);
  }, [typing]);

  /** He crouches, then gallops off the box toward the page he's about to rebuild. */
  async function runOff() {
    const cat = catRef.current;
    if (!cat || reduceMotion) return;
    setPose("idle");
    cat.firstElementChild?.classList.add("lgr-crouch");
    await new Promise((resolve) => setTimeout(resolve, 260));
    cat.firstElementChild?.classList.remove("lgr-crouch");
    setPose("run");
    await animate(
      cat,
      { x: window.innerWidth },
      { duration: 0.9, ease: [0.45, 0.05, 0.25, 1] },
    );
  }

  const ask = useMutation({
    mutationFn: startAskSession,
    onSuccess: async (result, asked) => {
      if (result.status === "started") {
        await runOff();
        router.push(
          `/ask/${result.sessionId}?ask=${encodeURIComponent(asked)}`,
        );
        // Next keeps this page mounted, hidden, for the Back button: be back on the box by then.
        setTimeout(() => {
          if (catRef.current)
            void animate(catRef.current, { x: 0 }, { duration: 0 });
          setQuestion("");
          setPose("idle");
          ask.reset();
        }, 1200);
      } else if (result.status === "limited" && result.sessionId) {
        router.push(`/ask/${result.sessionId}?notice=limited`);
      } else if (result.status === "limited") {
        setPose("sleep");
        setNotice(result.message);
      }
    },
    onError: () => {
      setPose("confused");
      setNotice("Ledger couldn't open his books just now. Please try again.");
    },
  });

  function submit(text: string) {
    const clean = cleanQuestion(text);
    if (!clean || ask.isPending) return;
    setNotice(null);
    setPose("search");
    ask.mutate(clean);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    submit(question);
  }

  const shownPose: CatPose =
    ask.isPending || ask.isSuccess ? pose : typing ? "think" : pose;

  return (
    <aside
      aria-label="Ask Ledger"
      data-testid="ask-box"
      className="outline-box relative mt-16 bg-paper shadow-hard-lg lg:mt-0"
    >
      <div
        ref={catRef}
        data-testid="ledger-cat"
        data-pose={shownPose}
        className="pointer-events-none absolute -top-[5.5rem] right-6"
      >
        <div className="lgr-body">
          <Cat pose={shownPose} size={96} />
        </div>
      </div>
      <div className="flex items-center justify-between gap-4 border-ink border-b-2 bg-morning-haze px-6 py-4">
        <p className="eyebrow">Ledger · Front desk</p>
        <span className="outline-box eyebrow rounded-sm bg-paper px-2 py-0.5">
          Ask
        </span>
      </div>
      <div className="p-6">
        <h2 className="text-[1.375rem] leading-snug font-semibold">
          Ask me anything about Reljod's work.
        </h2>
        <p className="mt-2 text-sm text-ink-muted">
          I'll take this site apart and rebuild it into your answer, using only
          what it says.
        </p>
        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-3">
          <label htmlFor="ask-input" className="sr-only">
            Your question
          </label>
          <textarea
            id="ask-input"
            data-testid="ask-input"
            rows={2}
            maxLength={MAX_QUESTION_LENGTH}
            value={question}
            placeholder="Where has Reljod worked?"
            onChange={(event) => {
              setQuestion(event.target.value);
              setTyping(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit(question);
              }
            }}
            className="outline-box w-full resize-none rounded-sm bg-marble px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-federal-blue"
          />
          <button
            type="submit"
            data-testid="ask-send"
            disabled={ask.isPending || !cleanQuestion(question)}
            className="outline-box press min-h-11 self-end rounded-sm bg-federal-blue px-5 font-mono text-sm font-bold tracking-[0.1em] text-paper uppercase disabled:opacity-50"
          >
            {ask.isPending ? "Opening books…" : "Ask Ledger"}
          </button>
        </form>
        {notice ? (
          <p aria-live="polite" className="mt-4 text-sm text-seal-red">
            {notice}
          </p>
        ) : null}
        <div className="mt-6 border-ink border-t-2 pt-4">
          <p className="eyebrow mb-3 text-ink-muted">Or try</p>
          <PresetChips onPick={submit} disabled={ask.isPending} />
        </div>
      </div>
    </aside>
  );
}
