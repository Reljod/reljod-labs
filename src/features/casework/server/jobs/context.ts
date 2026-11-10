import type { ModelSettingsByPurpose } from "../../domain/model-config";

/** What every step of a Run needs to know about where it runs. */
export type RunContext = {
  runId: string;
  sessionId: string | null;
  settings: ModelSettingsByPurpose;
};
