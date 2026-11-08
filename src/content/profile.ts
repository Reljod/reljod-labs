import type { Metric, Profile } from "./types";

export const profile: Profile = {
  name: "Reljod Oreta",
  title: "AI Consultant",
  focus: "Banking and financial services",
  location: "Metro Manila, Philippines · Open to relocation",
  email: "oretareljod@gmail.com",
  links: [
    { label: "LinkedIn", href: "https://linkedin.com/in/reljodoreta" },
    { label: "GitHub", href: "https://github.com/Reljod" },
  ],
  headline: "AI for banks, built to ship",
  intro:
    "I help banks and financial firms turn slow, manual compliance work into AI services that run in production: KYC, document checks and name matching. Seven years in software, the last two shipping multi-agent LLM systems for a digital bank and multi-tenant SaaS platforms.",
};

/** The closing pitch in the contact band. */
export const contactPitch = {
  heading: "Let's map your first AI win",
  body: "Tell me where your team spends the most manual hours on checks and reviews. I'll come back with where AI fits, what it takes, and how we'd prove it works.",
};

/* Every figure below comes from shipped work on the resume. Never add one that isn't. */

/** Career-level highlights for the impact band under the hero. */
export const highlights: Metric[] = [
  {
    figure: "7 yrs",
    label: "Shipping production software",
    source: "2019 – present",
  },
  {
    figure: "3 yrs",
    label: "Inside a leading Philippine digital bank",
    source: "Maya Philippines",
  },
  {
    figure: "2 yrs",
    label: "On a global financial data platform",
    source: "FactSet",
  },
  {
    figure: "95–97%",
    label: "Ineligible records screened before LLM spend",
    source: "Cloud Employee",
  },
];
