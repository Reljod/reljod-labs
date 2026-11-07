import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button-link";
import { Icon } from "@/components/ui/icon";
import { kycCaseFile, profile } from "@/content/profile";

export function Hero() {
  return (
    <section id="top" aria-labelledby="hero-title" className="bg-marble">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.2fr_1fr] lg:py-24">
        <div>
          <p className="eyebrow mb-6 text-ink-muted">
            {profile.title} · {profile.focus}
          </p>
          <h1
            id="hero-title"
            className="font-mono text-5xl leading-none font-bold tracking-[-0.02em] uppercase sm:text-6xl lg:text-display"
          >
            {profile.headline}
          </h1>
          <p className="mt-8 max-w-xl text-xl leading-normal">
            {profile.intro}
          </p>
          <div className="mt-10 flex flex-wrap gap-4">
            <ButtonLink href="#contact">
              Book a call
              <Icon name="arrow" size={18} />
            </ButtonLink>
            <ButtonLink href="#projects" variant="secondary">
              See the work
            </ButtonLink>
          </div>
        </div>

        <aside
          aria-label="Case file"
          className="outline-box bg-paper shadow-hard-lg"
        >
          <div className="flex items-center justify-between gap-4 border-ink border-b-2 bg-morning-haze px-6 py-4">
            <p className="eyebrow">Case file · Digital bank</p>
            <Badge tone="paper">KYC</Badge>
          </div>
          <div className="p-6">
            <h2 className="text-[1.375rem] leading-snug font-semibold">
              Replacing a third-party KYC vendor with in-house AI at Maya
              Philippines
            </h2>
            <dl className="mt-6 divide-y-2 divide-ink border-ink border-y-2">
              {kycCaseFile.map((metric) => (
                <div
                  key={metric.label}
                  className="flex items-baseline justify-between gap-4 py-4"
                >
                  <dt className="text-sm text-ink-muted">{metric.label}</dt>
                  <dd className="font-mono text-3xl leading-none font-bold text-ivy">
                    {metric.figure}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-sm text-ink-muted">
              Built with the bank's data science team, 2022–2025.
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}
