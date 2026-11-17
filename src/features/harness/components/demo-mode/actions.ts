import type { Resolution } from "../../domain/knowledge";
import type { PipelineId } from "../../domain/pipeline";
import { addPeriods, periodOf } from "../../domain/pipelines/dates";
import type { ParameterValue } from "../../domain/rules";
import { isRunActive } from "../../domain/run";
import { sampleById } from "../../domain/samples";
import type { LinkParams, TabId } from "../harness-context";
import {
  type Action,
  type BeatContext,
  DriftError,
  messageOf,
  raceAbort,
  type SettleCheck,
  type Settlers,
  sleep,
} from "./engine";

/**
 * The small typed actions a Beat is built from. Each goes through the app the
 * way a person's click does: `controller(name)` for a tab, the same Harness
 * API for the few things no controller covers (listed in the report).
 */

/** Runs actions one after another, stopping at the first that fails or is aborted. */
export const seq =
  (...actions: Action[]): Action =>
  async (ctx) => {
    for (const action of actions) {
      if (ctx.signal.aborted) return;
      await action(ctx);
    }
  };

// Staff and tabs -----------------------------------------------------------------

/** Signs in as a Staff member (by seed key) unless they are already. */
export const asStaff =
  (key: string): Action =>
  async (ctx) => {
    const now = ctx.host.staff();
    if (now.key === key) {
      ctx.log(`Already signed in as ${now.name}, ${now.title}.`);
      return;
    }
    ctx.pending("Signing in…");
    const staff = await (await ctx.host.controller("staff")).switch(key);
    ctx.log(`Signed in as ${staff.name}, ${staff.title}.`);
  };

export const openTab =
  (tab: TabId, params?: LinkParams): Action =>
  async (ctx) => {
    await (await ctx.host.controller("tabs")).open(tab, params);
  };

// Chat ---------------------------------------------------------------------------

/** Opens Chat on a new Session. */
export const newSession = (): Action => async (ctx) => {
  await openTab("chat")(ctx);
  const chat = await ctx.host.controller("chat");
  const id = await chat.newSession();
  ctx.state.sessionId = id;
  ctx.state.runId = null;
  ctx.state.attached = [];
  ctx.log("Started a new Session.");
};

/** Shows the Scenario's Session in Chat again (after a visit to another tab). */
export const backToSession = (): Action => async (ctx) => {
  await openTab(
    "chat",
    ctx.state.sessionId ? { session: ctx.state.sessionId } : undefined,
  )(ctx);
};

/** Attaches a sample file to the next message. */
export const attach =
  (sampleId: string): Action =>
  async (ctx) => {
    const sample = sampleById(sampleId);
    if (!sample) throw new Error(`The sample “${sampleId}” is not in the app.`);
    await openTab("chat")(ctx);
    ctx.pending("Attaching the paper…");
    await (await ctx.host.controller("chat")).attachFixture(sample.id);
    if (!ctx.state.attached.includes(sample.id)) {
      ctx.state.attached.push(sample.id);
    }
    ctx.log(`Attached ${sample.name}.`);
  };

/** Sends a message as the signed-in Staff member and waits for the Agent to finish answering. */
export const say =
  (text: string): Action =>
  async (ctx) => {
    await openTab("chat")(ctx);
    const chat = await ctx.host.controller("chat");
    ctx.pending("Sending…");
    await chat.send(text);
    ctx.log(`Asked the Agent: “${text}”`);
    ctx.pending("Waiting for the Agent…");
    await chat.waitIdle();
    ctx.log("The Agent finished answering.");
  };

/**
 * Like `say`, but a refusal or an outage does not stop the Scenario: it is
 * shown and logged, and the Beat is done. For the Sandbox, which may be off.
 */
export const sayIfAble =
  (text: string, whenOff: string): Action =>
  async (ctx) => {
    const status = await ctx.host.sandbox
      .status(ctx.state.sessionId)
      .catch(() => null);
    if (status && !status.usable) {
      const why = status.message ?? "The Sandbox is not available.";
      ctx.notice(`${why} ${whenOff}`);
      ctx.log(`Skipped the Sandbox: ${why}`);
      return;
    }
    try {
      await say(text)(ctx);
    } catch (caught) {
      if (ctx.signal.aborted) throw caught;
      const why = messageOf(caught);
      ctx.notice(`The Agent could not finish that: ${why} ${whenOff}`);
      ctx.log(`The Sandbox step did not finish: ${why}`);
    }
  };

// Runs ---------------------------------------------------------------------------

/** The Source id of a sample attached in this Scenario's Session. */
export async function sourceIdOf(
  ctx: BeatContext,
  sampleId: string,
): Promise<string> {
  const sample = sampleById(sampleId);
  const sources = await ctx.host.sources.list();
  const here = sources
    .filter((source) => source.sessionId === ctx.state.sessionId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const match =
    here.find(
      (source) =>
        sample &&
        (source.title === sample.name || source.title.includes(sample.name)),
    ) ?? here[0];
  if (!match) {
    throw new Error(
      "The attached paper is not in this Session's Sources, so the guide cannot start the Run on it.",
    );
  }
  return match.id;
}

/** The latest month that has ended, as the Delinquency report wants it. */
export const latestEndedPeriod = (ctx: BeatContext) =>
  addPeriods(periodOf(ctx.host.today()), -1);

/**
 * Shows the Scenario's Run in the Pipeline view: the one the Beats are about,
 * or the newest of a Pipeline in the Session.
 */
export const openLatestRun =
  (pipelineId?: PipelineId): Action =>
  async (ctx) => {
    let id = ctx.state.runId;
    if (!id) {
      if (!ctx.state.sessionId) throw new Error("There is no Session yet.");
      const runs = await ctx.host.runs.list(ctx.state.sessionId);
      const found = runs.find(
        (run) => !pipelineId || run.pipelineId === pipelineId,
      );
      if (!found) {
        throw new DriftError(
          "There is no Run in this Session yet, so there is nothing to open.",
        );
      }
      id = found.id;
      rememberRun(ctx, id);
    }
    await openRun(id)(ctx);
  };

/** Shows a particular Run in the Pipeline view. */
export const openRun =
  (runId: string): Action =>
  async (ctx) => {
    await openTab("pipelines")(ctx);
    ctx.pending("Opening the Run…");
    await (await ctx.host.controller("pipelines")).openRun(runId);
    ctx.state.runId = runId;
    ctx.log("Opened the Run in the Pipeline view.");
  };

/** Shows the first Run this Scenario saw, for comparing with a later one. */
export const openFirstRun = (): Action => async (ctx) => {
  const first = ctx.state.runIds[0];
  if (!first) throw new DriftError("There is no first Run to go back to.");
  await openRun(first)(ctx);
};

export function rememberRun(ctx: BeatContext, runId: string) {
  ctx.state.runId = runId;
  if (!ctx.state.runIds.includes(runId)) ctx.state.runIds.push(runId);
}

/** Waits for the open Run to reach its Approval. */
export const waitForApproval =
  (timeoutMs = 150_000): Action =>
  async (ctx) => {
    if (ctx.state.runId) await openRun(ctx.state.runId)(ctx);
    const runId = ctx.state.runId;
    if (!runId) throw new DriftError("There is no Run to wait for.");
    ctx.pending("Waiting for the Run to reach its Approval…");
    const run = await ctx.host.runs.get(runId);
    if (
      !isRunActive(run.status) &&
      !run.approvals.some((a) => a.status === "pending")
    ) {
      throw new DriftError(
        `The Run ended (${run.status}) without needing an Approval, so there is nothing to approve.`,
      );
    }
    const pipelines = await ctx.host.controller("pipelines");
    const wait = pipelines.waitForApproval().then(
      (approval) => approval,
      (error) => {
        throw new DriftError(messageOf(error));
      },
    );
    const approval = await raceAbort(
      ctx.signal,
      Promise.race([
        wait,
        sleep(timeoutMs, ctx.signal).then(() => {
          throw new DriftError(
            "The Run has not reached its Approval yet. Retry to keep waiting.",
          );
        }),
      ]),
    );
    ctx.log(
      `The Run is waiting for a ${approval.risk}-risk Approval: ${approval.title}.`,
    );
  };

/** Approves the open Run's Approval as the signed-in Staff member. */
export const approve =
  (note: string): Action =>
  async (ctx) => {
    await openRun(requireRun(ctx))(ctx);
    ctx.pending("Approving…");
    await (await ctx.host.controller("pipelines")).approve(note);
    ctx.log(`Approved as ${ctx.host.staff().name}.`);
  };

/**
 * Tries to approve as someone who may not, to show the refusal. The refusal
 * is the point, so it is not a failure; an approval that goes through is
 * logged as what it is.
 */
export const tryApprove =
  (note: string): Action =>
  async (ctx) => {
    await openRun(requireRun(ctx))(ctx);
    ctx.pending("Trying to approve…");
    try {
      await (await ctx.host.controller("pipelines")).approve(note);
      ctx.log(`${ctx.host.staff().name} was allowed to approve it.`);
    } catch (caught) {
      if (ctx.signal.aborted) throw caught;
      const why = messageOf(caught);
      ctx.notice(`Refused: ${why}`);
      ctx.log(`${ctx.host.staff().name} could not approve: ${why}`);
    }
  };

function requireRun(ctx: BeatContext): string {
  if (!ctx.state.runId) throw new DriftError("There is no Run open.");
  return ctx.state.runId;
}

/** Stops the Scenario's Run if it is still waiting on a person, so it frees its place among the Runs at work. */
export const stopRunIfWaiting = (): Action => async (ctx) => {
  const id = ctx.state.runId;
  if (!id) return;
  const run = await ctx.host.runs.get(id);
  if (run.status !== "waiting_approval") return;
  await ctx.host.runs.stop(id);
  ctx.log(
    "Stopped the first Run, which was waiting for an Approval nobody here will give, so it no longer counts among the Runs at work.",
  );
};

// Skills and Rules ------------------------------------------------------------------

export const openRule =
  (ruleId: string): Action =>
  async (ctx) => {
    ctx.pending("Opening the Rule…");
    await (await ctx.host.controller("skills")).openRule(ruleId);
    ctx.log(`Opened the Rule ${ruleId}.`);
  };

export const setParameter =
  (name: string, value: ParameterValue): Action =>
  async (ctx) => {
    await (await ctx.host.controller("skills")).setParameter(name, value);
    ctx.log(`Set the Parameter ${name} to ${String(value)} (not saved yet).`);
  };

export const saveRule = (): Action => async (ctx) => {
  ctx.pending("Saving a new Version…");
  await (await ctx.host.controller("skills")).save();
  ctx.log("Saved the Rule as a new Version.");
};

/** Puts a Rule back to its Default, through the same call the Restore button makes. */
export const restoreRule =
  (ruleId: string): Action =>
  async (ctx) => {
    ctx.pending("Restoring the Default…");
    await ctx.host.rules.restore(ruleId);
    await openRule(ruleId)(ctx);
    ctx.log(`Restored the Default of ${ruleId}.`);
  };

// Knowledge base --------------------------------------------------------------------

export const uploadKnowledge =
  (sampleId: string): Action =>
  async (ctx) => {
    const sample = sampleById(sampleId);
    if (!sample) throw new Error(`The sample “${sampleId}” is not in the app.`);
    await openTab("knowledge")(ctx);
    ctx.pending("Uploading and reading the document…");
    await (await ctx.host.controller("knowledge")).uploadFixture(sample.id);
    ctx.log(`Added ${sample.name} to the Knowledge base.`);
  };

/** Shows the newest open Conflict. It may take a moment to be found after a Source is read, so it looks a few times. */
export const openConflict =
  (attempts = 5): Action =>
  async (ctx) => {
    await openTab("knowledge")(ctx);
    const knowledge = await ctx.host.controller("knowledge");
    ctx.pending("Looking for the Conflict…");
    let last: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        await knowledge.openConflict();
        ctx.log("Opened the Conflict.");
        return;
      } catch (caught) {
        last = caught;
        await sleep(1_500, ctx.signal);
      }
    }
    throw new DriftError(messageOf(last));
  };

export const resolveConflict =
  (resolution: Resolution): Action =>
  async (ctx) => {
    ctx.pending("Settling the Conflict…");
    await (await ctx.host.controller("knowledge")).resolve(resolution);
    ctx.log(`Settled the Conflict: ${resolution}.`);
  };

/** Tries to settle the Conflict as someone who may not, to show the refusal. */
export const tryResolveConflict =
  (resolution: Resolution): Action =>
  async (ctx) => {
    ctx.pending("Trying to settle it…");
    try {
      await (await ctx.host.controller("knowledge")).resolve(resolution);
      ctx.log(`${ctx.host.staff().name} was allowed to settle it.`);
    } catch (caught) {
      if (ctx.signal.aborted) throw caught;
      const why = messageOf(caught);
      ctx.notice(`Refused: ${why}`);
      ctx.log(`${ctx.host.staff().name} could not settle it: ${why}`);
    }
  };

// Audit and Docs --------------------------------------------------------------------

/**
 * Opens the Audit trail. No controller sets its scope, so this opens the tab
 * with the Session in the link and tells the visitor which button to press.
 */
export const openAudit =
  (scope: "session" | "workspace"): Action =>
  async (ctx) => {
    await openTab(
      "audit",
      ctx.state.sessionId ? { session: ctx.state.sessionId } : undefined,
    )(ctx);
    ctx.notice(
      scope === "session"
        ? "In the Audit tab, press “This Session” to see only this case."
        : "In the Audit tab, press “Whole Workspace” (an admin's view).",
    );
    ctx.log("Opened the Audit trail.");
  };

export const openDoc =
  (docId: string): Action =>
  async (ctx) => {
    await openTab("docs", { doc: docId })(ctx);
    ctx.log(`Opened the Docs page ${docId}.`);
  };

// Settling ---------------------------------------------------------------------------

/** What a Beat waits for after its actions. Each is one look; the engine polls. */
export const settlers: Settlers = {
  "run-started": async (ctx): Promise<SettleCheck> => {
    const plan = ctx.beat.onDrift;
    if (!ctx.state.sessionId) {
      return { done: false, why: "There is no Session to look in." };
    }
    const runs = await ctx.host.runs.list(ctx.state.sessionId);
    const fresh = runs.find(
      (run) =>
        !ctx.state.runIds.includes(run.id) &&
        (!plan || run.pipelineId === plan.pipelineId),
    );
    if (!fresh) {
      return {
        done: false,
        why: `The Agent answered, but no ${labelOf(plan?.pipelineId)} Run has started in this Session. It may have asked a question, or answered from what it knew instead of running the Pipeline.`,
      };
    }
    rememberRun(ctx, fresh.id);
    ctx.log(`A Run started: ${fresh.subject}.`);
    return { done: true };
  },
  "run-quiet": async (ctx): Promise<SettleCheck> => {
    const id = ctx.state.runId;
    if (!id) return { done: false, why: "There is no Run to watch." };
    const run = await ctx.host.runs.get(id);
    if (run.status === "queued" || run.status === "running") {
      return {
        done: false,
        why: "The Run is still working through its Steps. Retry to keep waiting.",
      };
    }
    ctx.log(`The Run is ${run.status.replaceAll("_", " ")}.`);
    return { done: true };
  },
  "run-ended": async (ctx): Promise<SettleCheck> => {
    const id = ctx.state.runId;
    if (!id) return { done: false, why: "There is no Run to watch." };
    const run = await ctx.host.runs.get(id);
    if (isRunActive(run.status)) {
      return {
        done: false,
        why: "The Run has not ended yet. Retry to keep waiting.",
      };
    }
    ctx.log(`The Run ended: ${run.status}.`);
    return { done: true };
  },
};

function labelOf(id: PipelineId | undefined) {
  if (!id) return "";
  return id === "member_request"
    ? "Member request"
    : id === "contribution_processing"
      ? "Contribution processing"
      : "Delinquency report";
}
