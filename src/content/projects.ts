import type { Project } from "./types";

/** How many projects the home page shows. The rest stay in the list for a future projects page. */
export const FEATURED_PROJECT_LIMIT = 6;

/*
 * Template entries. Replace `outcome` placeholders with real, approved figures
 * before publishing. Never invent client names or numbers.
 */
export const projects: Project[] = [
  {
    slug: "kyc-automation",
    icon: "id-card",
    title: "In-house KYC automation",
    sector: "Digital bank",
    summary:
      "AI identity verification that replaced a paid third-party KYC vendor for a Philippine digital bank and wallet.",
    outcome: "90% lower KYC operating cost",
    tags: ["KYC", "Document AI", "AWS"],
    status: "Case study soon",
  },
  {
    slug: "document-compliance-checks",
    icon: "document-check",
    title: "Document compliance checks",
    sector: "Banking onboarding",
    summary:
      "Pre-screens an onboarding pack (ID, proof of address, certified copy) against a compliance rulebook before a person reviews it.",
    outcome: "Every finding boxed on the source page",
    tags: ["Compliance", "OCR", "LLM"],
    status: "Live",
    href: "/demos/document-compliance",
    cover: {
      src: "/projects/document-compliance.jpg",
      alt: "Specimen passport from the fictional Republic of Meridia, one of the demo's synthetic documents",
    },
  },
  {
    slug: "name-matching",
    icon: "match",
    title: "Name matching engine",
    sector: "[Client sector]",
    summary:
      "Matching names across documents and records to support identity verification.",
    outcome: "[Outcome metric]",
    tags: ["Identity", "Matching"],
    status: "Case study soon",
  },
  {
    slug: "tampering-detection",
    icon: "scan",
    title: "Tampering and illegibility detection",
    sector: "[Client sector]",
    summary:
      "Flagging altered or unreadable documents before they reach a reviewer's queue.",
    outcome: "[Outcome metric]",
    tags: ["Computer vision", "Document AI"],
    status: "Case study soon",
  },
  {
    slug: "eligibility-pipeline",
    icon: "agents",
    title: "Multi-agent eligibility pipeline",
    sector: "AI SaaS",
    summary:
      "Agents on AWS Lambda that screen out ineligible records before report generation, cutting wasted inference spend.",
    outcome: "95–97% of ineligible records screened out",
    tags: ["Multi-agent", "AWS Lambda"],
    status: "Case study soon",
  },
  {
    slug: "marketing-intelligence",
    icon: "chart",
    title: "Marketing intelligence",
    sector: "[Client sector]",
    summary:
      "AI features that turn marketing-related data into insights a team can act on.",
    outcome: "[Outcome metric]",
    tags: ["Analytics", "LLM"],
    status: "Case study soon",
  },
  {
    slug: "tennis-line-calling",
    icon: "scan",
    title: "Computer vision line calling",
    sector: "Sports tech",
    summary:
      "In and out line decisions, ball speed and trajectory from match video.",
    outcome: "[Outcome metric]",
    tags: ["OpenCV", "YOLO"],
    status: "Case study soon",
  },
];

export const featuredProjects = projects.slice(0, FEATURED_PROJECT_LIMIT);
