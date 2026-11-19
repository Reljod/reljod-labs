"use client";

import { useEffect, useState } from "react";

/** "19 Nov, 14:05:09" in the reader's own zone: for real instants (when a row was written). */
const STAMP = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Bank time is Meridia's (UTC). */
const BANK_STAMP = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

export const formatStamp = (iso: string) => STAMP.format(new Date(iso));
export const formatBankStamp = (iso: string) =>
  BANK_STAMP.format(new Date(iso));

/** "in 3 h", "2 min ago", "now": how far an instant is from `now`. */
export function relativeTime(iso: string, now: number): string {
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff);
  const future = diff > 0;
  const say = (value: number, unit: string) =>
    future ? `in ${value} ${unit}` : `${value} ${unit} ago`;
  if (abs < 45_000) return "now";
  if (abs < 3_600_000) return say(Math.round(abs / 60_000), "min");
  if (abs < 86_400_000) return say(Math.round(abs / 3_600_000), "h");
  return say(Math.round(abs / 86_400_000), "d");
}

/** The current time, ticking every `everyMs`, so relative times stay true. */
export function useNow(everyMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}
