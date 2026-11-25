"use client";

import { useMemo } from "react";
import type { Standard } from "../domain/rules";
import { routeAt, type Site } from "../domain/sites";
import type { Finding } from "../domain/walk";
import { SEVERITY_COLOR, severityOf, zoneTint } from "./look";

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Where a Finding goes on the plan: just ahead of where the camera stood at that second. */
export function pinOf(site: Site, at: number): [number, number] {
  const [x, y] = routeAt(site.route, at);
  const [x2, y2] = routeAt(site.route, at + 1.2);
  const d = Math.hypot(x2 - x, y2 - y) || 1;
  return [x + ((x2 - x) / d) * 1.4, y + ((y2 - y) / d) * 1.4];
}

/**
 * The Site's floor plan, drawn from the same data the footage was rendered
 * from. The walker's dot follows the video; the zones light up as the Walker
 * names them; Findings drop in as pins where the camera saw them.
 */
export function FloorPlan({
  site,
  time,
  zonesSeen,
  findings,
  standard,
  focus,
  onPick,
  numberOf,
}: {
  site: Site;
  time: number;
  zonesSeen: string[];
  findings: Finding[];
  standard: Standard;
  focus: string | null;
  onPick: (finding: Finding) => void;
  /** The number a Finding carries on its card, so the pin matches it. */
  numberOf: (id: string) => number;
}) {
  const [W, H] = site.size;
  const routePath = useMemo(
    () =>
      site.route
        .map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`)
        .join(" "),
    [site],
  );
  const walked = useMemo(() => {
    const points: string[] = [];
    for (let t = 0; t <= time; t += 0.25) {
      const [x, y] = routeAt(site.route, t);
      points.push(
        `${points.length ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`,
      );
    }
    return points.join(" ");
  }, [site, time]);
  const [cx, cy] = routeAt(site.route, time);
  const [hx, hy] = routeAt(site.route, time + 0.8);
  const heading = Math.atan2(hy - cy, hx - cx) * (180 / Math.PI);
  const seen = new Set(zonesSeen.map(norm));
  const lit = (label: string) => {
    const n = norm(label);
    return [...seen].some(
      (s) =>
        s !== "" && (n === s || n.startsWith(`${s} `) || s.startsWith(`${n} `)),
    );
  };

  return (
    <svg
      viewBox={`-1 -1 ${W + 2} ${H + 2}`}
      className="h-full w-full"
      role="img"
      aria-label={`Floor plan of ${site.name}`}
    >
      <defs>
        <pattern
          id="fw-hatch"
          width="0.5"
          height="0.5"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line
            x1="0"
            y1="0"
            x2="0"
            y2="0.5"
            stroke="#14213d"
            strokeWidth="0.12"
          />
        </pattern>
        <radialGradient id="fw-cone" cx="0" cy="0.5" r="1">
          <stop offset="0" stopColor="#1d4e89" stopOpacity="0.45" />
          <stop offset="1" stopColor="#1d4e89" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect
        x="0"
        y="0"
        width={W}
        height={H}
        fill="#fffdf7"
        stroke="#14213d"
        strokeWidth="0.25"
      />
      {site.zones.map((zone) => (
        <g key={zone.id}>
          <rect
            x={zone.rect[0]}
            y={zone.rect[1]}
            width={zone.rect[2]}
            height={zone.rect[3]}
            fill={zoneTint(zone.label)}
            className="fw-zone"
            data-lit={lit(zone.label) || undefined}
          />
          <text
            x={zone.rect[0] + 0.35}
            y={zone.rect[1] + 0.85}
            fontSize="0.62"
            fontFamily="ui-monospace, monospace"
            fontWeight="700"
            fill="#14213d"
            opacity="0.7"
          >
            {zone.label.split(" · ")[0]?.toUpperCase()}
          </text>
        </g>
      ))}
      {site.rooms.map(([x, y, w, h]) => (
        <rect
          key={`${x},${y}`}
          x={x}
          y={y}
          width={w}
          height={h}
          fill="#d6e4f5"
          fillOpacity="0.5"
          stroke="#14213d"
          strokeWidth="0.2"
        />
      ))}
      {site.racks.map((rack) => (
        <rect
          key={rack.id}
          x={rack.rect[0]}
          y={rack.rect[1]}
          width={rack.rect[2]}
          height={rack.rect[3]}
          fill="url(#fw-hatch)"
          stroke="#14213d"
          strokeWidth="0.12"
        />
      ))}
      {site.doors.map((door) => {
        const along = door.wall === "n" || door.wall === "s";
        const color =
          door.kind === "exit"
            ? "#2f6b3f"
            : door.kind === "cold"
              ? "#6fa0dc"
              : "#8a8478";
        return along ? (
          <rect
            key={door.id}
            x={door.x - door.width / 2}
            y={door.y - 0.25}
            width={door.width}
            height="0.5"
            fill={color}
          />
        ) : (
          <rect
            key={door.id}
            x={door.x - 0.25}
            y={door.y - door.width / 2}
            width="0.5"
            height={door.width}
            fill={color}
          />
        );
      })}
      <path
        d={routePath}
        fill="none"
        stroke="#14213d"
        strokeWidth="0.12"
        strokeDasharray="0.35 0.35"
        opacity="0.35"
      />
      <path
        d={walked}
        fill="none"
        stroke="#1d4e89"
        strokeWidth="0.28"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <g transform={`translate(${cx} ${cy}) rotate(${heading})`}>
        <path d="M0,0 L5,-2.6 A5.6,5.6 0 0 1 5,2.6 Z" fill="url(#fw-cone)" />
        <circle r="0.55" fill="#1d4e89" stroke="#fff" strokeWidth="0.18" />
      </g>
      {findings.map((finding) => {
        const [px, py] = pinOf(site, finding.at);
        const color = SEVERITY_COLOR[severityOf(finding, standard)];
        const active =
          focus === finding.id || Math.abs(time - finding.at) < 1.2;
        return (
          // biome-ignore lint/a11y/useSemanticElements: an SVG pin cannot be a <button>; it has the role, focus and keys of one
          <g
            key={finding.id}
            transform={`translate(${px} ${py})`}
            className="fw-pin"
            style={{ cursor: "pointer" }}
            role="button"
            tabIndex={0}
            aria-label={`Finding ${numberOf(finding.id)}: ${finding.saw}`}
            onClick={() => onPick(finding)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onPick(finding);
              }
            }}
          >
            {active ? (
              <circle
                r="1.1"
                fill="none"
                stroke={color}
                strokeWidth="0.2"
                className="fw-pin-pulse"
              />
            ) : null}
            <g className="fw-pin-drop">
              <path
                d="M0,0 C-0.9,-1.1 -1.1,-1.6 -1.1,-2.1 A1.1,1.1 0 1 1 1.1,-2.1 C1.1,-1.6 0.9,-1.1 0,0 Z"
                fill={color}
                stroke="#14213d"
                strokeWidth="0.14"
              />
              <text
                y="-1.75"
                textAnchor="middle"
                fontSize="0.95"
                fontWeight="800"
                fill="#fff"
                fontFamily="ui-monospace, monospace"
              >
                {numberOf(finding.id)}
              </text>
            </g>
          </g>
        );
      })}
    </svg>
  );
}
