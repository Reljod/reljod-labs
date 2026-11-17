"use server";

import { redirect } from "next/navigation";
import { AccessDeniedError } from "@/features/access/server/gate";
import {
  approvedRedirect,
  errorRedirect,
  type Grant,
  parseAuthorizationRequest,
} from "../domain/oauth";
import { can } from "../domain/permissions";
import { audit } from "./audit";
import { requireStaff } from "./context";
import { env } from "./env";
import { grantOf } from "./mcp-auth";
import { ownedStaff } from "./staff";

export type ConsentState = { error: string } | null;

/**
 * The consent page's Allow and Deny. The authorization request is read again
 * from the form, never trusted from the page. Allow mints the code from the
 * Access of whoever is signed in now, acting as the Staff member they chose,
 * who must be in their own Workspace (ADR 0013: fixed at mint time).
 */
export async function answerHarnessClient(
  _previous: ConsentState,
  form: FormData,
): Promise<ConsentState> {
  const secret = env.rateLimitSalt();
  const parsed = parseAuthorizationRequest(
    new URLSearchParams(String(form.get("request") ?? "")),
    secret,
  );
  if (parsed.kind === "invalid") return { error: parsed.message };
  if (parsed.kind === "error") redirect(parsed.redirect);
  const { request } = parsed;
  if (form.get("answer") !== "allow") {
    redirect(
      errorRedirect(
        request.redirectUri,
        request.state,
        "access_denied",
        "The person said no.",
      ),
    );
  }
  let grant: Grant;
  try {
    const context = await requireStaff();
    const staff = await ownedStaff(context.owner, form.get("staffId"));
    if (!staff) return { error: "Choose a Staff member of this Workspace." };
    if (!can(staff, "mcp.connect"))
      return { error: `${staff.name}'s Role may not connect an MCP client.` };
    grant = grantOf(context.access, context.owner, staff, context.visitor);
    await audit({
      owner: context.owner,
      actor: { kind: "staff", staff },
      action: "mcp.connected",
      summary: `Let ${request.client.name} act as ${staff.name}`,
      target: { kind: "staff", id: staff.id },
      detail: {
        via: "oauth",
        client: request.client.name,
        callbackHost: new URL(request.redirectUri).host,
        role: staff.role,
        until: grant.until,
      },
    });
  } catch (error) {
    if (error instanceof AccessDeniedError)
      return { error: "Your access has ended. Sign in again, then retry." };
    throw error;
  }
  redirect(approvedRedirect(request, grant, secret, Date.now()));
}
