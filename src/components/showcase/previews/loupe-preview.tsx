import type { CSSProperties } from "react";

const LOOP_SECONDS = 5.6;

const bloom = (index: number): CSSProperties => ({
  animationDelay: `${0.6 + index * 0.7}s`,
  animationDuration: `${LOOP_SECONDS}s`,
});

const ROWS = [
  ["Basic salary", "4,200.00"],
  ["Overtime", "310.50"],
  ["Income tax", "-702.10"],
  ["Net pay", "4,810.50"],
];

/** Loupe in miniature: a payslip is swept, one figure is boxed, and the measured value lands beside it. */
export function LoupePreview() {
  return (
    <div
      aria-hidden="true"
      className="relative flex aspect-[960/726] gap-[4%] overflow-hidden bg-marble p-[5%]"
    >
      <div className="outline-box relative flex-1 bg-paper p-[5%] shadow-hard-md">
        <p className="font-mono text-[0.5rem] font-bold tracking-[0.08em] uppercase">
          Payslip · Specimen
        </p>
        <ul className="mt-[8%] space-y-[7%]">
          {ROWS.map(([label, amount], index) => (
            <li
              key={label}
              className="relative flex items-baseline justify-between gap-2 text-[0.55rem]"
            >
              <span className="text-ink-muted">{label}</span>
              <span className="font-mono font-semibold">{amount}</span>
              {index === 3 ? (
                <span
                  className="absolute -inset-x-[3%] -inset-y-[35%] border-2 border-seal-red bg-seal-red/10 shadow-hard-sm motion-safe:animate-bloom"
                  style={bloom(1)}
                />
              ) : null}
            </li>
          ))}
        </ul>
        <div className="absolute inset-x-0 h-0.5 bg-federal-blue/70 motion-safe:animate-scan-sweep" />
      </div>

      <div className="outline-box flex w-[40%] flex-col bg-paper shadow-hard-md">
        <p className="border-ink border-b-2 bg-ink px-[6%] py-[3%] font-mono text-[0.5rem] font-bold tracking-[0.08em] text-paper uppercase">
          Measured by code
        </p>
        <ul className="flex-1 divide-y divide-ink/20 text-[0.5rem]">
          {[
            ["Lines sum to", "3,808.40"],
            ["Printed", "4,810.50"],
            ["Noise", "6.2× quieter"],
          ].map(([label, value], index) => (
            <li
              key={label}
              className="flex items-baseline justify-between gap-1 px-[6%] py-[4%] motion-safe:animate-bloom"
              style={bloom(index)}
            >
              <span className="text-ink-muted">{label}</span>
              <span className="font-mono font-semibold">{value}</span>
            </li>
          ))}
        </ul>
        <p
          className="m-[6%] border-2 border-ink bg-seal-red px-[6%] py-[3%] text-center font-mono text-[0.55rem] font-bold tracking-[0.12em] text-paper uppercase motion-safe:animate-bloom"
          style={bloom(3)}
        >
          Tampered
        </p>
      </div>
    </div>
  );
}
