/** @jsxImportSource preact */
import { useMemo, useRef, useState } from "preact/hooks";
import type { Annotation, ParamValue } from "../domain/view";
import { slotColor } from "./colors";
import {
  axisTickLabels,
  axisTitle,
  formatNumber,
  formatTime,
  formatValue,
  isoDate,
  parseTime,
  timeTickLabels,
  toNumber,
} from "./format";
import { buildFrame, extent, type Frame } from "./model";
import {
  barPath,
  type ChartProps,
  clamp,
  Empty,
  keepInside,
  Legend,
  PlotTop,
  Tip,
  type TipData,
  TipSpoken,
  truncate,
  useActive,
} from "./plot";
import {
  bandScale,
  linearScale,
  nearestIndex,
  niceTicks,
  stack,
  textWidth,
  thinEvery,
  timeTicks,
} from "./scales";

/** Line, area and bar: the three kinds that share an x and a y axis. */

type Kind = "line" | "area" | "bar";
const GAP = 2;
const MAX_BAR = 24;
const MAX_ROWS = 30;

function xText(frame: Frame, index: number, enc: ChartProps<Kind>["encoding"]) {
  const value = frame.xs[index];
  if (frame.xType === "time")
    return formatTime(value as number, frame.timeUnit);
  if (frame.xType === "number")
    return formatValue(value, { format: enc.x.format, unit: enc.x.unit });
  return String(value);
}

function tipRows(
  frame: Frame,
  index: number,
  enc: ChartProps<Kind>["encoding"],
  colorOf: (name: string) => string,
  stacked: boolean,
) {
  const fmt = { format: enc.y.format, unit: enc.y.unit };
  const rows = frame.series.map((series) => ({
    color: colorOf(series.name),
    name: series.name || axisTitle(enc.y),
    value: formatValue(series.values[index], fmt),
  }));
  if (stacked) {
    const total = frame.series.reduce(
      (sum, series) => sum + (series.values[index] ?? 0),
      0,
    );
    rows.push({
      color: "transparent",
      name: "Total",
      value: formatValue(total, fmt),
    });
  }
  return rows;
}

export function Cartesian(props: ChartProps<Kind>) {
  const { view, encoding: enc } = props;
  const frame = useMemo(() => buildFrame(view.result, enc), [view.result, enc]);
  if (frame.xs.length === 0 || frame.series.length === 0)
    return <Empty>The Query returned no rows to draw.</Empty>;
  if (enc.kind === "bar" && enc.horizontal)
    return <Horizontal {...props} frame={frame} />;
  return <Vertical {...props} frame={frame} />;
}

function Vertical({
  view,
  encoding: enc,
  width,
  theme,
  slots,
  act,
  frame,
}: ChartProps<Kind> & { frame: Frame }) {
  const n = frame.xs.length;
  const m = frame.series.length;
  const isBar = enc.kind === "bar";
  const stacked = m > 1 && ((isBar && !!enc.stacked) || enc.kind === "area");
  const banded = isBar || frame.xType === "category";
  const names = frame.series.map((series) => series.name);
  const slotOf = slots(names);
  const colorOf = (name: string) => slotColor(slotOf[name], theme, enc.colors);
  const stacks = useMemo(
    () => (stacked ? stack(frame.series.map((series) => series.values)) : null),
    [stacked, frame],
  );
  const { active, setActive, onKeyDown } = useActive(n);
  const svg = useRef<SVGSVGElement>(null);
  const dragging = useRef<{ start: number; moved: boolean } | null>(null);
  const [drag, setDrag] = useState<[number, number] | null>(null);

  let [low, high] = extent(
    stacks
      ? stacks.map((series) => series.flat())
      : frame.series.map((series) => series.values),
  ) ?? [0, 1];
  if (isBar || enc.kind === "area" || enc.y.zero) {
    low = Math.min(low, 0);
    high = Math.max(high, 0);
  }
  const notes = view.spec.annotations;
  for (const note of notes)
    if (note.kind === "line") {
      low = Math.min(low, note.y);
      high = Math.max(high, note.y);
    }

  const height = Math.round(clamp(width * 0.42, 190, 280));
  const y = niceTicks(low, high, height < 220 ? 4 : 5);
  const yLabels = axisTickLabels(y.ticks, enc.y.format);
  const left =
    Math.ceil(Math.max(...yLabels.map((label) => textWidth(label)))) + 10;
  const direct = !isBar && m >= 2 && m <= 4 && width >= 480;
  const right = direct
    ? Math.min(
        width * 0.26,
        Math.max(...names.map((name) => textWidth(name))) + 18,
      )
    : 10;
  const top = notes.length ? 24 : 10;
  const bottom = 22;
  const x0 = left;
  const x1 = Math.max(left + 40, width - right);
  const base = height - bottom;
  const ys = linearScale([y.min, y.max], [base, top]);
  const zero = ys(clamp(0, y.min, y.max));

  const nums = frame.xs as number[];
  const band = bandScale(n, [x0, x1], isBar ? 0.28 : 0);
  const xScale = banded
    ? null
    : n > 1
      ? linearScale([nums[0], nums[n - 1]], [x0 + 5, x1 - 5])
      : linearScale([nums[0] - 1, nums[0] + 1], [x0, x1]);
  const px = (index: number) =>
    xScale ? xScale(nums[index]) : band.center(index);
  const indexAt = (pixel: number) =>
    xScale ? nearestIndex(nums, xScale.invert(pixel)) : band.indexAt(pixel);

  // The x axis: calendar or round ticks on a continuous scale, every k-th label on bands.
  let ticks: { x: number; label: string }[] = [];
  if (xScale && n > 1) {
    const room = x1 - x0;
    if (frame.xType === "time") {
      const found = timeTicks(
        nums[0],
        nums[n - 1],
        clamp(Math.floor(room / 86), 2, 6),
      );
      const labels = timeTickLabels(found.ticks, found.unit);
      ticks = found.ticks.map((tick, index) => ({
        x: xScale(tick),
        label: labels[index],
      }));
    } else {
      const found = niceTicks(
        nums[0],
        nums[n - 1],
        clamp(Math.floor(room / 70), 2, 6),
      ).ticks.filter((tick) => tick >= nums[0] && tick <= nums[n - 1]);
      const labels = axisTickLabels(found, enc.x.format);
      ticks = found.map((tick, index) => ({
        x: xScale(tick),
        label: labels[index],
      }));
    }
  } else {
    const full =
      frame.xType === "time"
        ? timeTickLabels(nums, frame.timeUnit)
        : frame.xs.map((value) =>
            frame.xType === "number"
              ? formatNumber(value as number)
              : truncate(String(value), 16),
          );
    const widest = Math.min(
      96,
      Math.max(...full.map((label) => textWidth(label))),
    );
    const every = thinEvery(n, widest + 12, x1 - x0);
    const kept = frame.xs.map((_, index) => index).filter((i) => i % every === 0);
    const labels =
      frame.xType === "time"
        ? timeTickLabels(
            kept.map((index) => nums[index]),
            frame.timeUnit,
          )
        : kept.map((index) => full[index]);
    ticks = kept.map((index, at) => ({ x: px(index), label: labels[at] }));
  }

  const yOf = (series: number, index: number) => {
    const value = stacks
      ? stacks[series][index][1]
      : frame.series[series].values[index];
    return value === null ? null : ys(value);
  };

  /** A path over the runs of points a series has; a gap lifts the pen. */
  const linePath = (series: number) => {
    let path = "";
    let pen = false;
    for (let index = 0; index < n; index++) {
      const at = stacks
        ? frame.series[series].values[index] === null && !stacked
          ? null
          : yOf(series, index)
        : yOf(series, index);
      if (at === null) {
        pen = false;
        continue;
      }
      path += `${pen ? "L" : "M"}${px(index).toFixed(1)},${at.toFixed(1)}`;
      pen = true;
    }
    return path;
  };

  const areaPath = (series: number) => {
    let path = "";
    let run: number[] = [];
    const close = () => {
      if (run.length === 0) return;
      const tops = run.map(
        (index) =>
          `${px(index).toFixed(1)},${(yOf(series, index) ?? zero).toFixed(1)}`,
      );
      const floors = run
        .map((index) => {
          const floor = stacks ? ys(stacks[series][index][0]) : zero;
          return `${px(index).toFixed(1)},${floor.toFixed(1)}`;
        })
        .reverse();
      path += `M${tops.join("L")}L${floors.join("L")}Z`;
      run = [];
    };
    for (let index = 0; index < n; index++) {
      if (yOf(series, index) === null) close();
      else run.push(index);
    }
    close();
    return path;
  };

  // Bars: thin, capped at 24px, a 2px surface gap between neighbours.
  const groupCount = stacked || !isBar ? 1 : m;
  const barWidth = Math.max(
    1,
    Math.min(MAX_BAR, (band.width - GAP * (groupCount - 1)) / groupCount),
  );
  const groupWidth = barWidth * groupCount + GAP * (groupCount - 1);
  const bars: {
    key: string;
    d: string;
    color: string;
    down: boolean;
  }[] = [];
  if (isBar)
    for (let index = 0; index < n; index++) {
      const start = band.center(index) - groupWidth / 2;
      let lastUp = -1;
      let lastDown = -1;
      if (stacks)
        frame.series.forEach((series, at) => {
          const value = series.values[index] ?? 0;
          if (value > 0) lastUp = at;
          if (value < 0) lastDown = at;
        });
      frame.series.forEach((series, at) => {
        const value = series.values[index];
        if (value === null || value === 0) return;
        const [from, to] = stacks ? stacks[at][index] : [0, value];
        const outer = !stacks || at === (value > 0 ? lastUp : lastDown);
        let a = ys(from);
        const b = ys(to);
        // The gap sits at the inner end, so the stack's total stays true.
        if (stacks && from !== 0 && Math.abs(b - a) > GAP + 1)
          a += value > 0 ? -GAP : GAP;
        bars.push({
          key: `${index}:${series.name}`,
          d: barPath(
            stacks ? start : start + at * (barWidth + GAP),
            a,
            b,
            barWidth,
            outer ? 4 : 0,
          ),
          color: colorOf(series.name),
          down: value < 0,
        });
      });
    }
  const capLabels =
    isBar && m === 1 && n <= 12 && band.step >= 34 && notes.length === 0;

  // Annotations -------------------------------------------------------------
  const noteX = (value: string | number, edge: -1 | 0 | 1 = 0) => {
    if (frame.xType === "category") {
      const index = frame.xs.indexOf(String(value));
      return index < 0 ? null : band.center(index) + (edge * band.step) / 2;
    }
    const number = frame.xType === "time" ? parseTime(value) : toNumber(value);
    if (number === null) return null;
    if (xScale) return clamp(xScale(number), x0, x1);
    return band.center(nearestIndex(nums, number)) + (edge * band.step) / 2;
  };
  const noteIndex = (value: string | number) => {
    if (frame.xType === "category") return frame.xs.indexOf(String(value));
    const number = frame.xType === "time" ? parseTime(value) : toNumber(value);
    return number === null ? -1 : nearestIndex(nums, number);
  };
  const drawNote = (note: Annotation, key: number) => {
    if (note.kind === "line") {
      const at = ys(note.y);
      return (
        <g key={key} class="late">
          <line class="note-rule" x1={x0} x2={x1} y1={at} y2={at} />
          <text class="strong halo" x={x1 - 2} y={at - 5} text-anchor="end">
            {note.label}
          </text>
        </g>
      );
    }
    if (note.kind === "band") {
      const from = noteX(note.from, -1);
      const to = noteX(note.to, 1);
      if (from === null || to === null) return null;
      const [a, b] = from <= to ? [from, to] : [to, from];
      const labelWidth = textWidth(note.label);
      return (
        <g key={key} class="late">
          <rect
            class="note-band"
            x={a}
            y={top}
            width={Math.max(2, b - a)}
            height={base - top}
          />
          <text
            class="strong"
            x={keepInside((a + b) / 2, labelWidth, width)}
            y={top - 7}
            text-anchor="middle"
          >
            {note.label}
          </text>
        </g>
      );
    }
    const index = noteIndex(note.x);
    if (index < 0) return null;
    const series = Math.max(
      0,
      note.series ? names.indexOf(note.series) : stacks ? m - 1 : 0,
    );
    const at = yOf(series, index);
    if (at === null) return null;
    const x = px(index);
    const above = at - 30 > top - 16;
    const labelY = above ? at - 20 : at + 30;
    const rightSide = x > (x0 + x1) / 2;
    return (
      <g key={key} class="late">
        <line
          class="note-leader"
          x1={x}
          x2={x}
          y1={above ? at - 6 : at + 6}
          y2={above ? labelY + 4 : labelY - 12}
        />
        <circle class="note-dot" cx={x} cy={at} r={4.5} />
        <text
          class="strong halo"
          x={rightSide ? x + 3 : x - 3}
          y={labelY}
          text-anchor={rightSide ? "end" : "start"}
        >
          {note.label}
        </text>
      </g>
    );
  };

  // Direct labels at line ends, nudged apart, each with its end dot.
  const ends = frame.series
    .map((series, at) => {
      let index = n - 1;
      while (index >= 0 && series.values[index] === null) index--;
      const yAt = index < 0 ? null : yOf(at, index);
      return yAt === null
        ? null
        : { name: series.name, x: px(index), y: yAt, labelY: yAt };
    })
    .filter((end) => end !== null);
  if (direct) {
    const sorted = [...ends].sort((a, b) => a.y - b.y);
    for (let index = 1; index < sorted.length; index++)
      sorted[index].labelY = Math.max(
        sorted[index].labelY,
        sorted[index - 1].labelY + 13,
      );
    const overflow = (sorted[sorted.length - 1]?.labelY ?? 0) - base;
    if (overflow > 0) for (const end of sorted) end.labelY -= overflow;
  }

  // Brush ---------------------------------------------------------------------
  const brush =
    enc.brush && act.enabled && frame.xType !== "category" && n > 1
      ? enc.brush
      : null;
  const pointerX = (event: PointerEvent | MouseEvent) =>
    event.clientX - (svg.current?.getBoundingClientRect().left ?? 0);
  const paramValue = (name: string, pixel: number): ParamValue | null => {
    const param = view.spec.params.find((item) => item.name === name);
    if (!param) return null;
    const value = xScale
      ? clamp(xScale.invert(pixel), nums[0], nums[n - 1])
      : nums[band.indexAt(pixel)];
    if (param.type === "date")
      return frame.xType === "time" ? isoDate(value) : null;
    if (param.type === "number") {
      if (frame.xType === "time") return new Date(value).getUTCFullYear();
      const span = Math.abs(nums[n - 1] - nums[0]) || 1;
      const digits = Math.max(0, 2 - Math.floor(Math.log10(span)));
      return Number(value.toFixed(Math.min(6, digits)));
    }
    return String(value);
  };
  const commit = (from: number, to: number) => {
    if (!brush) return;
    const [a, b] = from <= to ? [from, to] : [to, from];
    const first = paramValue(brush.from, a);
    const second = paramValue(brush.to, b);
    if (first === null || second === null) return;
    act.set({ [brush.from]: first, [brush.to]: second });
  };
  const cancel = () => {
    dragging.current = null;
    setDrag(null);
  };

  const tip: TipData | null =
    active === null || drag
      ? null
      : {
          x: px(active),
          title: xText(frame, active, enc),
          rows: tipRows(frame, active, enc, colorOf, stacked),
        };
  const dots = n <= 24 && !isBar;

  return (
    <>
      <PlotTop title={axisTitle(enc.y)}>
        {m > 1 ? (
          <Legend
            stroke={enc.kind === "line"}
            items={names.map((name) => ({ name, color: colorOf(name) }))}
          />
        ) : null}
      </PlotTop>
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: the arrow keys walk the chart's values, like hover does. */}
      <div
        class={brush ? "chart can-brush" : "chart"}
        role="group"
        aria-roledescription="chart"
        aria-label={`${view.spec.title}. ${n} points${m > 1 ? `, ${m} series` : ""}. Arrow keys read the values.`}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Escape" && dragging.current) cancel();
          else onKeyDown(event);
        }}
        onBlur={() => setActive(null)}
      >
        <svg
          ref={svg}
          viewBox={`0 0 ${width} ${height}`}
          height={height}
          aria-hidden="true"
          onPointerDown={(event) => {
            if (!brush || event.button !== 0) return;
            dragging.current = { start: pointerX(event), moved: false };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const x = clamp(pointerX(event), x0, x1);
            const held = dragging.current;
            if (held) {
              if (Math.abs(x - held.start) > 4) held.moved = true;
              if (held.moved) {
                setDrag([clamp(held.start, x0, x1), x]);
                return;
              }
            }
            setActive(indexAt(x));
          }}
          onPointerUp={(event) => {
            const held = dragging.current;
            if (held?.moved) commit(clamp(held.start, x0, x1), clamp(pointerX(event), x0, x1));
            cancel();
          }}
          onPointerCancel={cancel}
          onPointerLeave={() => {
            if (!dragging.current) setActive(null);
          }}
          onDblClick={() => {
            if (brush)
              act.set({
                [brush.from]: act.defaults[brush.from],
                [brush.to]: act.defaults[brush.to],
              });
          }}
        >
          {y.ticks.map((tick, index) => (
            <g key={tick}>
              <line
                class={tick === 0 ? "axis" : "grid"}
                x1={x0}
                x2={x1}
                y1={ys(tick)}
                y2={ys(tick)}
              />
              <text x={x0 - 7} y={ys(tick) + 3.5} text-anchor="end">
                {yLabels[index]}
              </text>
            </g>
          ))}
          {y.min > 0 || y.max < 0 ? (
            <line class="axis" x1={x0} x2={x1} y1={base} y2={base} />
          ) : null}
          {ticks.map((tick) => (
            <text
              key={`${tick.x}:${tick.label}`}
              x={keepInside(tick.x, textWidth(tick.label), width)}
              y={base + 15}
              text-anchor="middle"
            >
              {tick.label}
            </text>
          ))}
          {active !== null && banded && !drag ? (
            <rect
              class="band-hover"
              x={band.center(active) - band.step / 2}
              y={top}
              width={band.step}
              height={base - top}
            />
          ) : null}
          {enc.kind === "area"
            ? frame.series.map((series, at) => (
                <path
                  key={series.name}
                  class="wash"
                  d={areaPath(at)}
                  fill={colorOf(series.name)}
                  opacity={stacked ? 0.32 : 0.12}
                />
              ))
            : null}
          {bars.map((bar) => (
            <path
              key={bar.key}
              class={bar.down ? "bar neg" : "bar"}
              d={bar.d}
              fill={bar.color}
            />
          ))}
          {capLabels
            ? frame.series[0].values.map((value, index) =>
                value === null ? null : (
                  <text
                    key={frame.raw[index]}
                    class="strong late"
                    x={band.center(index)}
                    y={ys(value) + (value < 0 ? 13 : -5)}
                    text-anchor="middle"
                  >
                    {formatValue(
                      value,
                      { format: enc.y.format },
                      { compact: true },
                    )}
                  </text>
                ),
              )
            : null}
          {!isBar
            ? frame.series.map((series, at) => (
                <path
                  key={series.name}
                  class="series"
                  d={linePath(at)}
                  stroke={colorOf(series.name)}
                  pathLength={1}
                />
              ))
            : null}
          {dots
            ? frame.series.map((series, at) =>
                series.values.map((value, index) =>
                  value === null ? null : (
                    <circle
                      key={`${series.name}:${frame.raw[index]}`}
                      class="ring late"
                      cx={px(index)}
                      cy={yOf(at, index) ?? 0}
                      r={3.5}
                      fill={colorOf(series.name)}
                    />
                  ),
                ),
              )
            : null}
          {notes.map(drawNote)}
          {!isBar && !dots
            ? ends.map((end) => (
                <circle
                  key={end.name}
                  class="ring late"
                  cx={end.x}
                  cy={end.y}
                  r={4}
                  fill={colorOf(end.name)}
                />
              ))
            : null}
          {direct
            ? ends.map((end) => (
                <g key={end.name} class="late">
                  {Math.abs(end.labelY - end.y) > 5 ? (
                    <line
                      class="grid"
                      x1={end.x + 5}
                      x2={end.x + 9}
                      y1={end.y}
                      y2={end.labelY}
                    />
                  ) : null}
                  <text class="strong" x={end.x + 11} y={end.labelY + 3.5}>
                    {truncate(end.name, Math.floor((right - 14) / 6))}
                  </text>
                </g>
              ))
            : null}
          {active !== null && !banded && !drag ? (
            <g>
              <line
                class="cross"
                x1={px(active)}
                x2={px(active)}
                y1={top}
                y2={base}
              />
              {frame.series.map((series, at) => {
                const cy = yOf(at, active);
                return cy === null || series.values[active] === null ? null : (
                  <circle
                    key={series.name}
                    class="ring"
                    cx={px(active)}
                    cy={cy}
                    r={4.5}
                    fill={colorOf(series.name)}
                  />
                );
              })}
            </g>
          ) : null}
          {drag ? (
            <rect
              class="brush"
              x={Math.min(drag[0], drag[1])}
              y={top}
              width={Math.abs(drag[1] - drag[0])}
              height={base - top}
            />
          ) : null}
        </svg>
        <Tip tip={tip} width={width} />
        {drag && brush ? (
          <div class="tip" style={{ left: `${Math.min(drag[0], drag[1])}px` }}>
            <b>Range</b>
            <div>
              <strong>
                {String(paramValue(brush.from, Math.min(drag[0], drag[1])))} to{" "}
                {String(paramValue(brush.to, Math.max(drag[0], drag[1])))}
              </strong>
            </div>
          </div>
        ) : null}
        <TipSpoken tip={tip} />
      </div>
      {enc.x.label ? <p class="x-title">{axisTitle(enc.x)}</p> : null}
    </>
  );
}

/** Horizontal bars: names down the side, values along the bottom, always from zero. */
function Horizontal({
  view,
  encoding: enc,
  width,
  theme,
  slots,
  frame: whole,
}: ChartProps<"bar"> & { frame: Frame }) {
  const frame = useMemo<Frame>(
    () =>
      whole.xs.length <= MAX_ROWS
        ? whole
        : {
            ...whole,
            xs: whole.xs.slice(0, MAX_ROWS),
            raw: whole.raw.slice(0, MAX_ROWS),
            series: whole.series.map((series) => ({
              ...series,
              values: series.values.slice(0, MAX_ROWS),
            })),
          },
    [whole],
  );
  const n = frame.xs.length;
  const m = frame.series.length;
  const stacked = m > 1 && !!enc.stacked;
  const names = frame.series.map((series) => series.name);
  const slotOf = slots(names);
  const colorOf = (name: string) => slotColor(slotOf[name], theme, enc.colors);
  const stacks = useMemo(
    () => (stacked ? stack(frame.series.map((series) => series.values)) : null),
    [stacked, frame],
  );
  const { active, setActive, onKeyDown } = useActive(n);
  const [low, high] = extent(
    stacks
      ? stacks.map((series) => series.flat())
      : frame.series.map((series) => series.values),
  ) ?? [0, 1];
  const fmt = { format: enc.y.format, unit: enc.y.unit };
  const groupCount = stacked ? 1 : m;
  const thick = groupCount > 1 ? 11 : 16;
  const step = groupCount * thick + (groupCount - 1) * GAP + 12;
  const top = 4;
  const bottom = 22;
  const height = top + n * step + bottom;
  const labels = frame.xs.map((_, index) => xText(frame, index, enc));
  const left = Math.min(
    width * 0.38,
    Math.max(...labels.map((label) => textWidth(label))) + 12,
  );
  const tips = groupCount === 1;
  const totals = frame.xs.map((_, index) =>
    frame.series.reduce((sum, series) => sum + (series.values[index] ?? 0), 0),
  );
  const tipTexts = totals.map((total) =>
    formatValue(total, { format: enc.y.format }, { compact: true }),
  );
  const right = tips
    ? Math.max(...tipTexts.map((text) => textWidth(text))) + 12
    : 12;
  const x0 = left;
  const x1 = Math.max(left + 40, width - right);
  const axis = niceTicks(
    Math.min(low, 0),
    Math.max(high, 0),
    clamp(Math.floor((x1 - x0) / 72), 2, 5),
  );
  const axisLabels = axisTickLabels(axis.ticks, enc.y.format);
  const xs = linearScale([axis.min, axis.max], [x0, x1]);
  const rowTop = (index: number) => top + index * step + 6;

  const tip: TipData | null =
    active === null
      ? null
      : {
          x: xs(Math.max(0, totals[active])),
          y: rowTop(active),
          title: labels[active],
          rows: tipRows(frame, active, enc, colorOf, stacked),
        };

  return (
    <>
      <PlotTop title={axisTitle(enc.y)}>
        {m > 1 ? (
          <Legend items={names.map((name) => ({ name, color: colorOf(name) }))} />
        ) : null}
      </PlotTop>
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: the arrow keys walk the chart's values, like hover does. */}
      <div
        class="chart"
        role="group"
        aria-roledescription="chart"
        aria-label={`${view.spec.title}. ${n} bars. Arrow keys read the values.`}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
      >
        <svg
          viewBox={`0 0 ${width} ${height}`}
          height={height}
          aria-hidden="true"
          onPointerMove={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            setActive(
              clamp(Math.floor((event.clientY - box.top - top) / step), 0, n - 1),
            );
          }}
          onPointerLeave={() => setActive(null)}
        >
          {axis.ticks.map((tick, index) => (
            <g key={tick}>
              <line
                class={tick === 0 ? "axis" : "grid"}
                x1={xs(tick)}
                x2={xs(tick)}
                y1={top}
                y2={height - bottom}
              />
              <text
                x={keepInside(xs(tick), textWidth(axisLabels[index]), width)}
                y={height - bottom + 15}
                text-anchor="middle"
              >
                {axisLabels[index]}
              </text>
            </g>
          ))}
          {active !== null ? (
            <rect
              class="band-hover"
              x={0}
              y={top + active * step}
              width={width}
              height={step}
            />
          ) : null}
          {frame.xs.map((_, index) => {
            let lastUp = -1;
            frame.series.forEach((series, at) => {
              if ((series.values[index] ?? 0) > 0) lastUp = at;
            });
            return (
              <g key={frame.raw[index]}>
                <text
                  class="strong"
                  x={x0 - 8}
                  y={top + index * step + step / 2 + 3.5}
                  text-anchor="end"
                  font-weight="400"
                >
                  {truncate(labels[index], Math.floor((left - 10) / 6.2))}
                </text>
                {frame.series.map((series, at) => {
                  const value = series.values[index];
                  if (value === null || value === 0) return null;
                  const [from, to] = stacks ? stacks[at][index] : [0, value];
                  let a = xs(from);
                  const b = xs(to);
                  if (stacks && from !== 0 && Math.abs(b - a) > GAP + 1)
                    a += value > 0 ? GAP : -GAP;
                  return (
                    <path
                      key={series.name}
                      class={value < 0 ? "bar h neg" : "bar h"}
                      d={barPath(
                        rowTop(index) + (stacks ? 0 : at * (thick + GAP)),
                        a,
                        b,
                        thick,
                        !stacks || at === lastUp || value < 0 ? 4 : 0,
                        true,
                      )}
                      fill={colorOf(series.name)}
                    />
                  );
                })}
                {tips ? (
                  <text
                    class="strong late"
                    x={xs(Math.max(0, totals[index])) + 6}
                    y={rowTop(index) + thick / 2 + 3.5}
                  >
                    {tipTexts[index]}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
        <Tip tip={tip} width={width} />
        <TipSpoken tip={tip} />
      </div>
      {whole.xs.length > n ? (
        <p class="note">
          Showing the first {n} of {whole.xs.length} bars. Every row is in Show
          the work.
        </p>
      ) : null}
    </>
  );
}
