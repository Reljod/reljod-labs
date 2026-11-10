"use client";

import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";
import { useEffect } from "react";
import { PROFILE_HINT_COOKIE } from "../constants";
import {
  AUDIENCE_FLAG,
  audienceFromHint,
  cookieValue,
} from "../domain/audience";

const ID = "labs-audience-flag";

/**
 * Writes the visitor's Audience (host, guest or visitor) into a
 * `data-flag-values` script tag, where the Web Analytics script reads flag
 * values, so the dashboard can group pageviews by it under Flags. It reads the
 * hint cookie in the browser, so public pages stay static.
 */
function tagAudience() {
  const audience = audienceFromHint(
    cookieValue(document.cookie, PROFILE_HINT_COOKIE),
  );
  let tag = document.getElementById(ID);
  if (!tag) {
    tag = document.createElement("script");
    tag.id = ID;
    tag.setAttribute("type", "application/json");
    tag.setAttribute("data-flag-values", "");
    document.head.appendChild(tag);
  }
  tag.textContent = JSON.stringify({ [AUDIENCE_FLAG]: audience });
}

/** Signing in or out changes the hint without a full page load. */
function beforeSend(event: BeforeSendEvent) {
  tagAudience();
  return event;
}

/** Vercel Web Analytics, with every pageview tagged by Audience. */
export function SiteAnalytics() {
  // Runs before <Analytics /> injects its script, so the first pageview of a
  // page load already carries the Audience.
  useEffect(tagAudience, []);
  return <Analytics beforeSend={beforeSend} />;
}
