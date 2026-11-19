"use client";

import { useCallback, useEffect, useState } from "react";
import { catchUpMs, clampIndex, dwellMs, type Speed } from "./scrub";

export type Player = {
  /** The Frame on screen, as an index into the Run's Frames. */
  index: number;
  /** Snapped to the newest Frame of a Run that is going. */
  following: boolean;
  playing: boolean;
  speed: Speed;
  seek: (index: number) => void;
  step: (delta: number) => void;
  toggle: () => void;
  goLive: () => void;
  setSpeed: (speed: Speed) => void;
};

/**
 * Which Frame the screen shows. A Run that is going is followed: the screen
 * walks to the newest Frame one Action at a time, so a burst is still seen.
 * Scrubbing lets go of the live edge without stopping the Run; "Live" snaps
 * back. A finished Run plays at the recorded pace, sped up on request.
 * Mount it once the Run's Frames are known (key it by the Run).
 */
export function usePlayer(
  frames: readonly { at: number }[],
  going: boolean,
  startAt: "first" | "last",
): Player {
  const count = frames.length;
  const [raw, setRaw] = useState(() =>
    startAt === "first" ? 0 : Math.max(0, count - 1),
  );
  const [following, setFollowing] = useState(going);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const index = clampIndex(raw, count);
  const head = Math.max(0, count - 1);

  useEffect(() => {
    if (!(following || playing) || index >= head) return;
    const wait = following
      ? catchUpMs(head - index)
      : dwellMs(frames, index, speed);
    const timer = setTimeout(() => setRaw(index + 1), wait);
    return () => clearTimeout(timer);
  }, [following, playing, index, head, frames, speed]);

  // Playing to the newest Frame: a Run that is going is then followed, a finished one stops.
  useEffect(() => {
    if (!playing || index < head) return;
    setPlaying(false);
    if (going) setFollowing(true);
  }, [playing, index, head, going]);

  useEffect(() => {
    if (!going) setFollowing(false);
  }, [going]);

  const seek = useCallback(
    (to: number) => {
      setFollowing(false);
      setPlaying(false);
      setRaw(clampIndex(to, count));
    },
    [count],
  );

  return {
    index,
    following,
    playing,
    speed,
    seek,
    step: (delta) => seek(index + delta),
    toggle: () => {
      if (playing) {
        setPlaying(false);
        return;
      }
      setFollowing(false);
      // Play from the end starts over.
      if (index >= head && !going) setRaw(0);
      setPlaying(true);
    },
    goLive: () => {
      setPlaying(false);
      setFollowing(going);
      setRaw(head);
    },
    setSpeed,
  };
}
