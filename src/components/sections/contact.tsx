import { ButtonLink } from "@/components/ui/button-link";
import { Icon } from "@/components/ui/icon";
import { profile } from "@/content/profile";

/** The page's one brass moment. */
export function Contact() {
  return (
    <section
      id="contact"
      aria-labelledby="contact-title"
      className="border-ink border-t-2 bg-brass"
    >
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-16 sm:px-6 lg:grid-cols-[1.4fr_1fr] lg:items-end">
        <div>
          <p className="eyebrow mb-3">Contact</p>
          <h2
            id="contact-title"
            className="font-mono text-3xl leading-[1.15] font-bold uppercase sm:text-5xl"
          >
            Let's map your first AI win
          </h2>
          <p className="mt-4 max-w-xl text-lg">
            Tell me where your team spends the most manual hours on checks and
            reviews. I'll come back with where AI fits, what it takes, and how
            we'd prove it works.
          </p>
        </div>
        <div className="flex flex-wrap gap-4 lg:justify-end">
          <ButtonLink href={`mailto:${profile.email}`} variant="secondary">
            <Icon name="mail" size={18} />
            Email me
          </ButtonLink>
          {profile.links.map((link) => (
            <ButtonLink
              key={link.href}
              href={link.href}
              variant="secondary"
              target="_blank"
              rel="noreferrer"
            >
              {link.label}
            </ButtonLink>
          ))}
        </div>
      </div>
    </section>
  );
}
