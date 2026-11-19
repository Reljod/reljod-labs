"use client";

import { animate, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import {
  countMarks,
  FONT_STACKS,
  type Mark,
  type MarkKind,
  type Swatch,
  type TypeStep,
} from "../domain/drawing";
import type { Measurement } from "../domain/ruler";
import { percent } from "../domain/ruler";
import type { PassRecord } from "./use-trace";

/** A number that rolls to its new value. */
export function CountUp({
  value,
  format = (n) => String(Math.round(n)),
  className,
}: {
  value: number;
  format?: (value: number) => string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reduce) {
      setShown(value);
      from.current = value;
      return;
    }
    const controls = animate(from.current, value, {
      duration: 0.9,
      ease: [0.2, 0.8, 0.2, 1],
      onUpdate: setShown,
    });
    from.current = value;
    return () => controls.stop();
  }, [value, reduce]);
  return <span className={className}>{format(shown)}</span>;
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="eyebrow mb-2 text-[0.65rem] font-bold text-ink-muted">
      {children}
    </p>
  );
}

/** The colours the Draftsman read off the screen, dropped onto the table like paint chips. */
export function Palette({ palette }: { palette: Swatch[] }) {
  return (
    <div>
      <Eyebrow>Palette it read</Eyebrow>
      {palette.length === 0 ? (
        <p className="font-mono text-[0.7rem] text-ink-muted">
          Waiting for the first colour…
        </p>
      ) : (
        <ul className="grid grid-cols-4 gap-2" data-testid="vellum-palette">
          {palette.map((swatch, index) => (
            <motion.li
              key={swatch.hex}
              initial={{ y: -40, opacity: 0, rotate: index % 2 ? 8 : -8 }}
              animate={{ y: 0, opacity: 1, rotate: index % 2 ? 1.5 : -1.5 }}
              transition={{ type: "spring", stiffness: 420, damping: 18 }}
              className="flex flex-col"
              title={swatch.role}
            >
              <span
                className="vellum-chip outline-box block aspect-square w-full rounded-sm"
                style={{ background: swatch.hex }}
              />
              <span className="mt-1 truncate font-mono text-[0.6rem] font-bold">
                {swatch.hex}
              </span>
              <span className="truncate font-mono text-[0.55rem] text-ink-muted">
                {swatch.role}
              </span>
            </motion.li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Every text style it found, each set at its own size against a ruler. */
export function TypeScale({ steps }: { steps: TypeStep[] }) {
  const largest = Math.max(1, ...steps.map((step) => step.size));
  return (
    <div>
      <Eyebrow>Type it measured</Eyebrow>
      {steps.length === 0 ? (
        <p className="font-mono text-[0.7rem] text-ink-muted">
          No text styles yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {steps.map((step, index) => (
            <motion.li
              // biome-ignore lint/suspicious/noArrayIndexKey: steps only ever grow, in order.
              key={index}
              initial={{ x: 30, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 24 }}
              className="flex items-end gap-2 border-ink/20 border-b pb-1"
            >
              <span
                className="w-12 shrink-0 leading-none"
                style={{
                  fontFamily: FONT_STACKS[step.family],
                  fontWeight: step.weight,
                  fontSize: `${Math.max(10, Math.min(34, (step.size / largest) * 34))}px`,
                }}
              >
                Aa
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-[0.65rem]">
                {step.role}
              </span>
              <span className="shrink-0 font-mono text-[0.65rem] font-bold tabular-nums">
                {step.size}u · {step.weight}
              </span>
            </motion.li>
          ))}
        </ul>
      )}
    </div>
  );
}

const KIND_GLYPH: Record<MarkKind, { label: string; glyph: React.ReactNode }> =
  {
    box: {
      label: "Boxes",
      glyph: <rect x={3} y={5} width={18} height={14} rx={2} />,
    },
    ellipse: {
      label: "Ellipses",
      glyph: <ellipse cx={12} cy={12} rx={9} ry={7} />,
    },
    line: { label: "Lines", glyph: <line x1={3} y1={19} x2={21} y2={5} /> },
    text: { label: "Lines of text", glyph: <path d="M5 6h14M12 6v13" /> },
  };

/** How many marks of each kind are on the Sheet, rolling up as they land. */
export function Tally({ marks }: { marks: Mark[] }) {
  const counts = countMarks(marks);
  return (
    <div>
      <Eyebrow>
        Marks on the sheet ·{" "}
        <CountUp value={marks.length} className="text-ink tabular-nums" />
      </Eyebrow>
      <ul className="grid grid-cols-4 gap-2">
        {(Object.keys(KIND_GLYPH) as MarkKind[]).map((kind) => (
          <li
            key={kind}
            className="outline-box flex flex-col items-center rounded-sm bg-marble py-1.5"
            title={KIND_GLYPH[kind].label}
          >
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              {KIND_GLYPH[kind].glyph}
            </svg>
            <CountUp
              value={counts[kind]}
              className="font-mono text-sm font-bold tabular-nums"
            />
            <span className="sr-only">{KIND_GLYPH[kind].label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Ring({
  value,
  label,
  size,
  stroke,
  color,
}: {
  value: number;
  label: string;
  size: number;
  stroke: number;
  color: string;
}) {
  const radius = (size - stroke) / 2;
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          viewBox={`0 0 ${size} ${size}`}
          width={size}
          height={size}
          className="-rotate-90"
          aria-hidden="true"
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#e4dccb"
            strokeWidth={stroke}
          />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="butt"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: Math.max(0.001, value) }}
            transition={{ duration: 1.1, ease: [0.2, 0.8, 0.2, 1] }}
          />
        </svg>
        <span
          className="absolute inset-0 flex items-center justify-center font-mono font-bold tabular-nums"
          style={{ fontSize: size / 4.6 }}
        >
          <CountUp value={value * 100} format={(n) => `${Math.round(n)}%`} />
        </span>
      </div>
      <span className="eyebrow text-[0.6rem] font-bold text-ink-muted">
        {label}
      </span>
    </div>
  );
}

/** The Ruler's verdict on the last Pass. */
export function RulerGauges({
  measurement,
  target,
}: {
  measurement: Measurement | null;
  target: number;
}) {
  if (!measurement)
    return (
      <div>
        <Eyebrow>The Ruler</Eyebrow>
        <p className="font-mono text-[0.7rem] text-ink-muted">
          Code measures every Pass against the screenshot, cell by cell: colour,
          and edges (SSIM).
        </p>
      </div>
    );
  const met = measurement.likeness >= target;
  return (
    <div data-testid="vellum-ruler">
      <Eyebrow>The Ruler · target {percent(target)}</Eyebrow>
      <div className="flex items-center justify-around">
        <Ring
          value={measurement.likeness}
          label="Likeness"
          size={96}
          stroke={11}
          color={met ? "#2f6b3f" : "#1d4e89"}
        />
        <div className="flex flex-col gap-2">
          <Ring
            value={measurement.colour}
            label="Colour"
            size={56}
            stroke={7}
            color="#d9a84e"
          />
          <Ring
            value={measurement.structure}
            label="Edges"
            size={56}
            stroke={7}
            color="#6b4226"
          />
        </div>
      </div>
    </div>
  );
}

const money = (usd: number | null) =>
  usd === null ? "—" : usd < 0.01 ? "<$0.01" : `$${usd.toFixed(2)}`;

/** Every Pass so far: its likeness on a little chart, what it cost, how long it took. */
export function PassTimeline({
  passes,
  target,
  livePass,
}: {
  passes: PassRecord[];
  target: number;
  livePass: number | null;
}) {
  const width = 240;
  const height = 64;
  const done = passes.flatMap((pass) =>
    pass.measurement ? [{ ...pass, measurement: pass.measurement }] : [],
  );
  const slots = Math.max(4, done.length + (livePass ? 1 : 0));
  const x = (index: number) =>
    12 + (index * (width - 24)) / Math.max(1, slots - 1);
  const y = (likeness: number) =>
    height - 6 - (Math.max(0, likeness - 0.4) / 0.6) * (height - 12);
  const points = done.map(
    (pass, index) => `${x(index)},${y(pass.measurement.likeness)}`,
  );
  const total = passes.reduce(
    (sum, pass) => sum + (pass.usage.costUsd ?? 0),
    0,
  );
  return (
    <div>
      <Eyebrow>Passes · spent {money(passes.length ? total : null)}</Eyebrow>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        aria-hidden="true"
      >
        <line
          x1={0}
          x2={width}
          y1={y(target)}
          y2={y(target)}
          stroke="#2f6b3f"
          strokeDasharray="4 4"
          strokeWidth={1.5}
        />
        <text
          x={width - 2}
          y={y(target) - 3}
          textAnchor="end"
          fontSize={9}
          fontFamily="monospace"
          fill="#2f6b3f"
        >
          target
        </text>
        {points.length > 1 && (
          <motion.polyline
            points={points.join(" ")}
            fill="none"
            stroke="#14213d"
            strokeWidth={2}
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.8 }}
          />
        )}
        {done.map((pass, index) => (
          <motion.circle
            key={pass.pass}
            cx={x(index)}
            cy={y(pass.measurement.likeness)}
            r={5}
            fill={pass.measurement.likeness >= target ? "#2f6b3f" : "#1d4e89"}
            stroke="#14213d"
            strokeWidth={2}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 500, damping: 14 }}
          />
        ))}
        {livePass !== null && (
          <circle
            cx={x(done.length)}
            cy={height / 2}
            r={5}
            fill="none"
            stroke="#d9a84e"
            strokeWidth={2}
            className="vellum-pen-ring"
          />
        )}
      </svg>
      <ol className="mt-1 flex flex-col gap-1">
        {done.map((pass) => (
          <li
            key={pass.pass}
            className="flex items-center gap-2 font-mono text-[0.65rem]"
          >
            <span className="outline-box rounded-sm bg-marble px-1 font-bold">
              P{pass.pass}
            </span>
            <span className="font-bold tabular-nums">
              {percent(pass.measurement.likeness)}
            </span>
            <span className="text-ink-muted tabular-nums">
              {pass.drawing.marks.length} marks ·{" "}
              {(pass.usage.ms / 1000).toFixed(0)}s · {money(pass.usage.costUsd)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
