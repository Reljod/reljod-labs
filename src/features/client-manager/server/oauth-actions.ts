"use server";

import { redirect } from "next/navigation";
import { AccessDeniedError } from "@/features/access/server/gate";
import {
  approvedRedirect,
  errorRedirect,
  type Grant,
  parseAuthorizationRequest,
} from "../domain/oauth";
import { env } from "./env";
import { currentGrant } from "./mcp-auth";

export type ConsentState = { error: string } | null;

/**
 * The consent page's Allow and Deny. The authorization request is read again
 * from the form, never trusted from the page, and Allow mints the code from
 * the Grant of whoever is signed in now.
 */
export async function answerMcpClient(
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
    grant = await currentGrant();
  } catch (error) {
    if (error instanceof AccessDeniedError)
      return { error: "Your access has ended. Sign in again, then retry." };
    throw error;
  }
  redirect(approvedRedirect(request, grant, secret, Date.now()));
}
