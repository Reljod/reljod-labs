import type { IconName } from "@/components/ui/icon";

export type Link = {
  label: string;
  href: string;
};

export type Profile = {
  name: string;
  title: string;
  focus: string;
  location: string;
  email: string;
  links: Link[];
  headline: string;
  intro: string;
};

export type Metric = {
  figure: string;
  label: string;
  source: string;
};

export type Service = {
  icon: IconName;
  title: string;
  summary: string;
  points: string[];
};

export type ApproachStep = {
  title: string;
  summary: string;
};

export type ExperienceSector =
  | "Banking"
  | "Financial data"
  | "AI SaaS"
  | "Consulting"
  | "Hardware";

export type Experience = {
  role: string;
  company: string;
  location: string;
  period: string;
  sector: ExperienceSector;
  highlight?: boolean;
  points: string[];
  stack: string[];
};

export type Credential = {
  title: string;
  detail: string;
};

export type ProjectStatus = "Case study soon" | "Live" | "In progress";

export type Project = {
  slug: string;
  icon: IconName;
  title: string;
  sector: string;
  summary: string;
  outcome: string;
  tags: string[];
  status: ProjectStatus;
  /** A live demo when `status` is "Live", otherwise the case study. */
  href?: string;
  cover?: { src: string; alt: string };
  /** What a visitor gets to do once they open a live demo. */
  features?: string[];
};
