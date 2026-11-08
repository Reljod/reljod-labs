import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Section } from "@/components/ui/section";
import { credentials, experience } from "@/content/experience";
import type { ExperienceSector } from "@/content/types";
import { source, sourcePath } from "@/features/ledger/domain/source-paths";

const sectorTone: Record<ExperienceSector, BadgeTone> = {
  Banking: "ink",
  "Financial data": "haze",
  "AI SaaS": "paper",
  Consulting: "paper",
  Hardware: "limestone",
};

export function Experience() {
  return (
    <Section
      id="experience"
      eyebrow="Experience"
      title="Seven years, from finance data to digital banking"
      intro="Three years inside a leading Philippine digital bank, two at a global financial data company, and the last two shipping production AI."
    >
      <ol className="outline-box divide-y-2 divide-ink bg-paper">
        {experience.map((job, index) => (
          <li
            key={`${job.company}-${job.period}`}
            {...source(sourcePath.job(index))}
            className={`grid gap-4 p-6 md:grid-cols-[14rem_1fr] md:gap-8 ${job.highlight ? "bg-morning-haze" : ""}`}
          >
            <div>
              <p className="font-mono text-sm font-bold uppercase">
                {job.period}
              </p>
              <p className="mt-1 text-sm text-ink-muted">{job.location}</p>
              <div className="mt-3">
                <Badge tone={sectorTone[job.sector]}>{job.sector}</Badge>
              </div>
            </div>
            <div>
              <h3 className="text-[1.375rem] leading-snug font-semibold">
                {job.role}{" "}
                <span className="text-ink-muted">· {job.company}</span>
              </h3>
              <ul className="mt-3 space-y-2">
                {job.points.map((point, pointIndex) => (
                  <li
                    key={point}
                    className="flex gap-3"
                    {...source(sourcePath.jobPoint(index, pointIndex))}
                  >
                    <span
                      aria-hidden="true"
                      className="mt-2.5 h-0.5 w-3 shrink-0 bg-ink"
                    />
                    {point}
                  </li>
                ))}
              </ul>
              <ul aria-label="Stack" className="mt-4 flex flex-wrap gap-2">
                {job.stack.map((item) => (
                  <li
                    key={item}
                    className="eyebrow outline-box rounded-sm bg-paper px-2 py-0.5"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </li>
        ))}
      </ol>

      <dl className="mt-8 grid gap-8 md:grid-cols-2">
        {credentials.map((credential, index) => (
          <div
            key={credential.title}
            className="border-ink border-t-2 pt-4"
            {...source(sourcePath.credential(index))}
          >
            <dt className="font-semibold">{credential.title}</dt>
            <dd className="mt-1 text-sm text-ink-muted">{credential.detail}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}
