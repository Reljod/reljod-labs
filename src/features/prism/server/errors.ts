import "server-only";

/**
 * The Decision Model could not answer (the gateway failed, the provider is
 * down). Not a platform error: the platform has no 503, and this is not the
 * caller's fault. `modelUnavailable()` in `api.ts` answers it 503 with its
 * message; inside a Tribunal or Cascade stream it becomes that juror's or
 * Slip's error line.
 */
export class ProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}
