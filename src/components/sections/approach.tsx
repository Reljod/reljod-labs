import { Section } from "@/components/ui/section";
import { approach } from "@/content/services";

export function Approach() {
  return (
    <Section
      id="approach"
      eyebrow="How I work"
      title="From unclear need to shipped system"
      intro="The hardest part is rarely the model. It's getting the business to say where it is today and where it wants to be. This is how I get there."
      ground="limestone"
    >
      <ol className="outline-box grid bg-paper md:grid-cols-2 lg:grid-cols-4">
        {approach.map((step, index) => (
          <li
            key={step.title}
            className="border-ink p-6 not-last:border-b-2 md:max-lg:odd:border-r-2 md:max-lg:nth-3:border-b-0 lg:not-last:border-r-2 lg:not-last:border-b-0"
          >
            <p className="font-mono text-4xl font-bold text-federal-blue">
              {String(index + 1).padStart(2, "0")}
            </p>
            <h3 className="mt-4 text-[1.375rem] leading-snug font-semibold">
              {step.title}
            </h3>
            <p className="mt-3 text-ink-muted">{step.summary}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}
