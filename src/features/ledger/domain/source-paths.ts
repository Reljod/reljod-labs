/**
 * Source paths name every piece of the page Ledger may cut out. The page marks
 * each piece with `data-ledger-source`, and the content tree is keyed by the
 * same paths, so a Build plan can only point at words the page really shows.
 */
export const SOURCE_ATTRIBUTE = "data-ledger-source";

export const sourcePath = {
  headline: "profile.headline",
  intro: "profile.intro",
  highlight: (index: number) => `highlights.${index}`,
  service: (index: number) => `services.${index}`,
  serviceSummary: (index: number) => `services.${index}.summary`,
  servicePoint: (index: number, point: number) =>
    `services.${index}.points.${point}`,
  approachStep: (index: number) => `approach.${index}`,
  approachSummary: (index: number) => `approach.${index}.summary`,
  job: (index: number) => `experience.${index}`,
  jobPoint: (index: number, point: number) =>
    `experience.${index}.points.${point}`,
  credential: (index: number) => `credentials.${index}`,
  project: (index: number) => `projects.${index}`,
  projectSummary: (index: number) => `projects.${index}.summary`,
  projectOutcome: (index: number) => `projects.${index}.outcome`,
  contact: "contact",
} as const;

/** Spread onto the element that renders a source: `<li {...source(path)}>`. */
export function source(path: string) {
  return { [SOURCE_ATTRIBUTE]: path };
}
