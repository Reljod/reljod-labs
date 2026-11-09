import Link from "next/link";
import { ButtonLink } from "@/components/ui/button-link";
import { Icon } from "@/components/ui/icon";
import { LiveBadge } from "@/components/ui/live-badge";
import { Mark } from "@/components/ui/mark";
import { lab } from "@/content/lab";
import { benchProjects, liveDemos } from "@/content/projects";

/** The landing page's opener: what the lab is, and an index of everything in it. */
export function LabHero() {
  return (
    <section
      id="top"
      aria-labelledby="hero-title"
      className="bg-marble bg-[linear-gradient(rgb(20_33_61/0.05)_2px,transparent_2px),linear-gradient(90deg,rgb(20_33_61/0.05)_2px,transparent_2px)] bg-size-[40px_40px]"
    >
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.25fr_1fr] lg:py-24">
        <div>
          <p className="eyebrow mb-6 flex items-center gap-3 text-ink-muted">
            <Mark size={20} className="text-ink" />
            {lab.name} · {lab.tagline}
          </p>
          <h1
            id="hero-title"
            className="font-mono text-5xl leading-none font-bold tracking-[-0.02em] uppercase sm:text-6xl lg:text-display"
          >
            {lab.headline}
          </h1>
          <p className="mt-8 max-w-xl text-xl leading-normal">{lab.intro}</p>
          <div className="mt-10 flex flex-wrap gap-4">
            <ButtonLink href="#demos">
              Try a live demo
              <Icon name="arrow" size={18} />
            </ButtonLink>
            <ButtonLink href="/about" variant="secondary">
              About Reljod
            </ButtonLink>
          </div>
        </div>

        <nav
          aria-label="Lab index"
          className="outline-box bg-paper shadow-hard-lg"
        >
          <div className="flex items-center justify-between gap-4 border-ink border-b-2 bg-ink px-5 py-3 text-paper">
            <p className="eyebrow">Lab index</p>
            <p className="eyebrow text-clear-sky">
              {liveDemos.length} live · {benchProjects.length} on the bench
            </p>
          </div>
          <ol className="divide-y-2 divide-ink">
            {liveDemos.map((demo, index) => (
              <li key={demo.slug}>
                <Link
                  href={demo.href ?? "#demos"}
                  className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-morning-haze"
                >
                  <span className="font-mono text-2xl font-bold text-federal-blue">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{demo.title}</span>
                    <span className="eyebrow block text-ink-muted">
                      {demo.sector}
                    </span>
                  </span>
                  <LiveBadge />
                  <Icon
                    name="arrow"
                    size={18}
                    className="transition-transform group-hover:translate-x-1"
                  />
                </Link>
              </li>
            ))}
            <li className="flex flex-wrap gap-2 bg-limestone px-5 py-4">
              <span className="eyebrow mr-1 self-center text-ink-muted">
                Soon
              </span>
              {benchProjects.map((project) => (
                <a
                  key={project.slug}
                  href="#bench"
                  className="eyebrow outline-box rounded-sm bg-paper px-2 py-0.5 text-ink-muted hover:text-ink"
                >
                  {project.title}
                </a>
              ))}
            </li>
          </ol>
        </nav>
      </div>
    </section>
  );
}
