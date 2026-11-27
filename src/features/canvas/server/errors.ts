import "server-only";
import { ConflictError, InvalidError } from "@/platform/errors";
import type { RuleEditError } from "../domain/rules";

/*
 * Canvas throws the platform's errors (`@/platform/errors`): 400 Invalid,
 * 404 NotFound, 409 Conflict, 429 Limit. Only what is Canvas's own is here,
 * and each extends one of them, so the REST layer, the MCP tools and the
 * chat stream map it the same way.
 */

/** The Guard or a check refused, under a Rule: 400, naming the Rule in `rule`. */
export class RuleRefusal extends InvalidError {
  constructor(
    readonly rule: string,
    message: string,
  ) {
    super(message, { rule });
  }
}

/** A Rule edit that fails its schema: 400, with one error per field at fault in `errors`. */
export class RuleEditRefused extends InvalidError {
  constructor(readonly errors: RuleEditError[]) {
    super(errors[0]?.message ?? "That Rule edit doesn't look right.", {
      errors,
    });
  }
}

/**
 * The Sandbox cannot be reached or failed: a 409 (as the Harness's) whose
 * message the Analyst can act on. The platform has no 503; a refusal the
 * visitor can retry is what both mean here.
 */
export class SandboxUnavailable extends ConflictError {
  constructor(message = "Sandbox unavailable") {
    super(message);
  }
}
