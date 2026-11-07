import { IconTile } from "@/components/ui/icon";
import { Section } from "@/components/ui/section";
import { services } from "@/content/services";

export function Services() {
  return (
    <Section
      id="services"
      eyebrow="What I do"
      title="Compliance work, automated"
      intro="Banks run on checks: identity, documents, names. I build the AI systems that take the repetitive part off your team and hold up to review."
      ground="paper"
    >
      <ul className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
        {services.map((service) => (
          <li
            key={service.title}
            className="outline-box flex flex-col bg-marble p-6"
          >
            <IconTile name={service.icon} />
            <h3 className="mt-6 text-[1.375rem] leading-snug font-semibold">
              {service.title}
            </h3>
            <p className="mt-3 text-ink-muted">{service.summary}</p>
            <ul className="mt-6 space-y-2 border-ink border-t-2 pt-4">
              {service.points.map((point) => (
                <li key={point} className="flex gap-3 text-sm">
                  <span
                    aria-hidden="true"
                    className="mt-1.5 size-2 shrink-0 bg-federal-blue"
                  />
                  {point}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </Section>
  );
}
