import "server-only";
import type { RawBuildPlan } from "../domain/build-plan";
import { PRESET_QUESTIONS } from "../domain/presets";
import { sourcePath } from "../domain/source-paths";

/*
 * Canned Build plans for the stubbed e2e suite: the same validation, storage
 * and stream as a live Build, without paying for the model. Only requests that
 * carry the e2e bypass token can reach them.
 */

const MAYA = 3;
const KYC_POINT = sourcePath.jobPoint(MAYA, 0);
export const STUB_INVENTED_QUESTION = "stub: invented excerpt";
export const STUB_TOSS_QUESTION = "stub: toss";

type Step = RawBuildPlan["steps"][number];
const fetch = (
  source: string,
  join: string,
  line: string,
  excerpt: string | null = null,
): Step => ({
  action: "fetch",
  source,
  excerpt,
  join,
  pace: "trot",
  line,
});

const PLANS: Record<string, RawBuildPlan> = {
  [PRESET_QUESTIONS[0]]: {
    verdict: "answer",
    title: "Where Reljod has worked",
    layout: "timeline",
    answer:
      "Reljod is an AI Consultant at Acquire Intelligence. Before that he spent three years as a Senior Software Engineer at Maya Philippines and two at FactSet.",
    steps: [
      fetch(sourcePath.job(0), "Reljod is now", "Newest first!"),
      fetch(sourcePath.job(MAYA), "after", "The bank years!"),
      fetch(sourcePath.job(4), "and before that", "Finance data, check."),
    ],
  },
  [PRESET_QUESTIONS[1]]: {
    verdict: "answer",
    title: "KYC, rebuilt in-house",
    layout: "mixed",
    answer:
      "At Maya Philippines he partnered with data science to replace a third-party KYC vendor with an in-house AI solution: 90% lower KYC operating cost, +7 pts approval rate and +8 pts automation rate.",
    steps: [
      fetch(
        KYC_POINT,
        "His KYC work brought",
        "Ninety percent!",
        "90% lower KYC operating cost",
      ),
      fetch(KYC_POINT, ",", "Approvals up!", "+7 pts approval rate"),
      fetch(KYC_POINT, "and", "More automated!", "+8 pts automation rate"),
      fetch(sourcePath.project(1), "in", "The project file."),
    ],
  },
  [PRESET_QUESTIONS[2]]: {
    verdict: "answer",
    title: "What Reljod offers",
    layout: "cards",
    answer:
      "He builds KYC automation, document compliance checks and name matching for banks and financial firms.",
    steps: [
      fetch(sourcePath.service(0), "He builds", "KYC first."),
      fetch(sourcePath.service(1), ",", "Documents next."),
      fetch(sourcePath.service(2), "and", "Names too!"),
    ],
  },
  [PRESET_QUESTIONS[3]]: {
    verdict: "answer",
    title: "Selected AI systems",
    layout: "cards",
    answer:
      "Highlights include the live document compliance checks demo, in-house KYC automation and a name matching engine.",
    steps: [
      fetch(sourcePath.project(0), "His systems include", "This one's live!"),
      fetch(sourcePath.project(1), ",", "Ninety percent cheaper."),
      fetch(sourcePath.project(2), "and", "Names, matched."),
    ],
  },
  [PRESET_QUESTIONS[4]]: {
    verdict: "answer",
    title: "How Reljod runs an AI project",
    layout: "steps",
    answer:
      "He frames the problem, wins early, builds with evidence and hands over a path to production.",
    steps: ["His approach:", "then", "then", "and finally"].map((join, index) =>
      fetch(sourcePath.approachStep(index), join, `Step ${index + 1}!`),
    ),
  },
  [PRESET_QUESTIONS[5]]: {
    verdict: "answer",
    title: "Let's talk",
    layout: "mixed",
    answer: "Email Reljod or reach him on LinkedIn or GitHub.",
    steps: [fetch(sourcePath.contact, "To work with Reljod,", "Here's how!")],
  },
  [STUB_INVENTED_QUESTION]: {
    verdict: "answer",
    title: "KYC numbers",
    layout: "figures",
    answer: "He cut KYC operating cost by 90%.",
    steps: [
      fetch(
        KYC_POINT,
        "He delivered",
        "Real one.",
        "90% lower KYC operating cost",
      ),
      fetch(KYC_POINT, "and", "Made up!", "99% lower fraud losses"),
      fetch("experience.42", "at", "Not a job."),
    ],
  },
  [STUB_TOSS_QUESTION]: {
    verdict: "answer",
    title: "His bank years",
    layout: "timeline",
    answer: "He spent three years at Maya Philippines.",
    steps: [
      {
        ...fetch(sourcePath.job(4), "", "Hmm, not this one."),
        action: "toss",
      },
      fetch(sourcePath.job(MAYA), "He spent his bank years as", "This one!"),
    ],
  },
};

const NOT_FOUND: RawBuildPlan = {
  verdict: "not_found",
  title: "Not on my ledger",
  layout: "mixed",
  answer:
    "I only keep books on Reljod's work: his experience, projects, services and how to reach him. Try one of these.",
  steps: [],
};

export function stubPlan(question: string): RawBuildPlan {
  return PLANS[question] ?? NOT_FOUND;
}
