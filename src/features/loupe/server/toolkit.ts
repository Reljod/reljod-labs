/**
 * What the services say about the Toolkit without reaching the Sandbox:
 * its refusal when there is none, and how the Sweep is shown on the Trail.
 * Pure, so a service test imports it without Vercel Sandbox.
 */

export class SandboxUnavailable extends Error {
  constructor(message = "Sandbox unavailable: it is not set up here.") {
    super(message);
    this.name = "SandboxUnavailable";
  }
}

export const SWEEP_CODE =
  "python3 -m loupe sweep  # every Check that fits the Document";
