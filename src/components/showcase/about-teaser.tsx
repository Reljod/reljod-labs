import { ButtonLink } from "@/components/ui/button-link";
import { Icon } from "@/components/ui/icon";
import { highlights, profile } from "@/content/profile";

/** Who runs the lab, in brief; the full story lives on the About page. */
export function AboutTeaser() {
  return (
    <section
      aria-labelledby="about-teaser-title"
      className="border-ink border-t-2 bg-ink text-paper"
    >
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_1.1fr] lg:items-center">
        <div>
          <p className="eyebrow mb-3 text-clear-sky">Behind the lab</p>
          <h2
            id="about-teaser-title"
            className="font-mono text-3xl leading-[1.15] font-bold uppercase sm:text-[2rem]"
          >
            {profile.name}
          </h2>
          <p className="mt-2 font-mono text-sm uppercase tracking-[0.1em] text-marble">
            {profile.title} · {profile.focus}
          </p>
          <p className="mt-6 text-lg text-marble">{profile.intro}</p>
          <div className="mt-8">
            <ButtonLink href="/about" variant="secondary">
              More about me
              <Icon name="arrow" size={18} />
            </ButtonLink>
          </div>
        </div>
        <ul className="grid grid-cols-2 border-2 border-paper/25">
          {highlights.map((metric) => (
            <li
              key={metric.label}
              className="border-paper/25 p-5 odd:border-r-2 nth-[-n+2]:border-b-2"
            >
              <p className="font-mono text-3xl leading-tight font-bold sm:text-4xl">
                {metric.figure}
              </p>
              <p className="mt-2 text-sm text-marble">{metric.label}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
