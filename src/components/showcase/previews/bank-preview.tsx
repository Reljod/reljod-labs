import type { CSSProperties } from "react";

const LOOP_SECONDS = 5.6;

/** One Entry in miniature: what a card payment posts, debit first. */
const POSTINGS = [
  {
    account: "10 0000 0427",
    name: "Mara Voss · current",
    side: "D",
    amount: "84.20",
  },
  { account: "GL 2100", name: "Card settlement", side: "C", amount: "84.20" },
];

/** Growth rings behind the ledger: the radii, inner first. The outermost is the newest. */
const RINGS = [14, 22, 29, 35, 42, 50, 57];

/** Paired with `motion-safe:animate-bloom` (5.6 s, the loop): when in the loop it lands. */
const appear = (delay: number): CSSProperties => ({
  animationDelay: `${delay}s`,
});

/**
 * Tidewater Bank in miniature: an Entry's debit and credit postings land one
 * after the other, the difference stamps 0.00, and the bank's growth rings
 * sit behind, the newest one growing in. CSS only, so the catalog can pause
 * it until the card is hovered.
 */
export function BankPreview() {
  return (
    <div
      aria-hidden="true"
      className="relative flex aspect-[960/726] items-center justify-center overflow-hidden bg-marble p-[6%]"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 120 120"
        className="absolute -right-[8%] -bottom-[14%] h-[95%] text-ink"
      >
        {RINGS.map((radius, index) => (
          <circle
            key={radius}
            cx="60"
            cy="60"
            r={radius}
            fill="none"
            stroke={
              index === RINGS.length - 1
                ? "var(--color-federal-blue)"
                : "currentColor"
            }
            strokeOpacity={index === RINGS.length - 1 ? 1 : 0.18 + index * 0.05}
            strokeWidth={index === RINGS.length - 1 ? 2 : 1}
            className={
              index === RINGS.length - 1
                ? "motion-safe:animate-bloom"
                : undefined
            }
            style={index === RINGS.length - 1 ? appear(2.6) : undefined}
          />
        ))}
        <circle cx="60" cy="60" r="5" fill="currentColor" />
      </svg>

      <div className="outline-box relative w-[78%] rounded-sm bg-paper shadow-hard-md">
        <div className="flex items-center gap-2 border-ink border-b-2 bg-ink px-[4%] py-[2.5%] font-mono text-[0.5rem] font-bold tracking-[0.08em] text-paper uppercase">
          <span>Entry #1042</span>
          <span className="ml-auto opacity-70">card settlement · 19 Nov</span>
        </div>
        <ul className="divide-y divide-ink/15">
          {POSTINGS.map((posting, index) => (
            <li
              key={posting.side}
              className="flex items-baseline gap-2 px-[4%] py-[3%] motion-safe:animate-bloom"
              style={appear(0.4 + index * 0.7)}
            >
              <span className="w-[32%] shrink-0 truncate font-mono text-[0.45rem] text-ink-muted">
                {posting.account}
              </span>
              <span
                className={`min-w-0 flex-1 truncate text-[0.55rem] ${posting.side === "C" ? "pl-[6%]" : ""}`}
              >
                {posting.name}
              </span>
              <span className="w-[22%] text-right font-mono text-[0.55rem] font-bold tabular-nums">
                {posting.side === "D" ? posting.amount : ""}
              </span>
              <span className="w-[22%] text-right font-mono text-[0.55rem] font-bold tabular-nums">
                {posting.side === "C" ? posting.amount : ""}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex items-baseline justify-between border-ink border-t-2 bg-marble px-[4%] py-[3%] font-mono text-[0.5rem] font-bold uppercase">
          <span className="tracking-[0.08em]">Difference</span>
          <span
            className="text-[0.75rem] text-ivy tabular-nums motion-safe:animate-bloom"
            style={appear(1.8)}
          >
            0.00
          </span>
        </div>
        <span
          className="absolute -top-[14%] -right-[6%] rounded-sm border-[3px] border-ivy bg-paper/80 px-2 py-0.5 font-mono text-[0.7rem] font-bold tracking-[0.14em] text-ivy uppercase motion-safe:opacity-0"
          style={{
            animationName: "preview-stamp",
            animationDuration: `${LOOP_SECONDS}s`,
            animationIterationCount: "infinite",
            animationTimingFunction: "ease-out",
          }}
        >
          Balanced
        </span>
      </div>
    </div>
  );
}
