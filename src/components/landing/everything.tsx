"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Peel } from "@/components/motion/peel";
import { ScrollIn } from "@/components/motion/scroll-in";
import { BrowserFrame } from "@/components/showcase/browser-frame";
import { Icon, IconTile } from "@/components/ui/icon";
import { LiveBadge } from "@/components/ui/live-badge";
import { ProjectMarks } from "@/components/ui/project-marks";
import { demoProblems, sceneNumber } from "@/content/landing";
import { liveDemos } from "@/content/projects";
import type { Project } from "@/content/types";
import { demoPreviews } from "./demo-previews";

const number = (index: number) => String(index + 1).padStart(2, "0");

/** Wide cards: the first and last, so seven fill three columns evenly. */
const wide = (index: number) => index === 0 || index === liveDemos.length - 1;

/** After the tour: every demo on one plain, scrollable page. */
export function Everything() {
  return (
    <section
      id="everything"
      aria-labelledby="everything-title"
      className="border-ink border-t-2 bg-marble"
    >
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
        <header className="mb-12 max-w-3xl lg:mb-16">
          <p className="eyebrow mb-3 text-ink-muted">
            {sceneNumber("everything")} · Everything, laid out
          </p>
          <h2
            id="everything-title"
            className="font-mono text-3xl leading-[1.1] font-bold uppercase sm:text-5xl"
          >
            <Peel
              text="That's the tour. Here's everything, at your own pace."
              timing={{ on: "scroll" }}
            />
          </h2>
          <p className="mt-5 text-lg text-ink-muted">
            Seven working demos: real AI over made-up paperwork. They open with
            a guest code, so ask me for one.
          </p>
        </header>

        <ol className="grid gap-x-6 gap-y-10 md:grid-cols-2 lg:grid-cols-3">
          {liveDemos.map((demo, index) => (
            <ScrollIn
              key={demo.slug}
              as="li"
              lean={index % 2 === 0 ? -2 : 2}
              className={wide(index) ? "md:col-span-2" : ""}
            >
              <DemoCard demo={demo} index={index} />
            </ScrollIn>
          ))}
        </ol>
      </div>
    </section>
  );
}

function DemoCard({ demo, index }: { demo: Project; index: number }) {
  const href = demo.href ?? "#everything";
  return (
    <Link
      href={href}
      className="group outline-box flex h-full flex-col bg-paper shadow-hard-md transition-[translate,box-shadow] duration-200 hover:-translate-x-1 hover:-translate-y-1 hover:shadow-hard-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-federal-blue"
    >
      <div
        className={`grid flex-1 ${wide(index) ? "lg:grid-cols-[1.1fr_1fr]" : ""}`}
      >
        <div className="border-ink border-b-2 bg-limestone p-4 lg:p-5">
          <BrowserFrame address={href}>
            <LazyPreview demo={demo} />
          </BrowserFrame>
        </div>
        <div className="flex flex-col p-5">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-bold text-federal-blue">
              {number(index)}
            </span>
            <span className="eyebrow text-ink-muted">· {demo.sector}</span>
            <span className="ml-auto flex items-center gap-2">
              <ProjectMarks marks={demo.marks} />
              <LiveBadge />
            </span>
          </div>
          <h3 className="mt-3 font-mono text-xl leading-tight font-bold uppercase">
            {demo.title}
          </h3>
          <p className="mt-2 leading-snug">“{demoProblems[demo.slug]}”</p>
          <p className="mt-2 text-sm text-ink-muted">{demo.summary}</p>
          <span className="eyebrow mt-auto flex items-center gap-2 pt-4 font-bold text-federal-blue">
            Open the demo
            <Icon
              name="arrow"
              size={16}
              className="transition-transform group-hover:translate-x-1"
            />
          </span>
        </div>
      </div>
    </Link>
  );
}

/** Mounts the moving preview only when it's near the screen. */
function LazyPreview({ demo }: { demo: Project }) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => setNear(entry.isIntersecting),
      { rootMargin: "200px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref}>
      {near ? (
        demoPreviews[demo.slug]?.(demo)
      ) : (
        <div className="flex aspect-[960/726] items-center justify-center bg-marble">
          <IconTile name={demo.icon} />
        </div>
      )}
    </div>
  );
}
