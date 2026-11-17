import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import type { Staff } from "../domain/staff";
import type { Visitor } from "./rate";

/**
 * Who a server function acts as: the Owner whose Workspace it reaches and
 * the Staff member whose Role it is checked against and whose name the Audit
 * event carries. A `StaffContext` is one; so are the claims of an MCP token.
 */
export type Actor = { owner: Owner; staff: Staff };

/** An Actor doing capped work: the visitor hash its hourly limits count against. */
export type PaidActor = Actor & { visitor: Visitor };
