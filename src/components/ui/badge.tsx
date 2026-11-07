import type { ReactNode } from "react";

const tones = {
  paper: "bg-paper text-ink",
  haze: "bg-morning-haze text-ink",
  limestone: "bg-limestone text-ink",
  brass: "bg-brass text-ink",
  ink: "bg-ink text-paper",
} as const;

export type BadgeTone = keyof typeof tones;

export function Badge({
  tone = "paper",
  children,
}: {
  tone?: BadgeTone;
  children: ReactNode;
}) {
  return (
    <span
      className={`outline-box eyebrow inline-flex items-center rounded-sm px-2 py-0.5 ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
