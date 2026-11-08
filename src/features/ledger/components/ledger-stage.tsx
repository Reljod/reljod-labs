"use client";

import type { Ref } from "react";
import { BlockView } from "./block-view";
import { Cat } from "./cat";
import type { CatView, Flight, Fx, Print } from "./use-director";

type LedgerStageProps = {
  cat: CatView;
  size: number;
  flight: Flight | null;
  fx: Fx[];
  prints: Print[];
  catRef: Ref<HTMLDivElement>;
  flightRef: Ref<HTMLDivElement>;
};

const PUFFS = ["s1", "s2", "s3", "s4", "s5"];

/**
 * The layer Ledger performs on: fixed over the page, never catching clicks.
 * The director moves the cat and the block in flight; this only draws them.
 */
export function LedgerStage({
  cat,
  size,
  flight,
  fx,
  prints,
  catRef,
  flightRef,
}: LedgerStageProps) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-40 overflow-hidden"
    >
      {prints.map((print) => (
        <svg
          key={print.id}
          aria-hidden="true"
          className="print"
          viewBox="0 0 20 20"
          style={{
            left: print.x,
            top: print.y,
            rotate: `${print.rotate}deg`,
            animationDelay: `${print.delay}s`,
          }}
        >
          <ellipse cx="10" cy="13" rx="4.5" ry="4" fill="#14213d" />
          <circle cx="5" cy="7" r="2" fill="#14213d" />
          <circle cx="10" cy="5" r="2" fill="#14213d" />
          <circle cx="15" cy="7" r="2" fill="#14213d" />
        </svg>
      ))}

      {fx.map((item) => (
        <div
          key={item.id}
          className={`fx ${item.kind}`}
          style={{ left: item.x, top: item.y }}
        >
          {PUFFS.map((puff) => (
            <span key={puff} className={puff} />
          ))}
          {item.text ? <span className="t">{item.text}</span> : null}
        </div>
      ))}

      {flight ? (
        <div
          ref={flightRef}
          data-testid="flying-block"
          className="absolute top-0 left-0 opacity-0 shadow-hard-md"
          style={{ width: flight.width }}
        >
          <BlockView block={flight.block} size="compact" />
        </div>
      ) : null}

      <div
        ref={catRef}
        data-testid="ledger-cat"
        data-pose={cat.pose}
        className="absolute top-0 left-0 opacity-0"
        style={{ width: size }}
      >
        {cat.say ? (
          <p
            data-testid="ledger-says"
            className={`outline-box absolute bottom-full mb-1 w-max max-w-56 rounded-sm bg-paper px-2 py-1 font-mono text-xs font-bold shadow-hard-sm ${cat.sayAlign === "right" ? "right-0" : "left-0"}`}
          >
            {cat.say}
          </p>
        ) : null}
        <div key={cat.bodyKey} className={`lgr-body ${cat.body}`}>
          <Cat pose={cat.pose} flip={cat.flip} rot={cat.rot} size={size} />
        </div>
      </div>
    </div>
  );
}
