"use client";

import { useId } from "react";
import { SPEEDS } from "./scrub";
import { Button, cx } from "./ui";
import type { Player } from "./use-player";

/**
 * Steps through a Run's Frames: a range over them, back and forward, play
 * and pause, speed, and "Live" to snap back to the newest Frame while the Run
 * is going. Scrubbing never stops the Run.
 */
export function Scrubber({
  player,
  count,
  going,
}: {
  player: Player;
  count: number;
  going: boolean;
}) {
  const id = useId();
  const head = Math.max(0, count - 1);
  const none = count === 0;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          aria-label="Previous Frame"
          disabled={none || player.index === 0}
          onClick={() => player.step(-1)}
        >
          ◀
        </Button>
        <Button
          size="sm"
          variant="primary"
          className="w-20"
          disabled={count < 2}
          onClick={player.toggle}
        >
          {player.playing ? "Pause" : "Play"}
        </Button>
        <Button
          size="sm"
          aria-label="Next Frame"
          disabled={none || player.index >= head}
          onClick={() => player.step(1)}
        >
          ▶
        </Button>
        <label htmlFor={id} className="sr-only">
          Frame
        </label>
        {/* A range input steps with the left and right arrows when it has focus. */}
        <input
          id={id}
          type="range"
          min={0}
          max={head}
          step={1}
          value={player.index}
          disabled={count < 2}
          aria-valuetext={`Frame ${player.index + 1} of ${count}`}
          onChange={(event) => player.seek(Number(event.target.value))}
          className="op-range min-w-0 flex-1"
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-[0.7rem]">
        <span className="tabular-nums text-ink-muted">
          {none ? "No Frames yet" : `Frame ${player.index + 1} of ${count}`}
        </span>
        <fieldset className="ml-auto flex items-center gap-1">
          <legend className="sr-only">Replay speed</legend>
          {SPEEDS.map((speed) => (
            <button
              key={speed}
              type="button"
              aria-pressed={player.speed === speed}
              onClick={() => player.setSpeed(speed)}
              className={cx(
                "h-7 rounded-sm border-2 border-ink px-2 font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-federal-blue",
                player.speed === speed
                  ? "bg-ink text-paper"
                  : "bg-paper text-ink hover:bg-morning-haze",
              )}
            >
              {speed}x
            </button>
          ))}
        </fieldset>
        {going ? (
          <Button
            size="sm"
            variant={player.following ? "ghost" : "danger"}
            disabled={player.following}
            onClick={player.goLive}
          >
            {player.following ? "Following live" : "Live"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
