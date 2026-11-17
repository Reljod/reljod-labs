import {
  approve,
  asStaff,
  attach,
  backToSession,
  latestEndedPeriod,
  newSession,
  openAudit,
  openConflict,
  openDoc,
  openFirstRun,
  openLatestRun,
  openRule,
  resolveConflict,
  restoreRule,
  saveRule,
  say,
  sayIfAble,
  seq,
  setParameter,
  sourceIdOf,
  stopRunIfWaiting,
  tryApprove,
  tryResolveConflict,
  uploadKnowledge,
  waitForApproval,
} from "./actions";
import type { DriftPlan, Scenario } from "./engine";

/**
 * The Scenarios of Demo mode, as data. Every sample id, Rule id, Parameter
 * name and Staff key here is real (`scenarios.test.ts` checks them against
 * the app's own lists). Copy says what the app really does.
 */

const OFFICER = "officer-1";
const MANAGER = "manager";

const memberRequestPlan = (sampleId: string, askAgain: string): DriftPlan => ({
  pipelineId: "member_request",
  askAgain,
  start: async (ctx) => ({ sourceIds: [await sourceIdOf(ctx, sampleId)] }),
});

const schedulePlan = (sampleId: string, askAgain: string): DriftPlan => ({
  pipelineId: "contribution_processing",
  askAgain,
  start: async (ctx) => ({ sourceId: await sourceIdOf(ctx, sampleId) }),
});

const delinquencyPlan = (askAgain: string): DriftPlan => ({
  pipelineId: "delinquency_report",
  askAgain,
  start: async (ctx) => ({ period: latestEndedPeriod(ctx) }),
});

// 1 ----------------------------------------------------------------------------------

const OVERSEAS_ASK =
  "A Member has sent the attached request to move her pension to a plan overseas. Please run the Member request Pipeline on the attached paper and tell me what happens next.";
const OVERSEAS_FIRMER =
  "Please run the Member request Pipeline on the attached paper now.";

const overseasTransfer: Scenario = {
  id: "overseas-transfer",
  title: "A member asks to move their pension overseas",
  summary:
    "A full case from request to recorded decision: the Agent runs the Member request Pipeline, a high-risk Approval stops at a person, and the Audit trail shows who did what.",
  features: ["Pipeline", "Approval", "Audit"],
  minutes: 5,
  asRole: "Pensions Officer, then Operations Manager",
  beats: [
    {
      id: "session",
      say: "You start as Keisha Wraymond, a pensions officer. A new Session keeps this case, its paper, its Runs and its Audit trail together.",
      focus: "chat",
      run: seq(asStaff(OFFICER), newSession()),
    },
    {
      id: "attach",
      say: "Attach the request paper: a Member who left Cayman three years ago asks to move her pension to a plan in Canada. It is a sample, marked SPECIMEN.",
      focus: "chat",
      pendingLabel: "Attaching the paper…",
      run: attach("request-overseas-transfer"),
    },
    {
      id: "ask",
      say: "Ask the Agent to handle it. The Agent reads the Skills, then calls the Member request Pipeline. It does not decide the case: the Pipeline's checks do.",
      focus: "chat",
      pendingLabel: "Waiting for the Agent…",
      run: say(OVERSEAS_ASK),
      settle: { kind: "run-started", timeoutMs: 15_000 },
      onDrift: memberRequestPlan("request-overseas-transfer", OVERSEAS_FIRMER),
    },
    {
      id: "view",
      say: "View the Pipeline live. Once Intake is done, Classify, Read the papers and Find the Member run at the same time, because none of them needs another's answer. Only code makes the decision.",
      focus: "pipelines",
      pendingLabel: "Opening the Run…",
      run: openLatestRun("member_request"),
    },
    {
      id: "approval",
      say: "The Run stops at its Approval. A transfer instruction is high risk: it needs an admin who did not start the Run.",
      focus: "pipelines",
      pendingLabel: "Waiting for the Run to reach its Approval…",
      run: waitForApproval(),
    },
    {
      id: "refusal",
      say: "Keisha started this Run and is not an admin, so she tries to approve it and is refused. The Agent could not approve either.",
      focus: "pipelines",
      pendingLabel: "Trying to approve…",
      run: tryApprove("Approving my own request"),
    },
    {
      id: "manager",
      say: "Switch to Marva Lindo-Tibbett, the Operations Manager. She has the admin Role and did not start the Run.",
      focus: "pipelines",
      pendingLabel: "Signing in…",
      run: seq(asStaff(MANAGER)),
    },
    {
      id: "approve",
      say: "She approves the transfer instruction. The Run goes on to its last Step and records the decision.",
      focus: "pipelines",
      pendingLabel: "Approving…",
      run: approve("Approved from Demo mode."),
      settle: { kind: "run-ended", timeoutMs: 45_000 },
    },
    {
      id: "audit",
      say: "Open the Audit trail. Every action is an event: who did it, when, on what. The Agent's own events carry the model, the tokens and the cost.",
      focus: "audit",
      run: openAudit("session"),
    },
  ],
};

// 2 ----------------------------------------------------------------------------------

const TOO_SOON_ASK =
  "A Member has sent the attached request to take her pension out after leaving Cayman. Please run the Member request Pipeline on the attached paper and tell me what happens next.";
const TOO_SOON_FIRMER =
  "Please run the Member request Pipeline on the attached paper now.";
const TOO_SOON_AGAIN =
  "The Rule has changed. Run the Member request Pipeline again on the paper attached earlier in this Session.";

const ABSENCE_RULE = "mr.overseas-absence";

const ruleChange: Scenario = {
  id: "rule-change",
  title: "A request that fails the rules, and changing a rule",
  summary:
    "A request that is too soon is blocked by a Rule. An admin changes the Rule's Parameter, saves a new Version, and runs it again: the Finding changes, and each Run records the Rule Version it used.",
  features: ["Pipeline", "Rules", "Approval"],
  minutes: 7,
  asRole: "Operations Manager",
  beats: [
    {
      id: "session",
      say: "Rules can be edited only by an admin, so this Scenario runs as Marva Lindo-Tibbett, the Operations Manager, from the start.",
      focus: "chat",
      run: seq(asStaff(MANAGER), newSession()),
    },
    {
      id: "attach",
      say: "Attach a request from a Member who left Cayman 14 months ago and asks for a refund or a transfer to the UK. A transfer outside the Islands needs a longer absence.",
      focus: "chat",
      run: attach("request-overseas-too-soon"),
    },
    {
      id: "ask",
      say: "Ask the Agent to run it.",
      focus: "chat",
      pendingLabel: "Waiting for the Agent…",
      run: say(TOO_SOON_ASK),
      settle: { kind: "run-started", timeoutMs: 15_000 },
      onDrift: memberRequestPlan("request-overseas-too-soon", TOO_SOON_FIRMER),
    },
    {
      id: "findings",
      say: "Read the Findings once the checks are done. The Rule that blocked it is “Away from the Islands long enough”, and the Run records the Version of every Rule it used.",
      focus: "pipelines",
      pendingLabel: "Waiting for the Run to finish its checks…",
      run: openLatestRun("member_request"),
      settle: { kind: "run-quiet", timeoutMs: 120_000 },
    },
    {
      id: "open-rule",
      say: "Open that Rule in the Skills tab. The check is code; the Rule only supplies its Parameters. The guide also stops this first Run if it is waiting on a rejection nobody here will approve, so it does not count against your limit of Runs at work.",
      focus: "skills",
      pendingLabel: "Opening the Rule…",
      run: seq(stopRunIfWaiting(), openRule(ABSENCE_RULE)),
    },
    {
      id: "change",
      say: "Change “Years absent” from 2 to 1. Nothing is saved yet: this is a draft on the card.",
      focus: "skills",
      run: setParameter("minYears", 1),
    },
    {
      id: "save",
      say: "Save. That adds Version 1 of the Rule; the Default (Version 0) stays in its history. Saving never overwrites.",
      focus: "skills",
      pendingLabel: "Saving a new Version…",
      run: saveRule(),
    },
    {
      id: "again",
      say: "Back in the Session, ask for the same request to be run again. It will use Version 1.",
      focus: "chat",
      pendingLabel: "Waiting for the Agent…",
      run: seq(backToSession(), say(TOO_SOON_AGAIN)),
      settle: { kind: "run-started", timeoutMs: 15_000 },
      onDrift: memberRequestPlan("request-overseas-too-soon", TOO_SOON_AGAIN),
    },
    {
      id: "changed",
      say: "The absence Finding now passes. The request can still be held by the other two-year test, “No recent contributions”, which this change did not touch.",
      focus: "pipelines",
      pendingLabel: "Waiting for the Run to finish its checks…",
      run: openLatestRun("member_request"),
      settle: { kind: "run-quiet", timeoutMs: 120_000 },
    },
    {
      id: "compare",
      say: "Open the first Run again. It still shows the Default of the Rule and its original Finding: each Run keeps the Versions it used, so the history can be checked later.",
      focus: "pipelines",
      run: openFirstRun(),
    },
    {
      id: "restore",
      say: "Put the Rule back to its Default. The guide makes the same call as the Restore default button, and it adds Version 2 rather than deleting Version 1.",
      focus: "skills",
      pendingLabel: "Restoring the Default…",
      run: restoreRule(ABSENCE_RULE),
    },
  ],
};

// 3 ----------------------------------------------------------------------------------

const SCHEDULE_ASK =
  "Process the attached contribution Schedule and tell me what needs my attention. Please use the Contribution processing Pipeline.";
const SCHEDULE_FIRMER =
  "Please run the Contribution processing Pipeline on the attached Schedule now.";

const contributions: Scenario = {
  id: "contributions",
  title: "Monthly contributions with mistakes",
  summary:
    "An Employer's monthly Schedule has a wrong rate and a line that is not a Member. The Pipeline checks it in parallel, lists the exceptions, drafts a query to the Employer, and a person approves it.",
  features: ["Pipeline", "Approval"],
  minutes: 5,
  asRole: "Pensions Officer",
  beats: [
    {
      id: "session",
      say: "You are Keisha Wraymond, a pensions officer, with a new Session.",
      focus: "chat",
      run: seq(asStaff(OFFICER), newSession()),
    },
    {
      id: "attach",
      say: "Attach last month's Schedule from Calloway Bight Logistics, as a spreadsheet. Its employer share is 4%, and one line is not a Member.",
      focus: "chat",
      run: attach("schedule-wrong-rate"),
    },
    {
      id: "ask",
      say: "Ask the Agent to process it with the Contribution processing Pipeline.",
      focus: "chat",
      pendingLabel: "Waiting for the Agent…",
      run: say(SCHEDULE_ASK),
      settle: { kind: "run-started", timeoutMs: 15_000 },
      onDrift: schedulePlan("schedule-wrong-rate", SCHEDULE_FIRMER),
    },
    {
      id: "view",
      say: "Watch the Pipeline. Once the Schedule is read, matching Members, checking rates, the cap, coverage and the money received all run at the same time. Each is a code check against the Rules.",
      focus: "pipelines",
      run: openLatestRun("contribution_processing"),
    },
    {
      id: "exceptions",
      say: "Wait for the checks to finish. Read the exceptions table: the 4% employer share and the stranger on the list are Findings, each with the values it compared.",
      focus: "pipelines",
      pendingLabel: "Waiting for the Run to finish its checks…",
      run: openLatestRun("contribution_processing"),
      settle: { kind: "run-quiet", timeoutMs: 120_000 },
    },
    {
      id: "approval",
      say: "The Run drafted a query to the Employer and stopped at its Approval. A query is low risk, so any Staff member may approve it.",
      focus: "pipelines",
      pendingLabel: "Waiting for the Run to reach its Approval…",
      run: waitForApproval(),
    },
    {
      id: "approve",
      say: "Approve the query. The Schedule is marked held, not posted, until the Employer answers.",
      focus: "pipelines",
      pendingLabel: "Approving…",
      run: approve("Approved from Demo mode."),
      settle: { kind: "run-ended", timeoutMs: 45_000 },
    },
  ],
};

// 4 ----------------------------------------------------------------------------------

const DELINQUENCY_ASK =
  "Prepare the delinquency report for last month: which Employers have not remitted what they owe? Please use the Delinquency report Pipeline.";
const DELINQUENCY_FIRMER =
  "Please run the Delinquency report Pipeline for last month now.";

const delinquency: Scenario = {
  id: "delinquency",
  title: "Who is late this month",
  summary:
    "The Delinquency report finds Employers who have not paid, or paid late, computes what they owe, drafts a report to the Director of Labour and Pensions and a chaser for each, and needs four-eyes Approval.",
  features: ["Pipeline", "Approval"],
  minutes: 5,
  asRole: "Pensions Officer, then Operations Manager",
  beats: [
    {
      id: "session",
      say: "You are Keisha Wraymond, a pensions officer, with a new Session.",
      focus: "chat",
      run: seq(asStaff(OFFICER), newSession()),
    },
    {
      id: "ask",
      say: "Ask for the delinquency report for the latest month that has ended. No paper is needed: the Pipeline reads the Employers' Schedules and Remittances in the Workspace.",
      focus: "chat",
      pendingLabel: "Waiting for the Agent…",
      run: say(DELINQUENCY_ASK),
      settle: { kind: "run-started", timeoutMs: 15_000 },
      onDrift: delinquencyPlan(DELINQUENCY_FIRMER),
    },
    {
      id: "view",
      say: "Watch it. Finding the unpaid and finding the late run at the same time; then it computes what is owed, and the report and the chasers are drafted at the same time.",
      focus: "pipelines",
      run: openLatestRun("delinquency_report"),
    },
    {
      id: "findings",
      say: "Wait for the Run to reach its Approval. Read the Findings for each Employer, and the interest computed on what is owed. Interest comes from code, not from the model.",
      focus: "pipelines",
      pendingLabel: "Waiting for the Run to reach its Approval…",
      run: waitForApproval(),
    },
    {
      id: "refusal",
      say: "The report to the Director of Labour and Pensions is high risk. Keisha started the Run and is not an admin, so she cannot approve it.",
      focus: "pipelines",
      run: tryApprove("Approving my own report"),
    },
    {
      id: "manager",
      say: "Switch to Marva Lindo-Tibbett, the Operations Manager.",
      focus: "pipelines",
      run: asStaff(MANAGER),
    },
    {
      id: "approve",
      say: "She approves the report. The Run files it.",
      focus: "pipelines",
      pendingLabel: "Approving…",
      run: approve("Approved from Demo mode."),
      settle: { kind: "run-ended", timeoutMs: 45_000 },
    },
  ],
};

// 5 ----------------------------------------------------------------------------------

const PROPERTY_ASK =
  "What is the most a Member can withdraw from their pension for a property deposit? Cite the Sources.";

const guidanceConflict: Scenario = {
  id: "guidance-conflict",
  title: "New guidance contradicts the handbook",
  summary:
    "A new Circular is added to the Knowledge base and contradicts the Member Guide on the property withdrawal cap. The Agent proposes how to settle it, only an admin can, and the Agent then answers from the new Passage.",
  features: ["Knowledge base", "Conflict", "Claude"],
  minutes: 4,
  asRole: "Pensions Officer, then Operations Manager",
  beats: [
    {
      id: "upload",
      say: "You are Keisha Wraymond. Anyone may add a Source. Upload Pensions Circular 2023-07: it sets new caps for withdrawing towards a property, CI$50,000 and CI$100,000.",
      focus: "knowledge",
      pendingLabel: "Uploading and reading the document…",
      run: seq(asStaff(OFFICER), uploadKnowledge("kb-circular-2023-07")),
    },
    {
      id: "conflict",
      say: "It is read into Passages and compared with the old ones. The Member Guide still says CI$35,000, so a Conflict was found. The Agent proposes a Resolution, with its reasons.",
      focus: "knowledge",
      pendingLabel: "Looking for the Conflict…",
      run: openConflict(),
    },
    {
      id: "refusal",
      say: "A user cannot settle a Conflict. Keisha tries, and is refused.",
      focus: "knowledge",
      run: tryResolveConflict("supersede"),
    },
    {
      id: "manager",
      say: "Switch to Marva Lindo-Tibbett, the Operations Manager, who is an admin.",
      focus: "knowledge",
      run: seq(asStaff(MANAGER), openConflict()),
    },
    {
      id: "resolve",
      say: "She chooses “the new Passage supersedes the old one”. The old Passage is kept, with its date, and is no longer retrieved.",
      focus: "knowledge",
      pendingLabel: "Settling the Conflict…",
      run: resolveConflict("supersede"),
    },
    {
      id: "ask",
      say: "Ask the Agent about the property withdrawal cap in a new Session. It searches the Knowledge base and should cite the Circular, not the old guide.",
      focus: "chat",
      pendingLabel: "Waiting for the Agent…",
      run: seq(newSession(), say(PROPERTY_ASK)),
    },
  ],
};

// 6 ----------------------------------------------------------------------------------

const MEMBER_SERVICE_ASK =
  "A Member phoned to ask what happens to her pension if she leaves Cayman, and when she can take it out. Please answer from our guidance and cite the Sources.";
const SANDBOX_ASK =
  "In the Sandbox, write and run a short script that totals the employer and employee contributions in the attached CSV, and show me the totals.";

const memberService: Scenario = {
  id: "ask-code-connect",
  title: "Ask a question, run code, connect Claude",
  summary:
    "A member-service question answered from the Knowledge base with citations, a small analysis of a contributions CSV in the Sandbox, and the way to give Claude the same Skills and tools.",
  features: ["Knowledge base", "Sandbox", "Claude"],
  minutes: 4,
  asRole: "Pensions Officer, then Operations Manager",
  beats: [
    {
      id: "session",
      say: "You are Keisha Wraymond, a pensions officer, with a new Session.",
      focus: "chat",
      run: seq(asStaff(OFFICER), newSession()),
    },
    {
      id: "ask",
      say: "Ask a member-service question. The Agent searches the Knowledge base and answers with the Passages it used, each cited to its Source and date.",
      focus: "chat",
      pendingLabel: "Waiting for the Agent…",
      run: say(MEMBER_SERVICE_ASK),
    },
    {
      id: "admin",
      say: "The Sandbox is for admins only, so switch to Marva Lindo-Tibbett, the Operations Manager, in a new Session.",
      focus: "chat",
      run: seq(asStaff(MANAGER), newSession()),
    },
    {
      id: "csv",
      say: "Attach a contributions Schedule as a CSV: Pelican Shoal Marine Services' last month.",
      focus: "chat",
      run: attach("schedule-clean"),
    },
    {
      id: "sandbox",
      say: "Ask the Agent to total it in the Sandbox: a container with no network and capped CPU, memory and time, removed by the Runner when it is idle. If the Runner is offline, the guide says so and moves on.",
      focus: "chat",
      pendingLabel: "Waiting for the Agent…",
      run: sayIfAble(
        SANDBOX_ASK,
        "The rest of this Scenario does not need it.",
      ),
    },
    {
      id: "docs",
      say: "Claude can use the same Skills and the same tools. The Docs page on connecting Claude has the steps; the Connect page makes a token or signs Claude in with OAuth.",
      focus: "docs",
      links: [{ href: "/demos/harness/mcp", label: "Open the Connect page" }],
      run: openDoc("connect-claude-quick"),
    },
  ],
};

export const SCENARIOS: Scenario[] = [
  overseasTransfer,
  ruleChange,
  contributions,
  delinquency,
  guidanceConflict,
  memberService,
];

export const scenarioById = (id: string) =>
  SCENARIOS.find((scenario) => scenario.id === id) ?? null;
