import Link from "next/link";
import type { ReactNode } from "react";
import { ButtonLink } from "@/components/ui/button-link";
import { Icon } from "@/components/ui/icon";
import { LiveBadge } from "@/components/ui/live-badge";
import { Section } from "@/components/ui/section";
import { liveDemos } from "@/content/projects";
import type { Project } from "@/content/types";
import { BrowserFrame } from "./browser-frame";
import { ClientManagerPreview } from "./previews/client-manager-preview";
import { DocumentCompliancePreview } from "./previews/document-compliance-preview";
import { LedgerPreview } from "./previews/ledger-preview";

/** Each live demo's moving preview, by project slug. */
const previews: Record<string, (project: Project) => ReactNode> = {
  "document-compliance-checks": (project) => (
    <DocumentCompliancePreview project={project} />
  ),
  ledger: () => <LedgerPreview />,
  "client-manager": () => <ClientManagerPreview />,
};

export function LiveDemos() {
  return (
    <Section
      id="demos"
      eyebrow="Live demos"
      title="Open one and try it"
      intro="Real models, synthetic data, nothing staged. Each demo runs end to end in your browser."
      ground="paper"
    >
      <ol className="space-y-16 lg:space-y-24">
        {liveDemos.map((demo, index) => (
          <li key={demo.slug}>
            <DemoPanel demo={demo} index={index} />
          </li>
        ))}
      </ol>
    </Section>
  );
}

function DemoPanel({ demo, index }: { demo: Project; index: number }) {
  const href = demo.href ?? "#demos";
  const flipped = index % 2 === 1;

  return (
    <article
      aria-labelledby={`demo-${demo.slug}-title`}
      className={`outline-box grid bg-marble shadow-hard-lg ${flipped ? "lg:grid-cols-[1fr_1.35fr]" : "lg:grid-cols-[1.35fr_1fr]"}`}
    >
      <Link
        href={href}
        aria-label={`Open the ${demo.title} demo`}
        className={`group relative block min-w-0 border-ink bg-limestone p-4 max-lg:border-b-2 sm:p-8 ${flipped ? "lg:order-last lg:border-l-2" : "lg:border-r-2"}`}
      >
        <BrowserFrame address={href}>
          {previews[demo.slug]?.(demo)}
        </BrowserFrame>
        <span className="eyebrow outline-box press absolute right-6 bottom-6 inline-flex items-center gap-2 rounded-sm bg-federal-blue px-3 py-1.5 font-bold text-paper opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 sm:right-10 sm:bottom-10">
          Open demo <Icon name="arrow" size={14} />
        </span>
      </Link>

      <div className="flex flex-col p-6 sm:p-8">
        <div className="flex items-center justify-between gap-4">
          <p className="font-mono text-5xl leading-none font-bold text-federal-blue">
            {String(index + 1).padStart(2, "0")}
          </p>
          <LiveBadge label="Live now" />
        </div>
        <p className="eyebrow mt-8 text-ink-muted">{demo.sector}</p>
        <h3
          id={`demo-${demo.slug}-title`}
          className="mt-2 font-mono text-2xl leading-[1.1] font-bold uppercase [overflow-wrap:anywhere] sm:text-4xl"
        >
          {demo.title}
        </h3>
        <p className="mt-4 text-lg text-ink-muted">{demo.summary}</p>

        {demo.features ? (
          <ol className="mt-6 space-y-3 border-ink border-t-2 pt-5">
            {demo.features.map((feature, featureIndex) => (
              <li key={feature} className="flex gap-3">
                <span className="outline-box flex size-6 shrink-0 items-center justify-center bg-paper font-mono text-xs font-bold">
                  {featureIndex + 1}
                </span>
                {feature}
              </li>
            ))}
          </ol>
        ) : null}

        <p className="mt-6 font-mono text-sm font-bold text-ivy">
          {demo.outcome}
        </p>
        <ul aria-label="Tags" className="mt-4 flex flex-wrap gap-2">
          {demo.tags.map((tag) => (
            <li
              key={tag}
              className="eyebrow outline-box rounded-sm bg-paper px-2 py-0.5"
            >
              {tag}
            </li>
          ))}
        </ul>
        <div className="mt-auto pt-8">
          <ButtonLink href={href} className="w-full sm:w-auto">
            Launch demo
            <Icon name="arrow" size={18} />
          </ButtonLink>
        </div>
      </div>
    </article>
  );
}
