"use client";

import { animate } from "motion";
import { useEffect, useRef } from "react";

/**
 * A number that counts to its new value instead of jumping. Renders a
 * `<tspan>` inside SVG text, a `<span>` elsewhere. The value is always in the
 * markup, so the count is decoration only.
 */
export function Counter({
  value,
  decimals = 0,
  svg = true,
  prefix = "",
  suffix = "",
}: {
  value: number;
  decimals?: number;
  svg?: boolean;
  prefix?: string;
  suffix?: string;
}) {
  const ref = useRef<HTMLSpanElement & SVGTSpanElement>(null);
  const shown = useRef(value);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const from = shown.current;
    const controls = animate(from, value, {
      duration: 0.9,
      ease: [0.2, 0.8, 0.2, 1],
      onUpdate: (latest) => {
        shown.current = latest;
        // Write into the text node React owns, so React's own update still lands.
        const text = node.firstChild;
        if (text)
          text.nodeValue = `${prefix}${latest.toFixed(decimals)}${suffix}`;
      },
    });
    return () => controls.stop();
  }, [value, decimals, prefix, suffix]);
  const text = `${prefix}${value.toFixed(decimals)}${suffix}`;
  return svg ? <tspan ref={ref}>{text}</tspan> : <span ref={ref}>{text}</span>;
}
