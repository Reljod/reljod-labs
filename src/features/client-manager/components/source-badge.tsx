import type { SourceKind } from "../domain/events";

const GLYPH: Record<SourceKind, { text: string; tone: string }> = {
  note: { text: "NOTE", tone: "#4a4f5b" },
  pdf: { text: "PDF", tone: "#b23a2b" },
  image: { text: "IMG", tone: "#6b4226" },
  sheet: { text: "XLS", tone: "#2f6b3f" },
  doc: { text: "DOC", tone: "#1d4e89" },
  text: { text: "TXT", tone: "#4a4f5b" },
  web: { text: "WEB", tone: "#6fa0dc" },
};

/** What kind of document a Source is, as a small coloured tag. */
export function SourceBadge({ kind }: { kind: SourceKind }) {
  const glyph = GLYPH[kind] ?? GLYPH.text;
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-[2px] px-1 py-px font-mono text-[0.55rem] font-bold tracking-[0.04em] text-paper"
      style={{ background: glyph.tone }}
    >
      {glyph.text}
    </span>
  );
}
