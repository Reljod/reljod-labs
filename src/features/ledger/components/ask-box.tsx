"use client";

import { animate, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import type { StartAskResult } from "../domain/api";
import { cleanQuestion, MAX_QUESTION_LENGTH } from "../domain/presets";
import { startAskSession } from "./api";
import { Cat, type CatPose } from "./cat";
import { PresetChips } from "./preset-chips";

const GREETING_MS = 2700;
const TYPING_DEBOUNCE_MS = 400;

/** The hero's chat box: Ask Ledger anything, and he rebuilds the site to answer. */
export function AskBox() {
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

  /** Puts him back on the box at once, in `next`. */
  function comeBack(next: CatPose) {
    if (catRef.current) void animate(catRef.current, { x: 0 }, { duration: 0 });
    setPose(next);
  }

  // The box stays busy from the first click until the session page takes
  // over (or the ask fails), so a second click cannot open a second session.
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  function release() {
    sending.current = false;
    setBusy(false);
  }

  /**
   * He sets off the moment the question is sent: the gallop and opening the
   * Ask session run side by side, and the session page is prefetched while he
   * runs, so neither waits on the other.
   */
  async function send(asked: string) {
    const sessionHref = (id: string) =>
      `/ask/${id}?ask=${encodeURIComponent(asked)}`;
    const opening = startAskSession(asked).then(
      (started): StartAskResult | null => {
        if (started.status === "started") {
          router.prefetch(sessionHref(started.sessionId));
        }
        return started;
      },
      () => null,
    );
    // Both settle before he is called back, so a fast failure cannot send
    // him galloping off after he is back on the box.
    const [result] = await Promise.all([opening, runOff()]);
    if (!result) {
      release();
      comeBack("confused");
      setNotice("Ledger couldn't open his books just now. Please try again.");
      return;
    }

    if (result.status === "started") {
      router.push(sessionHref(result.sessionId));
      // Next keeps this page mounted, hidden, for the Back button: be back on the box by then.
      setTimeout(() => {
        comeBack("idle");
        setQuestion("");
        release();
      }, 1200);
    } else if (result.status === "limited" && result.sessionId) {
      router.push(`/ask/${result.sessionId}?notice=limited`);
      setTimeout(() => {
        comeBack("idle");
        release();
      }, 1200);
    } else if (result.status === "limited") {
      comeBack("sleep");
      setNotice(result.message);
      release();
    } else {
      comeBack("idle");
      release();
    }
  }

  function submit(text: string) {
    const clean = cleanQuestion(text);
    if (!clean || sending.current) return;
    sending.current = true;
    setBusy(true);
    setNotice(null);
    setPose("search");
    void send(clean);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    submit(question);
  }

  const shownPose: CatPose = busy ? pose : typing ? "think" : pose;

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
            disabled={busy || !cleanQuestion(question)}
            aria-busy={busy}
            className="outline-box press min-h-11 self-end rounded-sm bg-federal-blue px-5 font-mono text-sm font-bold tracking-[0.1em] text-paper uppercase disabled:opacity-50"
          >
            {busy ? "Opening books…" : "Ask Ledger"}
          </button>
        </form>
        {notice ? (
          <p aria-live="polite" className="mt-4 text-sm text-seal-red">
            {notice}
          </p>
        ) : null}
        <div className="mt-6 border-ink border-t-2 pt-4">
          <p className="eyebrow mb-3 text-ink-muted">Or try</p>
          <PresetChips onPick={submit} disabled={busy} />
        </div>
      </div>
    </aside>
  );
}
