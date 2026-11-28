import "server-only";
import { checkDeck } from "../../domain/deck-checks";
import { fitPlan, planFromProcess } from "../../domain/deck-fit";
import { layoutDeck } from "../../domain/deck-layout";
import type { Process, Watch } from "../../domain/process";
import { sampleBySlug } from "../../domain/samples";
import type { Analyst } from "../ports";
import type { RunRow } from "../run-row";
import { allChecks } from "./process";

/*
 * The scripted Analyst of the stubbed e2e suite (`stub` in
 * `pipeline-container.ts`): no model is called and nothing is spent. Watch
 * and Extract answer with a short Process built from the Sample's own facts
 * (title, people, length); the reviewer finds nothing; Design plans the Deck
 * by rule (`planFromProcess`, `fitPlan`). Every Check is still the real code
 * under the Run's Rules, so a Rule a person changes changes the result.
 */

const STEPS: { title: string; action: string; decision?: boolean }[] = [
  {
    title: "Open the next case in the queue",
    action:
      "Open the work queue in the case system and take the oldest case assigned to the team.",
  },
  {
    title: "Check the record against the request",
    action:
      "Compare the customer record with what the request asks for, field by field.",
  },
  {
    title: "Decide whether the case can go ahead",
    action:
      "Look at the amount and the documents on file and choose the path below.",
    decision: true,
  },
  {
    title: "Record the outcome on the case",
    action:
      "Write what was done and why in the case notes, then set the case status.",
  },
  {
    title: "Hand the case back to the requester",
    action:
      "Send the requester the outcome from the case system and close the task.",
  },
];

const SYSTEM = "Case system";

type Facts = {
  title: string;
  presenter: string;
  receiver: string;
  seconds: number;
};

function factsOf(row: Pick<RunRow, "sample_slug" | "title">): Facts {
  const sample = sampleBySlug(row.sample_slug ?? "");
  return sample
    ? {
        title: sample.title,
        presenter: sample.presenter,
        receiver: sample.receiver,
        seconds: sample.durationSeconds,
      }
    : {
        title: row.title || "Uploaded Recording",
        presenter: "Presenter",
        receiver: "Receiver",
        seconds: 60,
      };
}

/** When each step is shown: spread evenly over the Recording. */
function timeOf(index: number, seconds: number): number {
  return Math.round((seconds * (index + 1)) / (STEPS.length + 1));
}

function scriptedWatch(facts: Facts): Watch {
  return {
    title: facts.title,
    durationSeconds: facts.seconds,
    participants: [
      { name: facts.presenter, role: "Team Lead, handing over" },
      { name: facts.receiver, role: "Officer, taking over" },
    ],
    observations: STEPS.map((step, index) => ({
      at: timeOf(index, facts.seconds),
      speaker: facts.presenter,
      said: step.action,
      shown: `${SYSTEM}: ${step.title.toLowerCase()}`,
    })),
  };
}

function scriptedProcess(watch: Watch): Process {
  const [presenter, receiver] = watch.participants;
  return {
    title: watch.title,
    purpose:
      "Make sure every case is checked, decided and recorded the same way, whoever picks it up.",
    scope:
      "Covers cases that arrive in the team's work queue. Does not cover complaints, which go to the complaints desk.",
    trigger: "A new case arrives in the team's work queue.",
    frequency: "Daily",
    owner: `${presenter?.name ?? "Presenter"}, Team Lead`,
    receiver: `${receiver?.name ?? "Receiver"}, Officer`,
    roles: [
      {
        name: "Officer",
        responsibility: "Works each case from the queue to its outcome",
      },
      {
        name: "Team Lead",
        responsibility: "Approves cases above the Officer's limit",
      },
    ],
    systems: [{ name: SYSTEM, usedFor: "The work queue, records and notes" }],
    prerequisites: ["Access to the team's work queue in the case system"],
    steps: STEPS.map((step, index) => ({
      id: `s${index + 1}`,
      title: step.title,
      actor: "Officer",
      system: SYSTEM,
      action: step.action,
      details: [],
      at: timeOf(index, watch.durationSeconds),
      warning: null,
      decision: step.decision
        ? {
            question: "Is everything the case needs on file?",
            branches: [
              {
                when: "Everything is on file and within the limit",
                // biome-ignore lint/suspicious/noThenProperty: "then" names the branch's outcome in the Process, and this object is never awaited.
                then: "Go ahead and record the outcome.",
              },
              {
                when: "Something is missing or above the limit",
                // biome-ignore lint/suspicious/noThenProperty: "then" names the branch's outcome in the Process, and this object is never awaited.
                then: "Ask the Team Lead before going on.",
              },
            ],
          }
        : null,
    })),
    exceptions: [
      {
        situation: "The case system is down",
        handling: "Keep the case in the queue and tell the Team Lead.",
      },
    ],
    controls: ["The Team Lead approves cases above the Officer's limit."],
    glossary: [],
    openQuestions: [],
  };
}

export const scriptedAnalyst: Analyst = {
  async watch(_ctx, row) {
    return scriptedWatch(factsOf(row));
  },

  async extract(_ctx, { watch }) {
    return scriptedProcess(watch);
  },

  async verify(_ctx, { process, watch, rules }) {
    const grounding = rules.get("process.grounded")?.enabled ?? false;
    return {
      process,
      checks: allChecks(process, watch, rules, grounding ? [] : null),
      findings: [],
      repaired: false,
    };
  },

  async design(_ctx, { by, previous, process, rules }) {
    return {
      plan:
        by === "auto-fit" && previous
          ? fitPlan(previous.plan, process, rules)
          : planFromProcess(process, rules),
      fallback: null,
    };
  },

  async check(_ctx, { plan, process, rules }) {
    const deck = layoutDeck(plan, process, rules);
    return { checks: checkDeck(deck, plan, process, rules), findings: [] };
  },
};
