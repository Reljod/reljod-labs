"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { Chapter } from "@/components/motion/chapter";
import {
  bump,
  easeOut,
  mix,
  seg,
  within,
} from "@/components/motion/scroll-math";
import { Icon } from "@/components/ui/icon";
import { sceneNumber, upClose } from "@/content/landing";
import "./landing.css";

/*
 * The documents sit on a square "desk" measured in its own units (0..100 on
 * both axes), so the strings between them can be drawn with fixed numbers.
 */
const ID_BOX = { left: 3, top: 3, width: 62, aspect: 1.586 };
const BILL_BOX = { left: 35, top: 41, width: 62, aspect: 1.12 };

/** The chapter's beats, as windows of its progress. */
const ENTER = [0, 0.12] as const;
const READ_ID = [0.16, 0.29] as const;
const READ_BILL = [0.3, 0.43] as const;
const STRINGS = {
  name: [0.46, 0.54],
  address: [0.55, 0.63],
  expiry: [0.64, 0.7],
} as const;
const STAMP = [0.74, 0.82] as const;
const CAPTIONS = [
  [-1, 0.15],
  [0.15, 0.44],
  [0.44, 0.72],
  [0.72, 2],
] as const;

/**
 * A caption fades in just after its window opens and out just before it
 * closes, so two captions are never on screen together.
 */
function captionOpacity(from: number, to: number): string {
  const fade = 0.025;
  return `calc(${seg(from, from + fade)} * (1 - ${seg(to - fade, to)}))`;
}

/** Up close: the AI reads an ID card and a bill, and strings up what doesn't match. */
export function UpCloseChapter() {
  return (
    <Chapter
      id="how"
      label="Up close: how the AI checks two documents"
      length={3.6}
      overlap
      className="bg-paper"
      stageClassName="bg-paper"
    >
      <div className="mx-auto flex h-full max-w-6xl flex-col gap-4 px-4 py-6 sm:px-6 lg:grid lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:gap-12 lg:py-10">
        <div>
          <p className="eyebrow mb-3 text-ink-muted lg:mb-5">
            {sceneNumber("how")} · Up close
          </p>
          <ol className="relative min-h-[5.5rem] font-mono text-xl leading-[1.15] font-bold uppercase sm:min-h-[7rem] sm:text-3xl lg:min-h-[12rem] lg:text-4xl">
            {upClose.captions.map((caption, index) => {
              const [from, to] = CAPTIONS[index];
              const shown = captionOpacity(from, to);
              return (
                <li
                  key={caption}
                  className="absolute inset-x-0 top-0"
                  style={{
                    opacity: shown,
                    transform: `translateY(calc(0.6em * (1 - ${shown})))`,
                  }}
                >
                  {caption}
                </li>
              );
            })}
          </ol>
          <div aria-hidden="true" className="mt-3 flex gap-2 lg:mt-6">
            {CAPTIONS.map(([from], index) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: one dot per caption.
                key={index}
                className="h-1.5 w-8 bg-ink/15"
              >
                <span
                  className="block h-full origin-left bg-federal-blue"
                  style={{
                    transform: `scaleX(${seg(Math.max(0, from), Math.max(0, from) + 0.06)})`,
                  }}
                />
              </span>
            ))}
          </div>
          <Link
            href="/demos/document-compliance"
            className="eyebrow mt-6 hidden items-center gap-2 font-bold text-federal-blue hover:underline lg:inline-flex"
            style={{ opacity: seg(0.84, 0.94) }}
          >
            Try the real one (ask me for a guest code)
            <Icon name="arrow" size={16} />
          </Link>
        </div>

        <div className="relative min-h-0 flex-1 [container-type:size] lg:aspect-square lg:w-full lg:flex-none">
          <Desk />
        </div>
      </div>
    </Chapter>
  );
}

function Desk() {
  const stamp = easeOut(seg(...STAMP));
  const impact = bump(seg(STAMP[1] - 0.004, STAMP[1] + 0.03));
  const { idCard, bill, findings } = upClose;
  return (
    <div
      role="img"
      aria-label={`An ID card and a utility bill. The AI found: ${findings.name}, ${findings.address}, ${findings.expiry}. Verdict: ${upClose.verdict}.`}
      className="absolute top-1/2 left-1/2 size-[min(100cqw,100cqh)] [container-type:size]"
      style={{
        // The desk jumps as the stamp hits it.
        transform: `translate(-50%, calc(-50% + 1.2cqw * ${impact}))`,
      }}
    >
      <Document
        box={ID_BOX}
        enter={{ x: -6, rotate: -7, settle: -2 }}
        read={READ_ID}
        className="bg-morning-haze"
        header="Republic of Meridia · Identity card"
      >
        <span className="absolute top-[26%] left-[5%] flex h-[58%] w-[25%] items-end justify-center overflow-hidden border-[0.5cqw] border-ink bg-paper">
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
              fill="#1d4e89"
              stroke="#14213d"
              strokeWidth="2"
            />
          </svg>
        </span>
        <Field
          read={READ_ID}
          top={24}
          height={16}
          left={35}
          label="Name"
          value={idCard.name}
        />
        <Field
          read={READ_ID}
          top={42}
          height={14}
          left={35}
          label="Born"
          value={idCard.born}
        />
        <Field
          read={READ_ID}
          top={58}
          height={14}
          left={35}
          label="Address"
          value={idCard.address}
          flag
        />
        <Field
          read={READ_ID}
          top={74}
          height={14}
          left={35}
          label="Expires"
          value={idCard.expires}
          flag
        />
      </Document>

      <Document
        box={BILL_BOX}
        enter={{ x: 8, rotate: 8, settle: 1.5 }}
        read={READ_BILL}
        className="bg-paper"
        header="Port Selene Power & Water"
      >
        <span className="absolute top-[18%] left-[7%] font-mono text-[1.9cqw] tracking-[0.1em] text-ink-muted uppercase">
          Billed to
        </span>
        <Field
          read={READ_BILL}
          top={23}
          height={11}
          left={6}
          label=""
          value={bill.name}
          flag
        />
        <Field
          read={READ_BILL}
          top={34}
          height={11}
          left={6}
          label=""
          value={bill.address}
          flag
        />
        <Field
          read={READ_BILL}
          top={52}
          height={10}
          left={6}
          label="Period"
          value={bill.period}
        />
        <Field
          read={READ_BILL}
          top={64}
          height={10}
          left={6}
          label="Amount due"
          value={bill.due}
        />
        <span className="absolute right-[7%] bottom-[8%] left-[7%] flex h-[14%] items-end gap-[3%]">
          {[40, 55, 35, 70, 60, 90].map((height, index) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: decorative bars.
              key={index}
              className="flex-1 border-[0.35cqw] border-ink bg-limestone"
              style={{ height: `${height}%` }}
            />
          ))}
        </span>
      </Document>

      <svg
        aria-hidden="true"
        viewBox="0 0 100 100"
        className="pointer-events-none absolute inset-0 size-full overflow-visible"
        fill="none"
      >
        <Thread
          d="M61 15.5 C 64 15.5, 64 10, 67 10 M82.5 14 C 84 30, 82 50, 73.5 57.6"
          window={STRINGS.name}
        />
        <Thread
          d="M61 28.4 C 64 28.4, 64 23, 67 23 M82.5 27 C 88 42, 84 58, 73.5 63.2"
          window={STRINGS.address}
        />
        <Thread d="M34.5 34.7 C 30 40, 20 40, 18 46" window={STRINGS.expiry} />
      </svg>

      <Chip left={67} top={6} window={STRINGS.name}>
        {findings.name}
      </Chip>
      <Chip left={67} top={19} window={STRINGS.address}>
        {findings.address}
      </Chip>
      <Chip left={2} top={46} window={STRINGS.expiry}>
        {findings.expiry}
      </Chip>

      {/* The verdict lands in the empty corner, clear of the evidence. */}
      <span
        className="absolute top-[76%] left-[18%] flex flex-col items-center border-[0.9cqw] border-seal-red bg-paper/70 px-[2.2cqw] py-[1.2cqw] font-mono leading-none font-bold whitespace-nowrap text-seal-red uppercase mix-blend-multiply outline-[0.4cqw] outline-offset-[0.6cqw] outline-seal-red outline-solid"
        style={{
          opacity: seg(STAMP[0], within(...STAMP, 0.3)),
          transform: `translate(-50%, -50%) rotate(-8deg) scale(${mix(2.6, 1, stamp)})`,
        }}
      >
        <span className="text-[8cqw] tracking-[0.12em]">
          {upClose.verdict.split(" · ")[0]}
        </span>
        <span className="mt-[1cqw] text-[3cqw] tracking-[0.1em]">
          {upClose.verdict.split(" · ")[1]}
        </span>
      </span>
    </div>
  );
}

function Document({
  box,
  enter,
  read,
  header,
  className,
  children,
}: {
  box: { left: number; top: number; width: number; aspect: number };
  enter: { x: number; rotate: number; settle: number };
  read: readonly [number, number];
  header: string;
  className: string;
  children: ReactNode;
}) {
  const t = easeOut(seg(...ENTER));
  const sweep = seg(...read);
  return (
    <div
      className={`absolute overflow-hidden border-[0.5cqw] border-ink shadow-[1cqw_1cqw_0_var(--color-ink)] ${className}`}
      style={{
        left: `${box.left}%`,
        top: `${box.top}%`,
        width: `${box.width}%`,
        aspectRatio: box.aspect,
        transform: `translateX(${mix(enter.x, 0, t, "cqw")}) rotate(${mix(enter.rotate, enter.settle, t, "deg")})`,
      }}
    >
      <span className="absolute inset-x-0 top-0 flex h-[16%] items-center bg-ink px-[5%] font-mono text-[2.1cqw] font-bold tracking-[0.12em] text-paper uppercase">
        {header}
      </span>
      <span className="pointer-events-none absolute right-[4%] bottom-[5%] -rotate-12 font-mono text-[3.2cqw] font-bold tracking-[0.2em] text-seal-red/25">
        SPECIMEN
      </span>
      {children}
      {/* The reading line passing down the page. */}
      <span
        className="pointer-events-none absolute inset-x-0 h-[10%] border-federal-blue border-b-[0.5cqw] bg-linear-to-b from-transparent to-clear-sky/55"
        style={{
          top: "-10%",
          transform: `translateY(calc(1100% * ${sweep}))`,
          opacity: bump(sweep),
        }}
      />
    </div>
  );
}

function Field({
  read,
  top,
  height,
  left,
  label,
  value,
  flag = false,
}: {
  read: readonly [number, number];
  top: number;
  height: number;
  left: number;
  label: string;
  value: string;
  /** Turns red once the strings go up: this line doesn't match. */
  flag?: boolean;
}) {
  const centre = (top + height / 2) / 100;
  const lit = seg(
    within(...read, centre - 0.05),
    within(...read, centre + 0.05),
  );
  const red = flag ? seg(STRINGS.name[0], STRINGS.expiry[1]) : "0";
  return (
    <span
      className="field absolute right-[5%] flex flex-col justify-center px-[1.2%]"
      style={
        {
          top: `${top}%`,
          height: `${height}%`,
          left: `${left}%`,
          "--lit": lit,
          "--red": red,
        } as CSSProperties
      }
    >
      {label ? (
        <span className="relative font-mono text-[max(7.5px,1.7cqw)] leading-none tracking-[0.1em] text-ink-muted uppercase">
          {label}
        </span>
      ) : null}
      <span className="relative truncate font-mono text-[max(9.5px,2.9cqw)] leading-tight font-bold">
        {value}
      </span>
    </span>
  );
}

function Thread({
  d,
  window,
}: {
  d: string;
  window: readonly [number, number];
}) {
  return (
    <path
      d={d}
      pathLength={1}
      className="drawn"
      stroke="#b23a2b"
      strokeWidth="0.7"
      strokeLinecap="round"
      style={{ "--draw": seg(...window) } as CSSProperties}
    />
  );
}

function Chip({
  left,
  top,
  window,
  children,
}: {
  left: number;
  top: number;
  window: readonly [number, number];
  children: ReactNode;
}) {
  const pop = seg(window[1] - 0.02, window[1] + 0.02);
  return (
    <span
      className="absolute flex h-[8%] w-[31%] items-center gap-[1.4cqw] border-[0.5cqw] border-ink bg-paper px-[1.6cqw] text-[2.7cqw] leading-tight font-semibold shadow-[0.7cqw_0.7cqw_0_var(--color-ink)]"
      style={{
        left: `${left}%`,
        top: `${top}%`,
        opacity: pop,
        transform: `scale(calc(0.6 + 0.4 * ${pop} + 0.12 * ${bump(pop)}))`,
      }}
    >
      <span className="size-[1.8cqw] shrink-0 rounded-full border-[0.4cqw] border-ink bg-seal-red" />
      {children}
    </span>
  );
}
