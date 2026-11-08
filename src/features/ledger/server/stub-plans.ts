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
  line: string,
  excerpt: string | null = null,
): Step => ({
  action: "fetch",
  source,
  excerpt,
  pace: "trot",
  line,
});
const say = (text: string, ...cites: number[]) => ({ text, cites });

const PLANS: Record<string, RawBuildPlan> = {
  [PRESET_QUESTIONS[0]]: {
    verdict: "answer",
    title: "Where Reljod has worked",
    layout: "timeline",
    answer:
      "Reljod is an AI Consultant at Acquire Intelligence. Before that he spent three years as a Senior Software Engineer at Maya Philippines and two at FactSet.",
    steps: [
      fetch(sourcePath.job(0), "Newest first!"),
      fetch(sourcePath.job(MAYA), "The bank years!"),
      fetch(sourcePath.job(4), "Finance data, check."),
    ],
    writeup: [
      say("Reljod works today as an AI Consultant at Acquire Intelligence.", 1),
      say(
        "Before that he spent three years as a Senior Software Engineer at Maya Philippines, a digital bank.",
        2,
      ),
      say("Earlier still, he spent two years at FactSet.", 3),
    ],
  },
  [PRESET_QUESTIONS[1]]: {
    verdict: "answer",
    title: "KYC, rebuilt in-house",
    layout: "mixed",
    answer:
      "At Maya Philippines he partnered with data science to replace a third-party KYC vendor with an in-house AI solution: 90% lower KYC operating cost, +7 pts approval rate and +8 pts automation rate.",
    steps: [
      fetch(KYC_POINT, "Ninety percent!", "90% lower KYC operating cost"),
      fetch(KYC_POINT, "Approvals up!", "+7 pts approval rate"),
      fetch(KYC_POINT, "More automated!", "+8 pts automation rate"),
      fetch(sourcePath.project(1), "The project file."),
    ],
    writeup: [
      say(
        "At Maya Philippines, Reljod helped replace a third-party KYC vendor with an in-house AI solution.",
        4,
      ),
      say(
        "It brought a 90% lower KYC operating cost and raised the approval rate by 7 points.",
        1,
        2,
      ),
      say("The automation rate rose by 8 points too.", 3),
    ],
  },
  [PRESET_QUESTIONS[2]]: {
    verdict: "answer",
    title: "What Reljod offers",
    layout: "cards",
    answer:
      "He builds KYC automation, document compliance checks and name matching for banks and financial firms.",
    steps: [
      fetch(sourcePath.service(0), "KYC first."),
      fetch(sourcePath.service(1), "Documents next."),
      fetch(sourcePath.service(2), "Names too!"),
    ],
    writeup: [
      say("Reljod builds KYC automation for banks and financial firms.", 1),
      say("He also builds document compliance checks.", 2),
      say("And he builds name matching.", 3),
    ],
  },
  [PRESET_QUESTIONS[3]]: {
    verdict: "answer",
    title: "Selected AI systems",
    layout: "cards",
    answer:
      "Highlights include the live document compliance checks demo, in-house KYC automation and a name matching engine.",
    steps: [
      fetch(sourcePath.project(0), "This one's live!"),
      fetch(sourcePath.project(1), "Ninety percent cheaper."),
      fetch(sourcePath.project(2), "Names, matched."),
    ],
    writeup: [
      say("His live document compliance checks demo runs on this site.", 1),
      say("He also built in-house KYC automation.", 2),
      say("A name matching engine rounds out the set.", 3),
    ],
  },
  [PRESET_QUESTIONS[4]]: {
    verdict: "answer",
    title: "How Reljod runs an AI project",
    layout: "steps",
    answer:
      "He frames the problem, wins early, builds with evidence and hands over a path to production.",
    steps: [0, 1, 2, 3].map((index) =>
      fetch(sourcePath.approachStep(index), `Step ${index + 1}!`),
    ),
    writeup: [
      say("Reljod starts by framing the problem.", 1),
      say("He looks for an early win.", 2),
      say("He builds with evidence.", 3),
      say("And he hands over a path to production.", 4),
    ],
  },
  [PRESET_QUESTIONS[5]]: {
    verdict: "answer",
    title: "Let's talk",
    layout: "mixed",
    answer: "Email Reljod or reach him on LinkedIn or GitHub.",
    steps: [fetch(sourcePath.contact, "Here's how!")],
    writeup: [say("Email Reljod, or reach him on LinkedIn or GitHub.", 1)],
  },
  [STUB_INVENTED_QUESTION]: {
    verdict: "answer",
    title: "KYC numbers",
    layout: "figures",
    answer: "He cut KYC operating cost by 90%.",
    steps: [
      fetch(KYC_POINT, "Real one.", "90% lower KYC operating cost"),
      fetch(KYC_POINT, "Made up!", "99% lower fraud losses"),
      fetch("experience.42", "Not a job."),
    ],
    writeup: [
      say("He cut KYC operating cost by 90%.", 1),
      say("He cut fraud losses by 99%.", 2),
    ],
  },
  [STUB_TOSS_QUESTION]: {
    verdict: "answer",
    title: "His bank years",
    layout: "timeline",
    answer: "He spent three years at Maya Philippines.",
    steps: [
      { ...fetch(sourcePath.job(4), "Hmm, not this one."), action: "toss" },
      fetch(sourcePath.job(MAYA), "This one!"),
    ],
    writeup: [say("He spent three years at Maya Philippines.", 1)],
  },
};

const NOT_FOUND: RawBuildPlan = {
  verdict: "not_found",
  title: "Not on my ledger",
  layout: "mixed",
  answer:
    "I only keep books on Reljod's work: his experience, projects, services and how to reach him. Try one of these.",
  steps: [],
  writeup: [],
};

export function stubPlan(question: string): RawBuildPlan {
  return PLANS[question] ?? NOT_FOUND;
}
