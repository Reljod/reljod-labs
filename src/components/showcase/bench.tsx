import type { CSSProperties } from "react";
import { Badge } from "@/components/ui/badge";
import { IconTile } from "@/components/ui/icon";
import { Section } from "@/components/ui/section";
import { benchProjects } from "@/content/projects";

/** Work that isn't a demo yet: small cards drifting on the lab bench, each on its own rhythm. */
export function Bench() {
  return (
    <Section
      id="bench"
      eyebrow="On the bench"
      title="Coming soon to the lab"
      intro="Systems from client work and side projects, being turned into demos you can run."
      ground="limestone"
    >
      <ul className="flex flex-wrap justify-center gap-x-6 gap-y-8 pb-4">
        {benchProjects.map((project, index) => (
          <li
            key={project.slug}
            className={`w-full sm:w-60 ${index % 2 === 1 ? "sm:mt-10" : ""}`}
          >
            <article
              className="outline-box flex h-full flex-col bg-paper p-4 shadow-hard-md motion-safe:animate-bench-float"
              style={
                {
                  "--tilt": `${index % 2 === 0 ? -1.5 : 1.5}deg`,
                  animationDuration: `${5 + (index % 3) * 1.25}s`,
                  animationDelay: `-${index * 0.85}s`,
                } as CSSProperties
              }
            >
              <div className="flex items-start justify-between gap-3">
                <IconTile name={project.icon} className="bg-morning-haze" />
                <Badge tone="limestone">Soon</Badge>
              </div>
              <h3 className="mt-4 leading-snug font-semibold">
                {project.title}
              </h3>
              <p className="eyebrow mt-2 text-ink-muted">
                {project.tags.join(" · ")}
              </p>
            </article>
          </li>
        ))}
      </ul>
    </Section>
  );
}
