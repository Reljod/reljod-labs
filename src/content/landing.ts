/*
 * Words for the landing page, written for a visitor who doesn't work in tech.
 * Facts about Reljod come only from `profile.ts`, `experience.ts` and
 * `projects.ts`; every document here is from the made-up Republic of Meridia.
 */

/** The page's chapters, in order. The Index lists them and numbers them. */
export const scenes = [
  { id: "top", title: "Paperwork" },
  { id: "how", title: "Up close" },
  { id: "who", title: "Who's reading" },
  { id: "demos", title: "Seven problems" },
  { id: "lab", title: "What this site is" },
  { id: "finale", title: "That's the tour" },
] as const;

export type SceneId = (typeof scenes)[number]["id"];

/** A scene's two-digit number, as the Index and each scene's eyebrow show it. */
export function sceneNumber(id: SceneId): string {
  return String(scenes.findIndex((scene) => scene.id === id) + 1).padStart(
    2,
    "0",
  );
}

export const opening = {
  eyebrow: "reljod.com · Reljod Oreta's AI lab",
  lines: [
    "Someone has to read all this paperwork.",
    "I build the AI that does.",
  ],
  intro:
    "I'm Reljod Oreta, a software engineer in Metro Manila. Every project here is a working AI helper for banks: it reads the documents, finds what matters, and shows a person exactly where.",
  /** The intro for a short phone screen, where the full one won't fit. */
  short: "I'm Reljod. I build AI that reads bank paperwork.",
  cue: "Scroll to watch it read",
  pages: 500,
  /**
   * The pages the AI pulls out of the pile for a person: the line it caught
   * (`label`, `value`) and why, in plain words.
   */
  flags: [
    {
      page: 12,
      label: "Name",
      value: "Quison / Quizon",
      text: "Spelled two ways",
    },
    { page: 87, label: "Signature", value: "", text: "Never signed" },
    {
      page: 361,
      label: "Cash in",
      value: "MRD 480,000",
      text: "40× the usual",
    },
  ],
  /** Under the pulled pages, once the pile is read. */
  verdict: "500 read. 3 pulled out for a person.",
} as const;

/** One customer, two documents, compared by the AI. */
export const upClose = {
  captions: [
    "Up close: a new customer sends an ID card and a utility bill.",
    "The AI reads both, every line.",
    "Then it checks them against each other.",
    "Three things don't add up. It doesn't decide. It shows a person where to look.",
  ],
  idCard: {
    name: "QUISON, AMARA T.",
    born: "03 MAR 1991",
    address: "12 Lantern Street",
    expires: "14 AUG 2026",
  },
  bill: {
    name: "Amara T. Quizon",
    address: "21 Lantern Street",
    period: "October 2026",
    due: "MRD 1,284.50",
  },
  findings: {
    name: "Name spelled two ways",
    address: "House number differs",
    expiry: "ID expired in August",
  },
  verdict: "Hold · 3 to check",
} as const;

export const who = {
  lines: [
    "Hi, I'm Reljod.",
    "Seven years building software.",
    "Three of them inside a digital bank.",
    "Now I build AI that does the checking, and shows its work.",
  ],
} as const;

/**
 * The road here, oldest first, in plain words. Each stop retells an entry in
 * `experience.ts`; `landing.test.ts` checks every company is one of them.
 */
export const road = [
  {
    year: "2019",
    company: "Yuro Product Development and Design Solutions",
    short: "Yuro",
    what: "Taught a camera to call lines in tennis.",
  },
  {
    year: "2020",
    company: "FactSet Philippines, Inc.",
    short: "FactSet",
    what: "Moved a global financial data company's old pipelines onto new code.",
  },
  {
    year: "2022",
    company: "Maya Philippines, Inc.",
    short: "Maya",
    what: "Inside a digital bank: replaced an outside ID-check vendor with our own AI. 90% cheaper.",
  },
  {
    year: "2025",
    company: "Spark Intelligence, Inc.",
    short: "Spark Intelligence",
    what: "Built an AI product many companies share.",
  },
  {
    year: "2025",
    company: "Cloud Employee",
    short: "Cloud Employee",
    what: "Designed AI agents that set aside 95–97% of ineligible records before the costly step.",
  },
  {
    year: "2026",
    company: "Acquire Intelligence",
    short: "Acquire Intelligence",
    what: "Today: building AI for clients, from the first question to the shipped system.",
  },
] as const;

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
  "tidewater-bank":
    "Run a small bank by talking to it, and ask it to learn what it can't do yet.",
};

/**
 * The catalog's shelves: what a demo does, in plain words, by project slug.
 * A demo can sit on several. `catalog-query.test.ts` checks every slug is a live demo.
 */
export const demoShelves = [
  {
    id: "paperwork",
    label: "Reads paperwork",
    slugs: [
      "document-compliance-checks",
      "casework-desk",
      "client-manager",
      "bank-harness",
      "name-extraction",
    ],
  },
  {
    id: "questions",
    label: "Answers questions",
    slugs: ["ledger", "client-manager", "bank-harness", "tidewater-bank"],
  },
  {
    id: "person",
    label: "A person decides",
    slugs: [
      "document-compliance-checks",
      "casework-desk",
      "bank-harness",
      "tidewater-bank",
    ],
  },
] as const;

/** Words for the catalog page (`/demos`). */
export const catalog = {
  title: "Every demo, filed.",
  intro:
    "Seven working demos: real AI over made-up paperwork. Hover a card to watch it work. They open with a guest code, so ask me for one.",
  /** The search box types these as hints; each must find at least one demo. */
  searchHints: ["MCP", "pension", "slides", "video", "cat banker", "500 pages"],
  surprise: "Surprise me",
  drawer: "Pull a card at random",
  picked: "Picked for you",
  empty: "Nothing on file under",
} as const;

/** Where the tour ends: three ways on from here. */
export const finale = {
  title: "That's the tour. Where to next?",
  doors: [
    {
      href: "/demos",
      label: "Browse every demo",
      body: "All seven, filed in one catalog: search them, shuffle them, watch each one work.",
    },
    {
      href: "/about",
      label: "The longer story",
      body: "Seven years, from financial data to a digital bank to AI for clients.",
    },
    {
      href: "#contact",
      label: "Say hello",
      body: "Tell me where your team loses hours to checks and reviews.",
    },
  ],
} as const;

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

/** What reljod.com is, stamped onto a Meridia passport one fact at a time. */
export const stamps = ["REAL AI", "SPECIMEN", "SHOWN WORK"] as const;
