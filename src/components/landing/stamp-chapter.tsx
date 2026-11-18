"use client";

import type { CSSProperties } from "react";
import { Chapter } from "@/components/motion/chapter";
import {
  bump,
  easeOut,
  mix,
  seg,
  within,
} from "@/components/motion/scroll-math";
import { labFacts, sceneNumber, stamps } from "@/content/landing";
import "./landing.css";

/** When each stamp comes down, and where it lands on the page. */
const DROPS = [
  {
    from: 0.12,
    to: 0.24,
    x: 34,
    y: 58,
    rotate: -12,
    color: "var(--color-federal-blue)",
  },
  {
    from: 0.38,
    to: 0.5,
    x: 26,
    y: 31,
    rotate: 18,
    color: "var(--color-seal-red)",
  },
  { from: 0.64, to: 0.76, x: 62, y: 72, rotate: -5, color: "var(--color-ivy)" },
] as const;

/** The page jolts as each stamp hits it. */
const jolt = DROPS.map((drop) =>
  bump(seg(drop.to - 0.005, drop.to + 0.04)),
).join(" + ");

/** What reljod.com is: three facts, each stamped onto a Meridia passport as you scroll. */
export function StampChapter() {
  return (
    <Chapter
      id="lab"
      label="What this site is"
      length={3.2}
      overlap
      className="bg-morning-haze"
      stageClassName="bg-morning-haze"
    >
      <div className="mx-auto flex h-full max-w-6xl flex-col gap-4 px-4 py-5 sm:px-6 lg:grid lg:grid-cols-[1.1fr_0.9fr] lg:grid-rows-[minmax(0,1fr)] lg:items-center lg:gap-14 lg:py-10">
        <div className="lg:order-1">
          <p className="eyebrow mb-2 text-ink-muted lg:mb-5">
            {sceneNumber("lab")} · What this site is
          </p>
          <h2 className="font-mono text-[clamp(1.35rem,min(5vw,5svh),2.25rem)] leading-[1.1] font-bold uppercase">
            A workshop, not a brochure.
          </h2>
          <p className="mt-3 hidden text-lg leading-relaxed lg:block">
            Reljod Labs is where I build AI for banks in the open, so you can
            try it instead of reading about it.
          </p>
          <ol className="mt-4 space-y-2 lg:mt-8 lg:space-y-4">
            {labFacts.map((fact, index) => {
              const drop = DROPS[index];
              const on = seg(drop.to - 0.02, drop.to + 0.03);
              return (
                <li
                  key={fact.title}
                  className="flex gap-3 border-ink border-l-4 bg-paper/0 py-1 pl-3 lg:gap-4 lg:pl-4"
                  style={{
                    opacity: `calc(0.3 + 0.7 * ${on})`,
                    borderColor: drop.color,
                    transform: `translateX(calc(0.6rem * (1 - ${on})))`,
                  }}
                >
                  <span>
                    <span className="block font-mono text-sm font-bold uppercase lg:text-base">
                      {fact.title}
                    </span>
                    <span className="mt-0.5 block text-sm leading-snug text-ink-muted lg:text-base [@media(max-width:1023px)_and_(max-height:740px)]:sr-only">
                      {fact.body}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="relative min-h-0 flex-1 [container-type:size] lg:order-2 lg:h-full lg:w-full lg:flex-none">
          <Passport />
        </div>
      </div>
    </Chapter>
  );
}

function Passport() {
  return (
    <div
      role="img"
      aria-label={`A Meridia passport page for nobody, stamped ${stamps.join(", ")}.`}
      className="absolute top-1/2 left-1/2 aspect-[4/5] w-[min(100cqw,80cqh)] [container-type:inline-size]"
      style={{ transform: `translate(-50%, calc(-50% + 1.4cqh * (${jolt})))` }}
    >
      <div className="outline-box absolute inset-0 flex flex-col overflow-hidden bg-marble shadow-hard-lg">
        <span className="block bg-federal-blue px-[6cqw] py-[3cqw] font-mono text-[3.6cqw] font-bold tracking-[0.12em] text-paper">
          REPUBLIC OF MERIDIA · PASSPORT
        </span>
        <span className="flex gap-[5cqw] p-[6cqw]">
          <span className="flex aspect-[4/5] w-[30cqw] shrink-0 items-end justify-center overflow-hidden border-[0.8cqw] border-ink bg-paper">
            <svg aria-hidden="true" viewBox="0 0 40 50" className="w-full">
              <circle
                cx="20"
                cy="19"
                r="9"
                fill="#d9a84e"
                stroke="#14213d"
                strokeWidth="2"
              />
              <path
                d="M4 50 C 6 36, 34 36, 36 50"
                fill="#b23a2b"
                stroke="#14213d"
                strokeWidth="2"
              />
            </svg>
          </span>
          <span className="flex min-w-0 flex-col gap-[2cqw] font-mono text-[3.4cqw] leading-tight">
            <Field label="Surname" value="NOBODY" />
            <Field label="Given names" value="ANY ONE" />
            <Field label="Nationality" value="MERIDIAN" />
            <Field label="Real person?" value="NO" />
          </span>
        </span>
        <span className="mx-[6cqw] mt-auto mb-[6cqw] block border-ink/30 border-t-2 pt-[4cqw] font-mono text-[2.8cqw] break-all text-ink-muted">
          P&lt;MDANOBODY&lt;&lt;ANY&lt;ONE&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;
          <br />
          0000000000MDA0000000&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;
        </span>
      </div>

      {DROPS.map((drop, index) => {
        const fall = seg(drop.from, drop.to);
        const land = easeOut(fall);
        const splash = seg(drop.to - 0.005, drop.to + 0.05);
        return (
          <span key={stamps[index]} aria-hidden="true">
            {/* Ink flecks thrown out where it hit. */}
            {[0, 1, 2, 3, 4].map((fleck) => (
              <span
                key={fleck}
                className="absolute size-[1.4cqw] rounded-full"
                style={{
                  left: `${drop.x}%`,
                  top: `${drop.y}%`,
                  background: drop.color,
                  opacity: `calc(${splash} * 0.8)`,
                  transform: `rotate(${fleck * 72 + drop.rotate * 3}deg) translateX(calc(${mix(4, 17 + (fleck % 2) * 6, splash, "cqw")})) scale(calc(1 - 0.5 * ${splash}))`,
                }}
              />
            ))}
            <span
              className="stamp absolute border-[0.9cqw] px-[2.6cqw] py-[0.8cqw] font-mono text-[7.2cqw] leading-none font-bold tracking-[0.08em] whitespace-nowrap uppercase mix-blend-multiply"
              style={
                {
                  "--ink": drop.color,
                  left: `${drop.x}%`,
                  top: `${drop.y}%`,
                  opacity: seg(drop.from, within(drop.from, drop.to, 0.25)),
                  transform: `translate(-50%, -50%) rotate(${drop.rotate}deg) scale(${mix(3.2, 1, land)})`,
                } as CSSProperties
              }
            >
              {stamps[index]}
            </span>
          </span>
        );
      })}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <span className="block">
      <span className="block text-[2.4cqw] tracking-[0.1em] text-ink-muted uppercase">
        {label}
      </span>
      <span className="block font-bold">{value}</span>
    </span>
  );
}
