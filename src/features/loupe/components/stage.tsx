"use client";

import { type CSSProperties, memo } from "react";
import type {
  Box,
  Finding,
  Hypothesis,
  PageInfo,
  Weight,
} from "../domain/contract";
import { METRICS } from "../domain/contract";
import { cx } from "./ui";
import { assetUrl } from "./view";

export type LayerToggles = {
  boxes: boolean;
  layers: boolean;
  hypotheses: boolean;
};

const boxStyle = (box: Box): CSSProperties => ({
  left: `${box[0] * 100}%`,
  top: `${box[1] * 100}%`,
  width: `${(box[2] - box[0]) * 100}%`,
  height: `${(box[3] - box[1]) * 100}%`,
});

const WEIGHT_BOX: Record<Weight, string> = {
  decisive: "lp-box-decisive",
  supporting: "lp-box-supporting",
  context: "lp-box-context",
};

/**
 * One page of the Document with its evidence drawn over it: the Evidence
 * layers code produced (laid over the page at its own size), a box per
 * Finding, a dashed box per open Hypothesis, and the lens where the Examiner
 * is looking. Everything is positioned in page fractions, so it stays
 * registered at any width.
 */
export const Stage = memo(function Stage({
  examinationId,
  page,
  findings,
  hypotheses,
  selected,
  onSelect,
  toggles,
  look,
  scanning,
}: {
  /** null for a Sample that has not been examined yet (static page images). */
  examinationId: string | null;
  page: PageInfo;
  findings: Finding[];
  hypotheses: Hypothesis[];
  selected: string | null;
  onSelect: (findingId: string | null) => void;
  toggles: LayerToggles;
  look: { page: number; box: Box | null; seq: number } | null;
  /** The Sweep is running: a scan line passes over the page. */
  scanning: boolean;
}) {
  const url = (ref: string) => assetUrl(examinationId ?? "", ref);
  const here = findings.filter(
    (finding) => finding.page === page.page || finding.page === 0,
  );
  // One layer at a time when a Finding is open; otherwise every counted Finding's.
  const layers = toggles.layers
    ? [
        ...new Map(
          here
            .filter(
              (finding) =>
                finding.layer &&
                (selected
                  ? finding.id === selected
                  : // Maps lie flat on the page; cards and marks wait for their Finding to be opened.
                    finding.weight !== "context" &&
                    finding.layerKind === "heatmap"),
            )
            .map((finding) => [finding.layer as string, finding]),
        ).values(),
      ]
    : [];
  const lens =
    look && look.page === page.page
      ? (look.box ?? ([0.08, 0.06, 0.92, 0.94] as Box))
      : null;
  return (
    <div
      className="lp-stage outline-box relative w-full overflow-hidden rounded-sm bg-paper shadow-hard-md"
      style={{ aspectRatio: `${page.width} / ${page.height}` }}
      data-testid="loupe-stage"
    >
      {/* biome-ignore lint/performance/noImgElement: an Owner's page image comes from a gated route, not the image optimiser. */}
      <img
        src={url(page.image)}
        alt={`Page ${page.page} of the document`}
        width={page.width}
        height={page.height}
        className="absolute inset-0 size-full select-none"
        draggable={false}
      />
      {layers.map((finding) => (
        // biome-ignore lint/performance/noImgElement: an Evidence layer is a transparent PNG laid over the page at its own size.
        <img
          key={finding.layer}
          src={url(finding.layer as string)}
          alt=""
          aria-hidden="true"
          data-testid="loupe-layer"
          className="lp-layer pointer-events-none absolute inset-0 size-full"
        />
      ))}
      {scanning ? <div aria-hidden="true" className="lp-scan" /> : null}
      {toggles.hypotheses
        ? hypotheses
            .filter(
              (item) =>
                item.page === page.page &&
                item.box &&
                item.status !== "supported",
            )
            .map((item) => (
              <div
                key={item.id}
                className={cx(
                  "lp-hypothesis pointer-events-none absolute",
                  item.status === "refuted" && "lp-hypothesis-refuted",
                )}
                style={boxStyle(item.box as Box)}
              >
                <span className="lp-tag bg-paper text-ink">
                  {item.id}
                  {item.status === "refuted" ? " refuted" : " ?"}
                </span>
              </div>
            ))
        : null}
      {toggles.boxes
        ? here
            .filter((finding) => finding.box)
            .map((finding) => (
              <button
                key={finding.id}
                type="button"
                onClick={() =>
                  onSelect(selected === finding.id ? null : finding.id)
                }
                aria-pressed={selected === finding.id}
                aria-label={`${METRICS[finding.metric].label}, ${finding.weight} Finding`}
                data-testid="loupe-finding-box"
                className={cx(
                  "lp-box absolute",
                  WEIGHT_BOX[finding.weight],
                  selected === finding.id && "lp-box-selected",
                  selected && selected !== finding.id && "opacity-40",
                )}
                style={boxStyle(finding.box as Box)}
              >
                <span className="lp-tag">{finding.id}</span>
              </button>
            ))
        : null}
      {lens ? (
        <div
          key={look?.seq}
          aria-hidden="true"
          className="lp-lens pointer-events-none absolute"
          style={boxStyle(lens)}
        />
      ) : null}
    </div>
  );
});
