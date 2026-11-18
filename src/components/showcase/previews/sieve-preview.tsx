import type { CSSProperties } from "react";

const LOOP_SECONDS = 5.6;

/** Names the Readers pull off the pages, in the order they turn up. */
const NAMES = [
  { name: "Halvard Okonjo", page: 12 },
  { name: "Brightwater Holdings", page: 87 },
  { name: "H. Okonjo", page: 214 },
  { name: "Selene Port Trust", page: 361 },
  { name: "Mireille Danvers", page: 498 },
];

const bloom = (index: number): CSSProperties => ({
  animationDelay: `${0.5 + index * 0.6}s`,
  animationDuration: `${LOOP_SECONDS}s`,
});

/** Sieve in miniature: a 500-page file fans out, and every name it names lands in the list. */
export function SievePreview() {
  return (
    <div
      aria-hidden="true"
      className="relative flex aspect-[960/726] gap-[4%] overflow-hidden bg-marble p-[5%]"
    >
      <div className="relative flex-1">
        {[0, 1, 2, 3, 4].map((sheet) => (
          <div
            key={sheet}
            className="outline-box absolute inset-y-[4%] w-[62%] bg-paper p-[5%] shadow-hard-sm"
            style={{
              left: `${sheet * 8}%`,
              top: `${sheet * 3}%`,
              rotate: `${(sheet - 2) * 2}deg`,
            }}
          >
            {sheet === 4 ? (
              <div className="space-y-[6%]">
                <p className="font-mono text-[0.5rem] font-bold">
                  p. 214 / 500
                </p>
                {[90, 70, 84, 60, 76, 88, 52].map((width, line) => (
                  <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: decorative lines.
                    key={line}
                    className={`block h-1.5 ${line === 3 ? "bg-brass motion-safe:animate-bloom" : "bg-ink/20"}`}
                    style={{
                      width: `${width}%`,
                      ...(line === 3 ? bloom(2) : {}),
                    }}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ))}
        <div className="absolute inset-x-0 h-0.5 bg-federal-blue/70 motion-safe:animate-scan-sweep" />
      </div>

      <div className="outline-box flex w-[38%] flex-col bg-paper shadow-hard-md">
        <p className="border-ink border-b-2 bg-ink px-[6%] py-[3%] font-mono text-[0.5rem] font-bold tracking-[0.08em] text-paper uppercase">
          Names found
        </p>
        <ul className="flex-1 divide-y divide-ink/20">
          {NAMES.map((entry, index) => (
            <li
              key={entry.name}
              className="flex items-baseline justify-between gap-1 px-[6%] py-[3%] motion-safe:animate-bloom"
              style={bloom(index)}
            >
              <span className="truncate text-[0.55rem] font-semibold">
                {entry.name}
              </span>
              <span className="shrink-0 font-mono text-[0.45rem] text-ink-muted">
                p.{entry.page}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
