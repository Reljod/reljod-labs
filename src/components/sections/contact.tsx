import { ButtonLink } from "@/components/ui/button-link";
import { Icon } from "@/components/ui/icon";
import { contactPitch, profile } from "@/content/profile";
import { source, sourcePath } from "@/features/ledger/domain/source-paths";

/** The page's one brass moment. */
export function Contact() {
  return (
    <section
      id="contact"
      aria-labelledby="contact-title"
      className="border-ink border-t-2 bg-brass"
      {...source(sourcePath.contact)}
    >
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-16 sm:px-6 lg:grid-cols-[1.4fr_1fr] lg:items-end">
        <div>
          <p className="eyebrow mb-3">Contact</p>
          <h2
            id="contact-title"
            className="font-mono text-3xl leading-[1.15] font-bold uppercase sm:text-5xl"
          >
            {contactPitch.heading}
          </h2>
          <p className="mt-4 max-w-xl text-lg">{contactPitch.body}</p>
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
