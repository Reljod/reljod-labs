"use client";

import type { DocumentKind } from "../domain/types";
import type { DocumentView, FindingView } from "../view";
import { DOCUMENT_LABELS, FIELD_LABELS } from "./labels";

type DocumentViewerProps = {
  documents: DocumentView[];
  activeKind: DocumentKind;
  onSelectKind: (kind: DocumentKind) => void;
  finding: FindingView | null;
};

/** Shows one Document's pages with the selected Finding's Evidence boxed on them. */
export function DocumentViewer({
  documents,
  activeKind,
  onSelectKind,
  finding,
}: DocumentViewerProps) {
  const document = documents.find((item) => item.kind === activeKind);
  const evidence =
    finding?.evidence.filter((item) => item.documentKind === activeKind) ?? [];
  const highlighted = new Set(evidence.flatMap((item) => item.spanRefs));
  const boxes =
    document?.spans.filter((span) => highlighted.has(span.ref)) ?? [];
  const fields = evidence.flatMap((item) => {
    const field = document?.fields.find(
      (candidate) => candidate.name === item.fieldName,
    );
    return field ? [field] : [];
  });

  return (
    <div className="outline-box rounded-sm bg-paper">
      <div
        role="tablist"
        aria-label="Documents"
        className="flex flex-wrap border-ink border-b-2"
      >
        {documents.map((item) => (
          <button
            key={item.kind}
            type="button"
            role="tab"
            aria-selected={item.kind === activeKind}
            onClick={() => onSelectKind(item.kind)}
            className={`eyebrow border-ink border-r-2 px-4 py-3 ${
              item.kind === activeKind ? "bg-ink text-paper" : "bg-paper"
            }`}
          >
            {DOCUMENT_LABELS[item.kind]}
          </button>
        ))}
      </div>

      {fields.length > 0 ? (
        <ul className="flex flex-col gap-1 border-ink border-b-2 bg-morning-haze px-4 py-3 text-sm">
          {fields.map((field) => (
            <li
              key={field.name}
              data-testid="evidence-field"
              data-field-value={field.value}
              data-span-refs={field.spanRefs.join(" ")}
            >
              <span className="font-mono font-bold">
                {FIELD_LABELS[field.name]}:
              </span>{" "}
              {field.value}{" "}
              <span className="text-ink-muted">
                {field.verified ? "· found in source" : "· not found in source"}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {document?.pages.map((page) => (
        <div key={page.page} className="relative">
          {/* biome-ignore lint/performance/noImgElement: short-lived signed Storage URLs; boxes need the image's natural size */}
          <img
            src={page.imageUrl}
            alt={`${DOCUMENT_LABELS[document.kind]}, page ${page.page}`}
            className="block h-auto w-full"
          />
          {boxes
            .filter((span) => span.page === page.page)
            .map((span) => (
              <div
                key={span.ref}
                data-testid="evidence-box"
                data-span-ref={span.ref}
                data-span-text={span.text}
                title={span.text}
                className="pointer-events-none absolute border-2 border-seal-red bg-seal-red/15"
                style={{
                  left: `${span.box.x0 * 100}%`,
                  top: `${span.box.y0 * 100}%`,
                  width: `${(span.box.x1 - span.box.x0) * 100}%`,
                  height: `${(span.box.y1 - span.box.y0) * 100}%`,
                }}
              />
            ))}
        </div>
      ))}
    </div>
  );
}
