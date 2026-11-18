"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { type SceneId, sceneNumber, scenes } from "@/content/landing";
import { PauseGlyph, PlayGlyph, useTourPlayer } from "./tour-player";

/**
 * The page's index, always a thumb away: which scene you are in, how far
 * along the page you are, and a list to jump to any scene.
 */
export function SceneIndex() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<SceneId>("top");
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);

  // The scene crossing the middle of the screen is the current one.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setCurrent(entry.target.id as SceneId);
        }
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    for (const scene of scenes) {
      const element = document.getElementById(scene.id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const range =
          document.documentElement.scrollHeight - window.innerHeight;
        const progress = range > 0 ? Math.min(1, window.scrollY / range) : 0;
        // Written straight to the bar so scrolling never re-renders the index.
        if (barRef.current)
          barRef.current.style.transform = `scaleX(${progress})`;
      });
    };
    measure();
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, []);

  // Escape or a tap outside closes the list.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !panelRef.current?.contains(target) &&
        !buttonRef.current?.contains(target)
      )
        setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const total = String(scenes.length).padStart(2, "0");
  const tour = useTourPlayer();

  return (
    <nav
      aria-label="Page index"
      className="fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 flex flex-col items-end gap-3 sm:right-6"
    >
      <AnimatePresence>
        {open ? (
          <motion.div
            ref={panelRef}
            id="scene-index-list"
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97 }}
            transition={{ duration: 0.18 }}
            className="outline-box w-64 origin-bottom-right bg-paper shadow-hard-lg"
          >
            <p className="eyebrow border-ink border-b-2 bg-ink px-4 py-2 text-paper">
              Jump to
            </p>
            <ol>
              {scenes.map((scene) => {
                const here = scene.id === current;
                return (
                  <li key={scene.id}>
                    <a
                      href={`#${scene.id}`}
                      aria-current={here ? "location" : undefined}
                      onClick={() => setOpen(false)}
                      className={`flex items-center gap-3 px-4 py-2.5 hover:bg-morning-haze focus-visible:bg-morning-haze focus-visible:outline-none ${here ? "font-bold" : ""}`}
                    >
                      <span
                        className={`font-mono text-sm ${here ? "text-federal-blue" : "text-ink-muted"}`}
                      >
                        {sceneNumber(scene.id)}
                      </span>
                      {scene.title}
                      {here ? (
                        <span
                          aria-hidden="true"
                          className="ml-auto size-2 rounded-full bg-brass"
                        />
                      ) : null}
                    </a>
                  </li>
                );
              })}
            </ol>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="flex items-stretch gap-2">
        <button
          type="button"
          onClick={tour.toggle}
          aria-pressed={tour.playing}
          data-tour-control=""
          aria-label={tour.playing ? "Pause the tour" : "Play the tour"}
          className={`play-tour outline-box press flex min-h-11 items-center gap-2 rounded-sm px-3 font-mono text-sm font-bold uppercase tracking-[0.1em] ${tour.playing ? "bg-ink text-paper" : "bg-brass text-ink"}`}
        >
          {tour.playing ? <PauseGlyph /> : <PlayGlyph />}
          <span className="hidden sm:inline">
            {tour.playing ? "Pause" : "Play"}
          </span>
        </button>
        <button
          ref={buttonRef}
          type="button"
          aria-expanded={open}
          aria-controls="scene-index-list"
          onClick={() => setOpen((value) => !value)}
          className="outline-box press relative flex min-h-11 items-center gap-3 overflow-hidden rounded-sm bg-paper px-4 font-mono text-sm font-bold uppercase tracking-[0.1em]"
        >
          <span>Index</span>
          <span className="text-federal-blue">
            {sceneNumber(current)}/{total}
          </span>
          <span
            ref={barRef}
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 h-1 origin-left scale-x-0 bg-brass"
          />
        </button>
      </div>
    </nav>
  );
}
