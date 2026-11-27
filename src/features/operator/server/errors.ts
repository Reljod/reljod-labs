import { ConflictError } from "@/platform/errors";

/**
 * A Run's Screen sandbox cannot be started or reached. The message is the one
 * people and the model are shown; the SDK's own text goes to the log only. A
 * Run that meets it is closed (failed), so it answers 409 when it reaches a
 * route: the Run is no longer in a state anything can be done to.
 */
export class ScreenUnavailable extends ConflictError {
  constructor(detail: string) {
    super("The Screen sandbox is unavailable.");
    console.error("[operator] screen sandbox:", detail);
  }
}
