"use client";

import { useState } from "react";
import { TONE_HEX } from "../domain/categories";

const TONES = [
  TONE_HEX["federal-blue"],
  TONE_HEX.ivy,
  TONE_HEX.oak,
  TONE_HEX["seal-red"],
  TONE_HEX.ink,
];

export function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

/** The client's portrait, with a monogram while it loads or when there is none. */
export function Portrait({
  name,
  url,
  size = "md",
  building = false,
  className = "",
}: {
  name: string;
  url: string | null;
  size?: "sm" | "md" | "lg" | "xl";
  building?: boolean;
  className?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const tone =
    TONES[
      [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) %
        TONES.length
    ];
  const box = {
    sm: "size-10 text-sm",
    md: "size-16 text-xl",
    lg: "size-24 text-3xl",
    xl: "size-full text-5xl",
  }[size];
  return (
    <span className={`relative inline-flex shrink-0 ${box} ${className}`}>
      {building ? (
        <span
          aria-hidden="true"
          className="cm-building-ring absolute -inset-1.5 rounded-full"
        />
      ) : null}
      <span
        className="relative flex size-full items-center justify-center overflow-hidden rounded-full border-2 border-ink font-mono font-bold text-paper"
        style={{ background: tone }}
      >
        <span aria-hidden={!!url && loaded && !failed}>{initialsOf(name)}</span>
        {url && !failed ? (
          // biome-ignore lint/performance/noImgElement: signed Storage URLs change hourly; next/image would cache and re-sign them for nothing
          <img
            src={url}
            alt={`Portrait of ${name}`}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            className={`absolute inset-0 size-full object-cover transition-[opacity,transform] duration-700 ${loaded ? "scale-100 opacity-100" : "scale-110 opacity-0"}`}
          />
        ) : null}
      </span>
    </span>
  );
}
