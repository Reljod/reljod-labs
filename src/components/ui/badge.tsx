import type { ReactNode } from "react";

const tones = {
  paper: "bg-paper text-ink",
  haze: "bg-morning-haze text-ink",
  sky: "bg-clear-sky text-ink",
  limestone: "bg-limestone text-ink",
  brass: "bg-brass text-ink",
  ink: "bg-ink text-paper",
} as const;

export type BadgeTone = keyof typeof tones;

/** "md" for cards and lists; "sm" for tight rows such as a demo's bar. */
const sizes = {
  md: "outline-box eyebrow px-2 py-0.5",
  sm: "border border-ink px-1.5 py-px font-mono text-[10px] leading-4 font-bold tracking-[0.1em] uppercase",
} as const;

export function Badge({
  tone = "paper",
  size = "md",
  children,
}: {
  tone?: BadgeTone;
  size?: keyof typeof sizes;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-sm ${sizes[size]} ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
