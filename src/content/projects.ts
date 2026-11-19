import { capitalCountWord, countWord } from "./count-words";
import type { Project } from "./types";
/*
 * Template entries. Replace `outcome` placeholders with real, approved figures
 * before publishing. Never invent client names or numbers.
 */
export const projects: Project[] = [
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
    features: [
      "Six synthetic onboarding packs, each hiding a different problem",
      "Watch OCR and the model scan every page live",
      "Every finding boxed on the source document",
    ],
  },
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
  {
    slug: "ledger",
    icon: "chat",
    title: "Ledger, the cat banker",
    sector: "Conversational UI",
    summary:
      "Ask about Reljod and a cat in a suit takes the About page apart, carries the right pieces into order and rebuilds them into your answer.",
    outcome: "Every answer built from the site's own words",
    tags: ["LLM planning", "Streaming", "Motion"],
    status: "Live",
    href: "/demos/ledger",
    features: [
      "Ask anything, or pick a ready-made question",
      "A model plans which pieces of the page answer it",
      "Ledger hauls them over and reforms the page",
    ],
  },
  {
    slug: "casework-desk",
    icon: "agents",
    title: "Teller",
    sector: "Pensions and trust operations",
    summary:
      "A specialist agent for a Meridian bank and trust company: hand it a case and it picks one of four review pipelines, runs its jobs, asks for what's missing and tells you what it found.",
    outcome: "Every job a tool on an MCP server",
    tags: ["Agents", "MCP", "Durable workflows"],
    status: "Live",
    href: "/demos/casework",
    features: [
      "200 labelled synthetic documents across four reviews",
      "Jobs run alone or chained, and pause to ask you",
      "Model, temperature and spend per job, live",
    ],
  },
  {
    slug: "client-manager",
    icon: "agents",
    title: "Client Manager",
    sector: "Wealth management",
    summary:
      "Tell it about a client in your own words, add their files, and a self-correcting pipeline builds a graph of their life and money in Postgres. Then ask it anything and watch the answer walk the graph.",
    outcome: "Every answer cites the facts it walked through",
    tags: ["GraphRAG", "pgRouting", "pgvector", "Workflow"],
    status: "Live",
    href: "/demos/client-manager",
    features: [
      "Add a client: a name, free text, PDFs, spreadsheets, images",
      "A Critic model checks the graph and repairs it while you watch",
      "Ask across your whole book, or research a client on the web",
    ],
  },
  {
    slug: "process-transfer",
    icon: "compass",
    title: "Handover",
    sector: "Operations and process transfer",
    summary:
      "Record the call where a colleague shares their screen and shows how a process is done. A pipeline watches it, writes the steps as a workflow document and builds a slide deck that is checked for alignment, legibility and motion before it is approved.",
    outcome: "No deck is approved until its checks pass",
    tags: ["Video understanding", "Workflow", "Self-checking", "DOCX and PPTX"],
    status: "Live",
    href: "/demos/process-transfer",
    marks: ["New"],
    features: [
      "Twelve recorded handover calls to try, or upload your own",
      "Every step linked to the second of the recording that shows it",
      "Editable rules, the cost of every model call and an audit trail",
    ],
  },
  {
    slug: "bank-harness",
    icon: "agents",
    title: "Jod: Harness for Bank",
    sector: "Banking operations",
    summary:
      "Like Claude, but set up for one bank desk. A chat agent with editable skills, deterministic pipelines that wait for a person's approval, a knowledge base that spots conflicting documents, staff roles and an audit trail, all behind one MCP server that Claude can use too.",
    outcome: "Every action by a person or the agent on the audit trail",
    tags: ["Agents", "MCP", "Skills", "Durable workflows", "Hybrid search"],
    status: "Live",
    href: "/demos/harness",
    marks: ["New", "Beta"],
    features: [
      "Three pension pipelines run as MCP tools, with a live pipeline view",
      "Change a rule's parameters as an admin; every run records the versions it used",
      "Upload a circular and settle the conflicts it raises with older guidance",
    ],
  },
  {
    slug: "name-extraction",
    icon: "scan",
    title: "Sieve",
    sector: "AML screening",
    summary:
      "Finds every person and company named in a 10 to 500 page AML file, with every alias and every page, in minutes and for cents. Watch it read a 500-page ledger, then check every name it found side by side with the document.",
    outcome: "Recall first, scored against an answer key",
    tags: ["Agents", "Sub-agents", "Sandbox", "MCP", "Durable workflows"],
    status: "Live",
    href: "/demos/name-extraction",
    marks: ["New"],
    features: [
      "Synthetic AML files from 10 to 500 pages, or your own PDF",
      "Watch Readers fan out over page ranges and the Done gate fill",
      "An editable, versioned rulebook and a full audit trail with cost",
    ],
  },
  {
    slug: "operator",
    icon: "agents",
    title: "Operator",
    sector: "Ports, banks and anyone with a green screen",
    summary:
      "An agent that works the system nobody can integrate with. It looks at a 1990s terminal screen and keys a cargo manifest with the keyboard and mouse while you watch, stops for your approval before a guarded key, and code checks the result.",
    outcome: "Only code says the work was done correctly",
    tags: ["Computer use", "Sandbox", "MCP", "Durable workflows", "Rules"],
    status: "Live",
    href: "/demos/operator",
    marks: ["New"],
    features: [
      "A live screen with a gliding cursor, and a replay of every frame",
      "Rules decide which keys need a person; the agent cannot approve",
      "Take the keyboard yourself and compare your time and errors",
    ],
  },
  {
    slug: "tidewater-bank",
    icon: "chart",
    title: "Tidewater Bank",
    sector: "Retail banking",
    summary:
      "A whole retail bank you can run: accounts, payments that clear and settle, cards, loans and fraud holds, all on a double-entry ledger the database itself keeps balanced. Do anything by clicking or by asking the Teller. Ask for a feature it lacks and the bank files the issue, builds it and merges it by itself.",
    outcome:
      "Every florin posted twice, and a trial balance that always nets to zero",
    tags: [
      "Double-entry ledger",
      "Durable workflows",
      "MCP",
      "Agents",
      "Self-improving",
    ],
    status: "Live",
    href: "/demos/bank",
    marks: ["New"],
    features: [
      "Fast-forward the clock and watch end-of-day, settlement and interest run",
      "Everything in the app is also an MCP tool; sensitive ones wait for your click",
      "Ask for a missing feature in chat and follow it from issue to merged pull request",
    ],
  },
  {
    slug: "loupe",
    icon: "scan",
    title: "Loupe",
    sector: "Document forensics",
    summary:
      "Was this payslip, statement, invoice or ID edited? One agent looks at the document, then proves what it saw with code in a sandbox: error levels, glyph metrics, sums that no longer add up. Every finding is boxed on the page with the measurement behind it, and rules in code give the verdict.",
    outcome: "Evidence for a reviewer, with its measured error rates",
    tags: ["Agents", "Vision", "Sandbox", "MCP", "Durable workflows"],
    status: "Live",
    href: "/demos/loupe",
    marks: ["New"],
    features: [
      "Synthetic payslips, statements, bills, invoices and IDs, or your own file",
      "Watch the examiner look, suspect, and test each suspicion with code",
      "Editable thresholds; re-decide a finished examination with no model call",
    ],
  },
  {
    slug: "switchboard",
    icon: "chat",
    title: "Switchboard",
    sector: "Voice agents",
    summary:
      "The phone line of a fictional railway, answered by a voice agent you can interrupt. Press one button and talk: it answers in under a second, follows you into Tagalog or Spanish, uses the back office while it speaks, and keeps to Rules it cannot be talked out of.",
    outcome: "Speech to speech, with Rules checked at every tool call",
    tags: ["Voice", "Realtime", "MCP", "Rules", "Durable workflows"],
    status: "Live",
    href: "/demos/switchboard",
    marks: ["New"],
    features: [
      "Talk, type, or play a sample caller who interrupts or switches language",
      "Watch the back office change, and a Rule refuse a pushy caller",
      "A wrap-up after every call: summary, scorecard, follow-ups",
    ],
  },
  {
    slug: "canvas",
    icon: "chart",
    title: "Canvas",
    sector: "Data analysis",
    summary:
      "Ask a question about a million rows of open data and get back a working chart, not a paragraph: it has controls you can move, shows the query behind it, and every number in it is recomputed by code before it is marked verified.",
    outcome: "Answers you can adjust and check",
    tags: ["Agents", "MCP Apps", "Sandbox", "Generative UI", "Rules"],
    status: "Live",
    href: "/demos/canvas",
    marks: ["New"],
    features: [
      "An analyst that queries a million rows in a sandbox with no network",
      "Charts as MCP Apps: the same interface on this page and inside Claude",
      "Controls re-run the saved query with no model call; code verifies every number",
    ],
  },
];

/**
 * Live demos that lead the landing page, in this order. The rest follow in
 * list order. The landing page numbers demos by their place in `liveDemos`,
 * so this is what makes a demo 01 without moving it in `projects`.
 */
const LEAD_DEMOS = ["bank-harness"];

const liveInListOrder = projects.filter((project) => project.status === "Live");

/** The landing page's split: live demos take the stage, the rest wait on the bench. */
export const liveDemos = [
  ...LEAD_DEMOS.flatMap((slug) =>
    liveInListOrder.filter((project) => project.slug === slug),
  ),
  ...liveInListOrder.filter((project) => !LEAD_DEMOS.includes(project.slug)),
];

/**
 * How many live demos there are, in words ("twelve"). Every line of copy
 * that counts the demos reads this, so a new demo updates them all.
 */
export const demoCount = {
  value: liveDemos.length,
  word: countWord(liveDemos.length),
  Word: capitalCountWord(liveDemos.length),
} as const;

/** The About page's pointer to the demos, which Ledger may also cut out. */
export const demosPitch = {
  figure: String(demoCount.value),
  label: "live demos",
  body: `${demoCount.Word} working demos: real AI over made-up paperwork, from a bank you can run to a voice agent you can interrupt. Each opens with a guest code.`,
  cta: "Open the catalog",
} as const;

/**
 * What the landing page's "Coming soon" shows, in this order. The other
 * projects that aren't live wait for their case studies.
 */
const BENCH = ["marketing-intelligence", "tennis-line-calling"];

export const benchProjects = BENCH.flatMap((slug) =>
  projects.filter(
    (project) => project.slug === slug && project.status !== "Live",
  ),
);
