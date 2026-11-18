"use client";

import Link from "next/link";
import { ScrollIn } from "@/components/motion/scroll-in";
import { Icon } from "@/components/ui/icon";
import { finale, sceneNumber } from "@/content/landing";

/** The end of the tour: it slides over the last chapter and offers three ways on. */
export function Finale() {
  return (
    <section
      id="finale"
      aria-labelledby="finale-title"
      className="slide-over relative border-ink border-t-2 bg-marble"
    >
      <div className="mx-auto flex min-h-[calc(100svh-4.125rem)] max-w-6xl flex-col justify-center px-4 py-16 sm:px-6">
        <p className="eyebrow mb-3 text-ink-muted">
          {sceneNumber("finale")} · {finale.title.split(".")[0]}
        </p>
        <h2
          id="finale-title"
          className="max-w-3xl font-mono text-3xl leading-[1.08] font-bold uppercase sm:text-5xl"
        >
          {finale.title}
        </h2>
        <ul className="mt-10 grid gap-6 md:grid-cols-3">
          {finale.doors.map((door, index) => (
            <ScrollIn
              key={door.href}
              as="li"
              lean={(index - 1) * 2}
              className="min-w-0"
            >
              <Link
                href={door.href}
                className={`group outline-box flex h-full flex-col p-6 shadow-hard-md transition-[translate,box-shadow] duration-200 hover:-translate-x-1 hover:-translate-y-1 hover:shadow-hard-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-federal-blue ${index === 0 ? "bg-ink text-paper" : "bg-paper"}`}
              >
                <span
                  className={`font-mono text-sm font-bold ${index === 0 ? "text-brass" : "text-federal-blue"}`}
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="mt-4 font-mono text-xl leading-tight font-bold uppercase">
                  {door.label}
                </span>
                <span
                  className={`mt-2 flex-1 ${index === 0 ? "text-marble" : "text-ink-muted"}`}
                >
                  {door.body}
                </span>
                <Icon
                  name="arrow"
                  size={20}
                  className="mt-6 transition-transform group-hover:translate-x-1"
                />
              </Link>
            </ScrollIn>
          ))}
        </ul>
      </div>
    </section>
  );
}
