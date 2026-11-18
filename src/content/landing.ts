/*
 * The landing page's words, written for someone outside tech: what the site
 * is, who made it and what each project does, in plain sentences. Every fact
 * about Reljod comes from `profile.ts`, `experience.ts` or `projects.ts`;
 * never add one that isn't there.
 */

/** The page's scenes, in order. The Index lists them and jumps to their ids. */
export const scenes = [
  { id: "top", title: "The desk" },
  { id: "who", title: "Who's at the desk" },
  { id: "how", title: "What the AI does" },
  { id: "demos", title: "The projects" },
  { id: "bench", title: "Coming soon" },
  { id: "lab", title: "What is reljod.com" },
  { id: "contact", title: "Say hello" },
] as const;

export type SceneId = (typeof scenes)[number]["id"];

/** A scene's two-digit number, as the Index and each scene's eyebrow show it. */
export function sceneNumber(id: SceneId): string {
  return String(scenes.findIndex((scene) => scene.id === id) + 1).padStart(
    2,
    "0",
  );
}

export const desk = {
  eyebrow: "reljod.com · a one-person AI lab",
  lines: ["Banks run on paperwork.", "I build AI that reads it."],
  intro:
    "I'm Reljod Oreta, a software engineer in Metro Manila. Every project on this site is a working AI helper for banks: it checks documents, finds names, answers questions, and shows you exactly where each answer came from.",
  hint: "Tap the page and watch the AI read it.",
  readHint: "Tap a note to see the line it came from.",
} as const;

/** What the AI pins to the board: a plain fact, or something a person must look at. */
export type DeskNote = { kind: "fact" | "flag"; text: string };
export type DeskLine = { label: string; value: string; note?: DeskNote };
/** A made-up Meridia document on the opening scene's clipboard. */
export type DeskPage = { title: string; lines: DeskLine[] };

/** Every page has five lines, three of them noted, so each fits the stage. */
export const deskPages: DeskPage[] = [
  {
    title: "Account opening form",
    lines: [
      {
        label: "Full name",
        value: "Amara T. Quizon",
        note: { kind: "fact", text: "New customer: Amara T. Quizon." },
      },
      { label: "Date of birth", value: "03 MAR 1991" },
      {
        label: "Home address",
        value: "21 Lantern Street",
        note: { kind: "fact", text: "Lives at 21 Lantern Street." },
      },
      { label: "Occupation", value: "Florist" },
      {
        label: "Signature",
        value: "",
        note: { kind: "flag", text: "Not signed. Send it back first." },
      },
    ],
  },
  {
    title: "October statement",
    lines: [
      {
        label: "Account holder",
        value: "Brightwater Holdings",
        note: { kind: "fact", text: "Account of Brightwater Holdings." },
      },
      { label: "Opening balance", value: "MRD 12,400" },
      {
        label: "12 Oct · cash in",
        value: "MRD 480,000",
        note: {
          kind: "flag",
          text: "Cash 40 times the usual. Ask where from.",
        },
      },
      {
        label: "19 Oct · sent abroad",
        value: "MRD 470,000",
        note: { kind: "flag", text: "Nearly all of it left a week later." },
      },
      { label: "Closing balance", value: "MRD 22,150" },
    ],
  },
  {
    title: "Pension claim",
    lines: [
      {
        label: "Member",
        value: "Halvard Okonjo",
        note: { kind: "fact", text: "Claim for Halvard Okonjo." },
      },
      { label: "Employer", value: "Selene Port Trust" },
      {
        label: "Retires on",
        value: "01 DEC 2026",
        note: { kind: "fact", text: "Pension starts 1 December 2026." },
      },
      { label: "Years of service", value: "31" },
      {
        label: "Employer's stamp",
        value: "",
        note: { kind: "flag", text: "Employer hasn't stamped it yet." },
      },
    ],
  },
];

/** Each figure in `highlights`, told as a short story, by its label. */
export const highlightStories: Record<string, string> = {
  "Shipping production software":
    "From a computer-vision prototype for calling tennis lines in 2019, to a financial data company, a digital bank and AI start-ups. Today I consult on AI for clients.",
  "Inside a leading Philippine digital bank":
    "At Maya, a Philippine digital bank and wallet, I helped replace an outside ID-check vendor with our own AI. The cost of checking customers' IDs fell by 90%.",
  "On a global financial data platform":
    "At FactSet, a global financial data company, I moved old data pipelines onto new code and automated data loading people used to do by hand.",
  "Ineligible records screened before LLM spend":
    "A team of AI agents I designed sets aside the records that don't qualify, before a paid AI model spends time writing a report on them.",
};

export const who = {
  lines: [
    "Hi, I'm Reljod.",
    "Seven years building software.",
    "Three of them inside a digital bank.",
    "Now I build AI that does the checking, and shows its work.",
  ],
  flipHint: "Tap a card to hear the story behind the number.",
} as const;

/** The lens game: the three things a careful reviewer should catch. */
export const lensFindings = [
  {
    id: "name",
    label: "Name spelled two ways: Quison on the ID, Quizon on the bill.",
  },
  {
    id: "address",
    label: "House number differs: 12 on the ID, 21 on the bill.",
  },
  { id: "expiry", label: "The ID card expired on 14 Aug 2026." },
] as const;

export type LensFindingId = (typeof lensFindings)[number]["id"];

/**
 * Each live demo as a problem someone outside tech would recognise, by
 * project slug. `landing.test.ts` checks that every live demo has one.
 */
export const demoProblems: Record<string, string> = {
  "bank-harness":
    "My bank team wants an assistant that knows our rules and asks before it acts.",
  "document-compliance-checks":
    "Check a new customer's documents before a person reviews them.",
  ledger:
    "Ask anything about Reljod and watch a cat in a suit rebuild the page into the answer.",
  "casework-desk":
    "Hand over a pension case and get back what's missing and what it found.",
  "client-manager":
    "Remember everything about my clients, and answer questions across all of them.",
  "process-transfer":
    "A colleague is leaving. Turn their screen-share call into a how-to guide and slides.",
  "name-extraction": "Find every person and company named in a 500-page file.",
};

export const labFacts = [
  {
    title: "Real AI",
    body: "The models are real and nothing is scripted. Ask the same thing twice and it works it out twice.",
  },
  {
    title: "Pretend paperwork",
    body: "Every document comes from the Republic of Meridia, a country that doesn't exist, and is stamped SPECIMEN. No real person's data is in here.",
  },
  {
    title: "Shown work",
    body: "Every answer points at the page, the line or the second of video it came from, so a person can check it.",
  },
] as const;
