import { isRunActive, type RunStatus, type StepStatus } from "../../domain/run";
import type { Tone } from "../ui";

/** How a Run's status reads and what colour its badge takes. One table for the chat card, the list and the header. */
export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  queued: "Queued",
  running: "Running",
  waiting_approval: "Waiting for Approval",
  completed: "Completed",
  returned: "Returned",
  failed: "Failed",
  stopped: "Stopped",
};

export const RUN_STATUS_TONE: Record<RunStatus, Tone> = {
  queued: "neutral",
  running: "blue",
  waiting_approval: "amber",
  completed: "green",
  returned: "amber",
  failed: "red",
  stopped: "neutral",
};

/** A Run that is at work pulses; one that waits for a person pulses too, so it is not missed. */
export const runPulses = (status: RunStatus) => isRunActive(status);

export const STEP_STATUS_LABEL: Record<StepStatus, string> = {
  pending: "Pending",
  running: "Running",
  done: "Done",
  failed: "Failed",
  skipped: "Skipped",
};

export const STEP_STATUS_TONE: Record<StepStatus, Tone> = {
  pending: "neutral",
  running: "blue",
  done: "green",
  failed: "red",
  skipped: "neutral",
};
