import { highlights } from "@/content/profile";
import { source, sourcePath } from "@/features/ledger/domain/source-paths";

export function ImpactBand() {
  return (
    <section
      aria-label="Highlights"
      className="border-ink border-t-2 bg-ink text-paper"
    >
      <ul className="mx-auto grid max-w-6xl grid-cols-2 lg:grid-cols-4">
        {highlights.map((metric, index) => (
          <li
            key={metric.label}
            {...source(sourcePath.highlight(index))}
            className="border-paper/25 px-4 py-8 sm:px-6 max-lg:odd:border-r-2 max-lg:nth-[-n+2]:border-b-2 lg:not-last:border-r-2"
          >
            <p className="font-mono text-4xl leading-tight font-bold">
              {metric.figure}
            </p>
            <p className="mt-2 text-sm text-marble">{metric.label}</p>
            <p className="eyebrow mt-3 text-clear-sky">{metric.source}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
