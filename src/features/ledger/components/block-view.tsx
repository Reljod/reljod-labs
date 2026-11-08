import type { ContentBlock } from "../domain/content-tree";

type BlockViewProps = {
  block: ContentBlock;
  /** compact on the Stack, in flight and as a Source block; full when a Source block is opened. */
  size: "compact" | "full";
};

/** A Content block, drawn the same way wherever Ledger puts it. */
export function BlockView({ block, size }: BlockViewProps) {
  const full = size === "full";
  const box = `outline-box h-full bg-paper ${full ? "p-6" : "p-3 text-sm"}`;

  switch (block.kind) {
    case "figure":
      return (
        <div className={box}>
          <p
            className={`font-mono leading-none font-bold text-ivy ${full ? "text-5xl" : "text-2xl"}`}
          >
            {block.figure}
          </p>
          <p className={full ? "mt-3 text-lg" : "mt-1"}>{block.label}</p>
          <p className="eyebrow mt-2 text-ink-muted">{block.context}</p>
        </div>
      );
    case "quote":
      return (
        <figure className={box}>
          <blockquote
            className={
              full ? "text-xl leading-snug font-semibold" : "line-clamp-3"
            }
          >
            {block.text}
          </blockquote>
          <figcaption className="eyebrow mt-3 text-ink-muted">
            {block.context}
          </figcaption>
        </figure>
      );
    case "card":
      return (
        <div className={box}>
          <p className="eyebrow text-ink-muted">{block.eyebrow}</p>
          <p
            className={`font-semibold ${full ? "mt-3 text-[1.375rem] leading-snug" : "mt-1"}`}
          >
            {block.title}
          </p>
          <p
            className={`text-ink-muted ${full ? "mt-2" : "mt-1 line-clamp-2"}`}
          >
            {block.body}
          </p>
          {block.note && full ? (
            <p className="mt-4 font-mono text-sm font-bold text-ivy">
              {block.note}
            </p>
          ) : null}
        </div>
      );
    case "job":
      return (
        <div className={box}>
          <p className="font-mono text-xs font-bold uppercase">
            {block.period}
          </p>
          <p
            className={`font-semibold ${full ? "mt-2 text-[1.375rem] leading-snug" : "mt-1"}`}
          >
            {block.role}{" "}
            <span className="text-ink-muted">· {block.company}</span>
          </p>
          {full ? (
            <ul className="mt-3 space-y-2">
              {block.points.map((point) => (
                <li key={point} className="flex gap-3">
                  <span
                    aria-hidden="true"
                    className="mt-2.5 h-0.5 w-3 shrink-0 bg-ink"
                  />
                  {point}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 line-clamp-2 text-ink-muted">
              {block.points[0]}
            </p>
          )}
        </div>
      );
    case "contact":
      return (
        <div className={`${box} bg-brass`}>
          <p
            className={`font-mono font-bold uppercase ${full ? "text-2xl" : ""}`}
          >
            {block.heading}
          </p>
          <p className={full ? "mt-3 text-lg" : "mt-1 line-clamp-2"}>
            {block.body}
          </p>
          {full ? (
            <div className="mt-6 flex flex-wrap gap-3">
              <a
                href={`mailto:${block.email}`}
                className="outline-box press inline-flex min-h-11 items-center rounded-sm bg-paper px-4 font-mono text-sm font-bold tracking-[0.1em] uppercase"
              >
                Email me
              </a>
              {block.links.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  className="outline-box press inline-flex min-h-11 items-center rounded-sm bg-paper px-4 font-mono text-sm font-bold tracking-[0.1em] uppercase"
                >
                  {link.label}
                </a>
              ))}
            </div>
          ) : null}
        </div>
      );
  }
}
