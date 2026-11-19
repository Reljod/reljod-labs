"use client";

import { useCopyMotion } from "@/components/motion/copy-motion";
import "./about.css";

/**
 * Every demo's name on a reel that runs along the foot of the demos door, on
 * the moving About page only (and not with reduced motion). Decoration: the
 * door's own words already say where it goes.
 */
export function DemoReel({ titles }: { titles: string[] }) {
  const animated = useCopyMotion();
  // Two copies back to back, so sliding by half loops without a seam.
  const reel = [...titles, ...titles];
  return (
    <div
      aria-hidden="true"
      data-animated={animated ? "" : undefined}
      className="overflow-hidden border-brass/60 border-t-2 bg-federal-blue py-3"
    >
      <div className="demo-reel">
        {reel.map((title, index) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: the reel repeats titles on purpose.
            key={index}
            className="flex shrink-0 items-center gap-6 pr-6 font-mono text-sm font-bold tracking-[0.08em] text-marble uppercase"
          >
            {title}
            <span className="text-brass">✦</span>
          </span>
        ))}
      </div>
    </div>
  );
}
