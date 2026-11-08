import { credentials, experience } from "@/content/experience";
import { contactPitch, highlights, profile } from "@/content/profile";
import { featuredProjects } from "@/content/projects";
import { approach, services } from "@/content/services";
import type { Link } from "@/content/types";
import { sourcePath } from "./source-paths";

/** What a Content block looks like once Ledger has cut it out of the page. */
export type ContentBlock =
  | { kind: "figure"; figure: string; label: string; context: string }
  | { kind: "quote"; text: string; context: string }
  | {
      kind: "card";
      eyebrow: string;
      title: string;
      body: string;
      note?: string;
    }
  | {
      kind: "job";
      period: string;
      role: string;
      company: string;
      points: string[];
    }
  | {
      kind: "contact";
      heading: string;
      body: string;
      email: string;
      links: Link[];
    };

export type ContentKind = ContentBlock["kind"];

export type SourceNode = {
  path: string;
  /** The home section the piece sits in, so Ledger knows where to run. */
  section: string;
  block: ContentBlock;
  /** A quote can be cut down to an excerpt; anything else is taken whole. */
  excerptable: boolean;
};

export type ContentTree = ReadonlyMap<string, SourceNode>;

/** Everything a block says, as one line of plain text. */
export function blockText(block: ContentBlock): string {
  switch (block.kind) {
    case "figure":
      return `${block.figure} ${block.label} (${block.context})`;
    case "quote":
      return block.text;
    case "card":
      return [block.eyebrow, block.title, block.body, block.note]
        .filter(Boolean)
        .join(" · ");
    case "job":
      return `${block.role} at ${block.company}, ${block.period}. ${block.points.join(" ")}`;
    case "contact":
      return `${block.heading}. ${block.body} Email ${block.email}. ${block.links.map((link) => link.label).join(", ")}.`;
  }
}

/** Every piece of the home page Ledger may cut, keyed by source path. */
export function buildContentTree(): ContentTree {
  const nodes: SourceNode[] = [];
  const add = (
    path: string,
    section: string,
    block: ContentBlock,
    excerptable = block.kind === "quote",
  ) => nodes.push({ path, section, block, excerptable });

  add(sourcePath.headline, "hero", {
    kind: "quote",
    text: profile.headline,
    context: `${profile.name} · ${profile.title}`,
  });
  add(sourcePath.intro, "hero", {
    kind: "quote",
    text: profile.intro,
    context: profile.name,
  });

  highlights.forEach((metric, index) => {
    add(sourcePath.highlight(index), "highlights", {
      kind: "figure",
      figure: metric.figure,
      label: metric.label,
      context: metric.source,
    });
  });

  services.forEach((service, index) => {
    add(sourcePath.service(index), "services", {
      kind: "card",
      eyebrow: "Service",
      title: service.title,
      body: service.summary,
      note: service.points.join(" · "),
    });
    add(sourcePath.serviceSummary(index), "services", {
      kind: "quote",
      text: service.summary,
      context: service.title,
    });
    service.points.forEach((point, pointIndex) => {
      add(sourcePath.servicePoint(index, pointIndex), "services", {
        kind: "quote",
        text: point,
        context: service.title,
      });
    });
  });

  approach.forEach((step, index) => {
    add(sourcePath.approachStep(index), "approach", {
      kind: "card",
      eyebrow: `Step ${String(index + 1).padStart(2, "0")}`,
      title: step.title,
      body: step.summary,
    });
    add(sourcePath.approachSummary(index), "approach", {
      kind: "quote",
      text: step.summary,
      context: step.title,
    });
  });

  experience.forEach((job, index) => {
    add(sourcePath.job(index), "experience", {
      kind: "job",
      period: job.period,
      role: job.role,
      company: job.company,
      points: job.points,
    });
    job.points.forEach((point, pointIndex) => {
      add(sourcePath.jobPoint(index, pointIndex), "experience", {
        kind: "quote",
        text: point,
        context: `${job.role} · ${job.company}`,
      });
    });
  });

  credentials.forEach((credential, index) => {
    add(sourcePath.credential(index), "experience", {
      kind: "card",
      eyebrow: "Credential",
      title: credential.title,
      body: credential.detail,
    });
  });

  featuredProjects.forEach((project, index) => {
    add(sourcePath.project(index), "projects", {
      kind: "card",
      eyebrow: project.sector,
      title: project.title,
      body: project.summary,
      note: project.outcome,
    });
    add(sourcePath.projectSummary(index), "projects", {
      kind: "quote",
      text: project.summary,
      context: project.title,
    });
    add(sourcePath.projectOutcome(index), "projects", {
      kind: "quote",
      text: project.outcome,
      context: project.title,
    });
  });

  add(sourcePath.contact, "contact", {
    kind: "contact",
    heading: contactPitch.heading,
    body: contactPitch.body,
    email: profile.email,
    links: profile.links,
  });

  return new Map(nodes.map((node) => [node.path, node]));
}

export const contentTree = buildContentTree();

/** The tree as the model reads it: one line per source path. */
export function describeContentTree(tree: ContentTree = contentTree): string {
  return [...tree.values()]
    .map(
      (node) =>
        `${node.path} | ${node.section} | ${node.block.kind}${node.excerptable ? " (excerptable)" : ""} | ${blockText(node.block)}`,
    )
    .join("\n");
}
