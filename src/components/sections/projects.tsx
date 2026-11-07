import Image from "next/image";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Icon, IconTile } from "@/components/ui/icon";
import { Section } from "@/components/ui/section";
import { featuredProjects } from "@/content/projects";
import type { Project } from "@/content/types";

export function Projects() {
  return (
    <Section
      id="projects"
      eyebrow="Projects"
      title="Selected AI systems"
      intro="Production systems I've designed and shipped. Full case studies are on the way."
      ground="paper"
    >
      <ul className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
        {featuredProjects.map((project) => (
          <li key={project.slug}>
            <ProjectCard project={project} />
          </li>
        ))}
      </ul>
    </Section>
  );
}

function ProjectCard({ project }: { project: Project }) {
  return (
    <article className="outline-box flex h-full flex-col bg-paper">
      {project.cover ? (
        <div className="relative aspect-[16/9] overflow-hidden border-ink border-b-2 bg-limestone">
          <Image
            src={project.cover.src}
            alt={project.cover.alt}
            fill
            sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
            className="object-cover"
          />
        </div>
      ) : (
        // Cover placeholder: swap for a screenshot or diagram per project.
        <div className="flex aspect-[16/9] items-center justify-center border-ink border-b-2 bg-limestone bg-[repeating-linear-gradient(135deg,transparent_0_12px,rgb(20_33_61/0.06)_12px_14px)]">
          <IconTile name={project.icon} />
        </div>
      )}
      <div className="flex flex-1 flex-col p-6">
        <div className="flex items-center justify-between gap-3">
          <p className="eyebrow text-ink-muted">{project.sector}</p>
          <Badge tone="haze">{project.status}</Badge>
        </div>
        <h3 className="mt-4 text-[1.375rem] leading-snug font-semibold">
          {project.title}
        </h3>
        <p className="mt-2 text-ink-muted">{project.summary}</p>
        <p className="mt-4 font-mono text-sm font-bold text-ivy">
          {project.outcome}
        </p>
        <ul aria-label="Tags" className="mt-4 flex flex-wrap gap-2">
          {project.tags.map((tag) => (
            <li
              key={tag}
              className="eyebrow outline-box rounded-sm px-2 py-0.5"
            >
              {tag}
            </li>
          ))}
        </ul>
        <div className="mt-auto pt-6">
          {project.href ? (
            <Link
              href={project.href}
              className="eyebrow inline-flex items-center gap-2 font-bold text-federal-blue hover:underline"
            >
              {project.status === "Live"
                ? "Try the live demo"
                : "Read case study"}{" "}
              <Icon name="arrow" size={16} />
            </Link>
          ) : (
            <p className="eyebrow text-ink-muted">Case study in progress</p>
          )}
        </div>
      </div>
    </article>
  );
}
