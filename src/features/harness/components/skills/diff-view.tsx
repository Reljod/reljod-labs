"use client";

import { useMemo } from "react";
import { diffStats, lineDiff } from "../../domain/skills/diff";
import { cx } from "../ui";

/** A line diff of two texts: removed lines struck on red, added on green, unchanged lines quiet. Long runs of unchanged lines fold. */
export function DiffView({
  before,
  after,
  beforeLabel = "Default",
  afterLabel = "Now",
}: {
  before: string;
  after: string;
  beforeLabel?: string;
  afterLabel?: string;
}) {
  const lines = useMemo(() => lineDiff(before, after), [before, after]);
  const { added, removed } = diffStats(lines);
  if (added === 0 && removed === 0) {
    return (
      <p className="rounded-sm outline-box bg-marble/50 px-3 py-6 text-center text-sm text-ink-muted">
        No difference: this is the same as the {beforeLabel.toLowerCase()}.
      </p>
    );
  }
  // Fold unchanged lines further than 3 from a change.
  const near = new Array<boolean>(lines.length).fill(false);
  lines.forEach((line, index) => {
    if (line.kind === "same") return;
    for (
      let i = Math.max(0, index - 3);
      i <= Math.min(lines.length - 1, index + 3);
      i++
    ) {
      near[i] = true;
    }
  });
  const rows: {
    key: string;
    kind: "same" | "add" | "remove" | "fold";
    text: string;
  }[] = [];
  let hidden = 0;
  lines.forEach((line, index) => {
    if (near[index]) {
      if (hidden > 0) {
        rows.push({
          key: `f${index}`,
          kind: "fold",
          text: `${hidden} unchanged lines`,
        });
        hidden = 0;
      }
      rows.push({ key: `l${index}`, kind: line.kind, text: line.text });
    } else hidden++;
  });
  if (hidden > 0)
    rows.push({ key: "fend", kind: "fold", text: `${hidden} unchanged lines` });
  return (
    <div className="rounded-sm outline-box">
      <p className="border-ink border-b-2 px-3 py-1.5 font-mono text-xs text-ink-muted">
        {beforeLabel} → {afterLabel}: <span className="text-ivy">+{added}</span>{" "}
        <span className="text-seal-red">−{removed}</span>
      </p>
      <pre className="hx-scroll max-h-[28rem] overflow-x-auto py-1 font-mono text-xs leading-5">
        {rows.map((row) => (
          <div
            key={row.key}
            className={cx(
              "min-w-fit whitespace-pre-wrap px-3 [overflow-wrap:anywhere]",
              row.kind === "add" && "bg-ivy/10 text-ivy",
              row.kind === "remove" && "bg-seal-red/10 text-seal-red",
              row.kind === "same" && "text-ink-muted",
              row.kind === "fold" &&
                "bg-marble py-0.5 text-center text-[0.65rem] text-ink-muted",
            )}
          >
            {row.kind === "add"
              ? "+ "
              : row.kind === "remove"
                ? "− "
                : row.kind === "same"
                  ? "  "
                  : ""}
            {row.text || " "}
          </div>
        ))}
      </pre>
    </div>
  );
}
