"use client";

import { motion } from "motion/react";
import { type PointerEvent, useRef } from "react";
import type { Moment } from "../domain/api";
import type { Standard } from "../domain/rules";
import type { Finding, Noticed } from "../domain/walk";
import { clock, SEVERITY_COLOR, severityOf, zoneTint } from "./look";

/**
 * The walk as a strip of time: the zones the Walker named, a diamond for each
 * Finding, the video's playhead and, racing it, the Walker's read head: the
 * furthest second the model has written about.
 */
export function Timeline({
  seconds,
  time,
  readHead,
  showReadHead,
  zones,
  findings,
  noticed,
  moments,
  standard,
  onSeek,
}: {
  seconds: number;
  time: number;
  readHead: number;
  showReadHead: boolean;
  zones: { at: number; zone: string }[];
  findings: Finding[];
  noticed: Noticed[];
  moments: Moment[];
  standard: Standard;
  onSeek: (t: number) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const total = Math.max(seconds, 1);
  const pct = (t: number) =>
    `${Math.min(100, Math.max(0, (t / total) * 100))}%`;
  const seekFrom = (event: PointerEvent<HTMLDivElement>) => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect) return;
    onSeek(((event.clientX - rect.left) / rect.width) * total);
  };

  return (
    <div className="select-none">
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label="Footage time"
        aria-valuemin={0}
        aria-valuemax={Math.round(total)}
        aria-valuenow={Math.round(time)}
        aria-valuetext={clock(time)}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          seekFrom(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons) seekFrom(e);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") onSeek(Math.min(total, time + 1));
          if (e.key === "ArrowLeft") onSeek(Math.max(0, time - 1));
        }}
        className="relative h-[4.5rem] cursor-pointer rounded-sm border-2 border-ink bg-paper"
        data-testid="floorwalk-timeline"
      >
        {/* Zones the Walker named. */}
        <div className="absolute inset-x-0 top-0 h-6 overflow-hidden border-ink border-b">
          {zones.map((zone, i) => {
            const end = zones[i + 1]?.at ?? total;
            return (
              <motion.div
                key={`${zone.at}-${zone.zone}`}
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                style={{
                  left: pct(zone.at),
                  width: `calc(${pct(end)} - ${pct(zone.at)})`,
                  background: zoneTint(zone.zone),
                  transformOrigin: "left",
                }}
                className="absolute inset-y-0 truncate border-ink/30 border-r px-1.5 font-mono text-[10px] leading-6 font-bold uppercase"
              >
                {zone.zone}
              </motion.div>
            );
          })}
        </div>
        {/* Seconds. */}
        {Array.from({ length: Math.floor(total / 5) + 1 }, (_, i) => i * 5).map(
          (s) => (
            <div
              key={s}
              className="absolute bottom-0 h-1.5 border-ink/40 border-l"
              style={{ left: pct(s) }}
            >
              <span className="absolute top-[-14px] left-1 font-mono text-[9px] text-ink-muted">
                {clock(s)}
              </span>
            </div>
          ),
        )}
        {/* What the Walker reported. */}
        {findings.map((finding) => (
          <motion.button
            type="button"
            key={finding.id}
            initial={{ y: -30, opacity: 0, rotate: 45 }}
            animate={{ y: 0, opacity: 1, rotate: 45 }}
            transition={{ type: "spring", stiffness: 500, damping: 18 }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onSeek(Math.max(0, finding.at - 0.6))}
            title={finding.saw}
            className="absolute top-8 z-10 h-4 w-4 -translate-x-1/2 border-2 border-ink shadow-hard-sm"
            style={{
              left: pct(finding.at),
              background: SEVERITY_COLOR[severityOf(finding, standard)],
            }}
          />
        ))}
        {noticed.map((item) => (
          <div
            key={item.id}
            title={item.saw}
            className="absolute top-9 h-2.5 w-2.5 -translate-x-1/2 rounded-full border-2 border-ink bg-paper"
            style={{ left: pct(item.at) }}
          />
        ))}
        {moments.map((moment) => (
          <div
            key={`${moment.at}-${moment.label}`}
            className="absolute top-12 h-2.5 w-2.5 -translate-x-1/2 bg-ivy"
            style={{ left: pct(moment.at) }}
          />
        ))}
        {showReadHead ? (
          <motion.div
            className="fw-readhead pointer-events-none absolute inset-y-0 z-20 w-0.5"
            animate={{ left: pct(readHead) }}
            transition={{ type: "spring", stiffness: 120, damping: 20 }}
          >
            <span className="absolute -top-5 -translate-x-1/2 rounded-sm bg-brass px-1 font-mono text-[9px] font-bold whitespace-nowrap text-ink">
              WALKER
            </span>
          </motion.div>
        ) : null}
        <div
          className="pointer-events-none absolute inset-y-0 z-30 w-0.5 bg-ink"
          style={{ left: pct(time) }}
        >
          <span className="absolute -bottom-1 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 bg-ink" />
        </div>
      </div>
    </div>
  );
}
