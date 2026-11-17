import "server-only";
import { type Action, roleNeeded } from "../domain/permissions";
import type { RuleEditError } from "../domain/rules";

const PHRASE: Record<Action, string> = {
  "session.create": "open a Session",
  "run.start": "start a Run",
  "run.stop": "stop a Run",
  "approval.decide.low": "give an Approval",
  "approval.decide.high": "give a high-risk Approval",
  "skill.edit": "edit Skills",
  "rule.edit": "edit Rules",
  "conflict.resolve": "settle a Conflict",
  "source.add": "add a Source",
  "source.remove": "remove a Source",
  "sandbox.use": "use the Sandbox",
  "audit.read.own": "read an Audit trail",
  "audit.read.workspace": "read the whole Workspace's Audit trail",
  "plugin.download": "download the Plugin",
  "mcp.connect": "connect an MCP client",
};

/** The Staff member's Role may not do this. Routes answer 403. */
export class ForbiddenError extends Error {
  constructor(
    message: string,
    readonly action: Action | null = null,
  ) {
    super(message);
    this.name = "ForbiddenError";
  }

  /** Names the Role the action needs: "Only an admin may edit Rules. Switch Staff to try it." */
  static forAction(action: Action) {
    const role = roleNeeded(action);
    return new ForbiddenError(
      role === "admin"
        ? `Only an admin may ${PHRASE[action]}. Switch Staff to try it.`
        : `Your Role may not ${PHRASE[action]}.`,
      action,
    );
  }
}

/** A cap in `LIMITS` was reached. Routes answer 429. */
export class LimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LimitError";
  }
}

/** The thing asked for is not in this Workspace. Routes answer 404. */
export class NotFoundError extends Error {
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

/** The request cannot be done as asked. Routes answer 400. */
export class InvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidError";
  }
}

/** A Rule edit that fails its schema: one error per field at fault. Routes answer 400 with `errors`. */
export class RuleRefusedError extends InvalidError {
  constructor(readonly errors: RuleEditError[]) {
    super(errors[0]?.message ?? "That Rule edit doesn't look right.");
    this.name = "RuleRefusedError";
  }
}

/** The thing is in the wrong state: a Run already ended, an Approval already decided. Routes answer 409. */
export class StateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StateError";
  }
}
