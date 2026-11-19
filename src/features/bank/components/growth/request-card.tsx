"use client";

import type { GrowthRequestView } from "../../domain/views";
import { formatStamp } from "../shell/time";
import { Badge } from "../ui";
import { safeHref } from "./links";
import { GrowthTracker } from "./steps";

/** One Growth request: where it stands, what was asked (quoted, untrusted), and its links. */
export function RequestCard({ request }: { request: GrowthRequestView }) {
  const issue = safeHref(request.issueUrl);
  const pull = safeHref(request.prUrl);
  return (
    <article
      className="outline-box rounded-sm bg-paper shadow-hard-sm"
      data-testid={`bank-growth-request-${request.id}`}
    >
      <header className="flex flex-wrap items-center gap-2 border-ink/20 border-b px-3 py-2">
        <Badge tone={request.kind === "bug" ? "amber" : "blue"}>
          {request.kind}
        </Badge>
        <h3 className="min-w-0 flex-1 text-sm font-semibold">
          {request.title}
        </h3>
        <span className="font-mono text-[0.65rem] text-ink-muted tabular-nums">
          updated {formatStamp(request.updatedAt)}
        </span>
      </header>
      <div className="space-y-2.5 px-3 py-2.5">
        <GrowthTracker status={request.status} />
        <figure>
          <figcaption className="eyebrow mb-1 text-[0.6rem] font-bold text-ink-muted">
            What was asked (untrusted text, quoted)
          </figcaption>
          <blockquote className="max-h-32 overflow-y-auto border-ink/40 border-l-4 bg-marble px-3 py-1.5 font-mono text-xs whitespace-pre-wrap [overflow-wrap:anywhere]">
            {request.want}
          </blockquote>
        </figure>
        {request.statusNote ? (
          <p className="text-xs text-ink-muted">{request.statusNote}</p>
        ) : null}
        {issue || pull ? (
          <p className="flex flex-wrap gap-3 font-mono text-xs font-bold">
            {issue ? (
              <a
                href={issue}
                target="_blank"
                rel="noreferrer"
                className="text-federal-blue underline"
              >
                Issue #{request.issueNumber}
              </a>
            ) : null}
            {pull ? (
              <a
                href={pull}
                target="_blank"
                rel="noreferrer"
                className="text-federal-blue underline"
              >
                PR #{request.prNumber}
              </a>
            ) : null}
          </p>
        ) : null}
      </div>
    </article>
  );
}
