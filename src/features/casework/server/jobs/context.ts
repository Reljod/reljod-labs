import type { ModelSettingsByPurpose } from "../../domain/model-config";

/** What every step of a Run needs to know about where it runs. */
export type RunContext = {
  runId: string;
  sessionId: string | null;
  settings: ModelSettingsByPurpose;
  /**
   * The Run was started by a stubbed e2e request: its steps read with the
   * labelled Reader instead of the models. Set by the container that starts
   * it; absent on every other Run (and on Runs from before it existed).
   */
  stub?: boolean;
};
