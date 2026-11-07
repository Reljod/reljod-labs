import type { ApproachStep, Service } from "./types";

export const services: Service[] = [
  {
    icon: "id-card",
    title: "KYC automation",
    summary:
      "In-house AI identity verification that replaces paid third-party vendors and lifts approval and automation rates.",
    points: [
      "Identity document extraction",
      "Approval and review routing",
      "Vendor replacement plans",
    ],
  },
  {
    icon: "document-check",
    title: "Document compliance checks",
    summary:
      "AI pipelines that review submitted documents against your compliance requirements before a person has to.",
    points: [
      "Requirement checklists as code",
      "Tampering detection",
      "Illegibility detection",
    ],
  },
  {
    icon: "match",
    title: "Name matching",
    summary:
      "Matching names across documents and records to support identity verification and screening.",
    points: [
      "Cross-document matching",
      "Fuzzy and transliterated names",
      "Explainable match scores",
    ],
  },
  {
    icon: "agents",
    title: "AI agents and workflows",
    summary:
      "Multi-agent systems built into your existing applications and data platforms, not a parallel stack.",
    points: [
      "Python FastAPI services",
      "AWS Lambda, EKS and Bedrock",
      "Shared agent framework",
    ],
  },
  {
    icon: "compass",
    title: "AI adoption and governance",
    summary:
      "A practical start: a few visible early wins, tools like Claude and ChatGPT in people's hands, and a small team governing their use.",
    points: [
      "Current and desired state mapping",
      "Early-win workflow picks",
      "Usage policy and governance",
    ],
  },
  {
    icon: "gauge",
    title: "Evaluation and path to production",
    summary:
      "The evaluation harness, tracing and CI/CD that prove an AI system works and keep it working after launch.",
    points: [
      "LLM evals and guardrails",
      "LangFuse and LangSmith tracing",
      "Hosting for business-built apps",
    ],
  },
];

export const approach: ApproachStep[] = [
  {
    title: "Frame the problem",
    summary:
      "Sit with the business, including auditors and operations staff, to map the current and desired state and agree on success criteria first.",
  },
  {
    title: "Win early",
    summary:
      "Automate one or two manual workflows so the business sees a visible result within weeks, not quarters.",
  },
  {
    title: "Build with evidence",
    summary:
      "Agentic engineering backed by tests, evaluation checks, tracing and CI/CD, iterated with users in short loops.",
  },
  {
    title: "Hand over a path to production",
    summary:
      "Integrate with the systems you already run, document it, and leave your team able to own and extend it.",
  },
];
