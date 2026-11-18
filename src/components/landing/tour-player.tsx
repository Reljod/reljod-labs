"use client";

import { useEffect, useRef, useState } from "react";

/** How long the whole tour takes to play by itself, top to finale. */
const TOUR_MS = 60_000;
/** It eases in over this long instead of lurching off. */
const RAMP_MS = 900;
const COMMAND = "tour:command";
const STATE = "tour:state";

type Command = "play" | "pause" | "toggle";

/** Ask the page's tour player (in the Index) to play, pause or toggle. */
export function commandTour(command: Command) {
  window.dispatchEvent(new CustomEvent<Command>(COMMAND, { detail: command }));
}

/** Whether the tour is playing by itself, for any button that shows it. */
export function useTourPlaying(): boolean {
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const onState = (event: Event) =>
      setPlaying((event as CustomEvent<boolean>).detail);
    window.addEventListener(STATE, onState);
    return () => window.removeEventListener(STATE, onState);
  }, []);
  return playing;
}

/** Where the tour ends: the top of the finale. */
function tourEnd(): number {
  const finale = document.getElementById("finale");
  const bottom = document.documentElement.scrollHeight - window.innerHeight;
  return finale ? Math.min(bottom, finale.offsetTop) : bottom;
}

/**
 * Plays the tour hands-free: scrolls the page from wherever it is to the
 * finale at a steady pace, so every chapter plays as if you were scrolling.
 * Any wheel, touch or key press hands control straight back. Mount once, in
 * the Index.
 */
export function useTourPlayer(): {
  playing: boolean;
  toggle: () => void;
} {
  const [playing, setPlaying] = useState(false);
  const frame = useRef(0);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent<boolean>(STATE, { detail: playing }));
    if (!playing) return;

    const end = tourEnd();
    // From the finale (or past it), play again from the top.
    if (window.scrollY >= end - 4)
      window.scrollTo({ top: 0, behavior: "instant" });
    const from = window.scrollY;
    const speed = end / TOUR_MS; // px per ms, the same pace wherever it starts
    let y = from;
    let last = performance.now();
    const started = last;

    const tick = (now: number) => {
      const ramp = Math.min(1, (now - started) / RAMP_MS);
      y = Math.min(end, y + speed * ramp * ramp * (now - last));
      last = now;
      window.scrollTo({ top: y, behavior: "instant" });
      if (y >= end) setPlaying(false);
      else frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);

    const stop = () => setPlaying(false);
    const onKey = (event: KeyboardEvent) => {
      // Tab moves focus without scrolling, and the tour's own buttons
      // handle their keys themselves; anything else takes over.
      const own = (event.target as Element | null)?.closest?.(
        "[data-tour-control]",
      );
      if (event.key !== "Tab" && !own) stop();
    };
    window.addEventListener("wheel", stop, { passive: true });
    window.addEventListener("touchstart", stop, { passive: true });
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame.current);
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchstart", stop);
      window.removeEventListener("keydown", onKey);
    };
  }, [playing]);

  useEffect(() => {
    const onCommand = (event: Event) => {
      const command = (event as CustomEvent<Command>).detail;
      setPlaying((now) => (command === "toggle" ? !now : command === "play"));
    };
    window.addEventListener(COMMAND, onCommand);
    return () => window.removeEventListener(COMMAND, onCommand);
  }, []);

  return { playing, toggle: () => setPlaying((now) => !now) };
}

/** The opening's big button: plays the whole tour by itself. */
export function PlayTourButton() {
  const playing = useTourPlaying();
  return (
    <button
      type="button"
      onClick={() => commandTour("toggle")}
      aria-pressed={playing}
      data-tour-control=""
      className="play-tour outline-box press group relative inline-flex min-h-14 items-center gap-4 rounded-sm bg-brass py-2.5 pr-6 pl-3 text-left text-ink shadow-hard-md"
    >
      <span
        aria-hidden="true"
        className="flex size-10 shrink-0 items-center justify-center border-2 border-ink bg-ink text-paper"
      >
        {playing ? <PauseGlyph /> : <PlayGlyph />}
      </span>
      <span>
        <span className="block font-mono text-base leading-tight font-bold tracking-[0.08em] uppercase">
          {playing ? "Pause the tour" : "Play the tour"}
        </span>
        <span className="block text-xs font-semibold">
          {playing
            ? "Scroll or press a key to take over"
            : "About a minute, hands-free"}
        </span>
      </span>
    </button>
  );
}

export function PlayGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4">
      <path d="M4 2.5v11l9-5.5z" fill="currentColor" />
    </svg>
  );
}

export function PauseGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4">
      <path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z" fill="currentColor" />
    </svg>
  );
}
