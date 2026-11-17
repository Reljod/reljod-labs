import type { SampleFile } from "../../domain/samples";

/** One suggested first message in an empty Session. */
export type SuggestedPrompt = {
  id: string;
  title: string;
  /** One line on what it shows off. */
  hint: string;
  text: string;
  /** Attach the first sample file of this group with it, when there is one. */
  sampleGroup?: SampleFile["group"];
  /** Only an admin may use it. */
  admin?: boolean;
};

export const SUGGESTED_PROMPTS: SuggestedPrompt[] = [
  {
    id: "member-request",
    title: "Handle a member request",
    hint: "Runs the Member request Pipeline on the attached request.",
    text: "A Member has sent the attached request. Check it against our Rules and tell me what happens next.",
    sampleGroup: "member request",
  },
  {
    id: "contributions",
    title: "Process a contribution schedule",
    hint: "Runs the Contribution processing Pipeline on the attached Schedule.",
    text: "Process the attached contribution Schedule and tell me what needs my attention.",
    sampleGroup: "contributions",
  },
  {
    id: "delinquency",
    title: "Prepare the delinquency report",
    hint: "Runs the Delinquency report Pipeline across the Employers.",
    text: "Prepare the delinquency report for last month: which Employers have not remitted what they owe?",
  },
  {
    id: "knowledge",
    title: "Ask the Knowledge base",
    hint: "Answers from our guides and circulars, with the Sources cited.",
    text: "What does our guidance say about a Member withdrawing their pension when they leave Cayman? Cite the Sources.",
  },
  {
    id: "web",
    title: "Search the web",
    hint: "Looks outside the Workspace through the web search Connector.",
    text: "Search the web for the latest news on pension contribution rules in the Cayman Islands and summarise it in five lines.",
  },
  {
    id: "sandbox",
    title: "Run code in the Sandbox",
    hint: "Writes and runs a small script in a container with no network.",
    text: "In the Sandbox, write and run a small script that totals the contribution lines of a Schedule given as CSV text, and show me the result.",
    admin: true,
  },
];
