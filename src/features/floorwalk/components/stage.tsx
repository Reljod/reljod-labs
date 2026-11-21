"use client";

import { AnimatePresence, motion } from "motion/react";
import { type RefObject, useEffect, useState } from "react";
import type { Moment } from "../domain/api";
import { ruleById, type Standard } from "../domain/rules";
import type { Finding, Noticed } from "../domain/walk";
import { clock, SEVERITY_COLOR, severityOf } from "./look";

type Overlay = {
  id: string;
  box: readonly number[];
  color: string;
  label: string;
  sub?: string;
};

/** How long around its second a box stays on the video. */
const BEFORE = 0.9;
const AFTER = 2.2;

const near = (time: number, at: number) =>
  time >= at - BEFORE && time <= at + AFTER;

/**
 * The footage, with what the Walker saw drawn over it as the playhead
 * passes: corner brackets snap onto each problem and a tag names the Rule.
 * While the Walker is still watching, a beam sweeps the frame.
 */
export function Stage({
  videoRef,
  src,
  poster,
  time,
  watching,
  readHead,
  seconds,
  findings,
  noticed,
  moments,
  standard,
  onTime,
  onPlaying,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  src: string;
  poster?: string;
  time: number;
  watching: boolean;
  readHead: number;
  seconds: number;
  findings: Finding[];
  noticed: Noticed[];
  moments: Moment[];
  standard: Standard;
  onTime: (t: number) => void;
  onPlaying: (playing: boolean) => void;
}) {
  const overlays: Overlay[] = [];
  for (const finding of findings) {
    const times = [finding.at, ...finding.alsoAt];
    const hit = times.find((at) => near(time, at));
    if (hit === undefined) continue;
    const rule = ruleById(finding.rule);
    overlays.push({
      id: `${finding.id}-${hit}`,
      box: finding.box,
      color: SEVERITY_COLOR[severityOf(finding, standard)],
      label: rule?.title ?? finding.rule,
      sub: finding.saw,
    });
  }
  for (const item of noticed)
    if (item.box && near(time, item.at))
      overlays.push({
        id: item.id,
        box: item.box,
        color: "#4a4f5b",
        label: "Noticed · no Rule",
        sub: item.saw,
      });
  moments.forEach((moment, i) => {
    if (moment.box && near(time, moment.at))
      overlays.push({
        id: `m${i}-${moment.at}`,
        box: moment.box,
        color: "#2f6b3f",
        label: moment.label || "Answer",
        sub: "",
      });
  });

  return (
    <div className="fw-stage relative aspect-video w-full overflow-hidden rounded-sm bg-ink outline-box">
      <video
        ref={videoRef}
        key={src}
        src={src}
        poster={poster}
        muted
        playsInline
        preload="auto"
        className="absolute inset-0 h-full w-full object-contain"
        onTimeUpdate={(e) => onTime(e.currentTarget.currentTime)}
        onSeeked={(e) => onTime(e.currentTarget.currentTime)}
        onPlay={() => onPlaying(true)}
        onPause={() => onPlaying(false)}
        onEnded={() => onPlaying(false)}
        data-testid="floorwalk-video"
      />
      {watching ? <WatchBeam readHead={readHead} seconds={seconds} /> : null}
      <AnimatePresence>
        {overlays.map((o) => (
          <Bracket key={o.id} overlay={o} />
        ))}
      </AnimatePresence>
      <div className="pointer-events-none absolute bottom-2 left-2 rounded-sm bg-ink/80 px-2 py-1 font-mono text-[11px] text-paper">
        {clock(time)} / {clock(seconds)}
      </div>
    </div>
  );
}

function Bracket({ overlay }: { overlay: Overlay }) {
  const [top, left, bottom, right] = overlay.box as [
    number,
    number,
    number,
    number,
  ];
  const flip = top > 0.7;
  return (
    <motion.div
      className="pointer-events-none absolute"
      style={{
        top: `${top * 100}%`,
        left: `${left * 100}%`,
        width: `${(right - left) * 100}%`,
        height: `${(bottom - top) * 100}%`,
      }}
      initial={{ opacity: 0, scale: 1.35 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.92 }}
      transition={{ type: "spring", stiffness: 420, damping: 26 }}
    >
      <div
        className="fw-bracket absolute inset-0"
        style={{ color: overlay.color }}
      >
        <span />
        <span />
        <span />
        <span />
      </div>
      <div
        className="absolute inset-0 fw-bracket-fill"
        style={{ background: overlay.color }}
      />
      <motion.div
        initial={{ opacity: 0, y: flip ? 6 : -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12 }}
        className="absolute left-0 max-w-[22rem] min-w-[9rem] rounded-sm border-2 border-ink px-2 py-1 font-mono text-[11px] leading-tight text-paper shadow-hard-sm"
        style={{
          background: overlay.color,
          [flip ? "bottom" : "top"]: "calc(100% + 6px)",
        }}
      >
        <strong className="block uppercase tracking-[0.06em]">
          {overlay.label}
        </strong>
        {overlay.sub ? (
          <span className="mt-0.5 block font-sans text-[11px] opacity-95">
            {overlay.sub}
          </span>
        ) : null}
      </motion.div>
    </motion.div>
  );
}

/** A beam sweeping the frame while the model watches, with the furthest second it has written about. */
function WatchBeam({
  readHead,
  seconds,
}: {
  readHead: number;
  seconds: number;
}) {
  const [dots, setDots] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setDots((d) => (d + 1) % 4), 400);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className="pointer-events-none absolute inset-0">
      <div className="fw-beam absolute inset-y-0 w-1/3" />
      <div className="fw-scanlines absolute inset-0" />
      <div className="absolute top-2 right-2 flex items-center gap-2 rounded-sm border-2 border-ink bg-brass px-2 py-1 font-mono text-[11px] font-bold text-ink shadow-hard-sm">
        <span className="fw-rec" />
        GEMINI 4 NEON IS WATCHING{".".repeat(dots)}
        {seconds ? (
          <span className="opacity-70">
            {Math.round((readHead / seconds) * 100)}%
          </span>
        ) : null}
      </div>
    </div>
  );
}
