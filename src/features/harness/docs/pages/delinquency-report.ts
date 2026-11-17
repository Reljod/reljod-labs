import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "delinquency-report",
  section: "desk",
  title: "Delinquency report",
  summary:
    "Find contributions that are late, work out interest, and prepare the report for the regulator.",
  body: [
    md`
**Tool:** §pipeline_delinquency_report§

## Purpose

A contribution that is not received by the deadline is delinquent. The administrator must act to collect it, and a contribution still unpaid by a later date must be reported in writing to the Director of Labour and Pensions. This Pipeline loads every Employer's Schedule and the money received for the month, finds the Employers that paid nothing or paid short and those that paid late, works out how late and what interest is owed, and prepares the Drafts.

Days late and interest are calculated in code and shown with their inputs.

## What goes in

`,
    { live: "pipeline-inputs", arg: "delinquency_report" },
    md`
## Steps

`,
    { live: "pipeline-steps", arg: "delinquency_report" },
    md`
## Rules

The values shown are the Defaults. An admin can change them. Every Run records the Version it used.

`,
    { live: "rules", arg: "delinquency_report" },
    md`
## Drafts and Approval

The Run writes the **report to the regulator** and, at the same time, one chaser (an employer query) for each delinquent Employer. The Approval is **high risk**: an admin who did not start the Run approves the report. After the Approval, the last Step records the report as filed and marks the Employers delinquent.

Nothing is sent to anyone. A Draft is text for a person. See [Approvals and four-eyes](#doc:approvals).

## Limits

The reference note records that some values behind this work are unverified. Two examples: the prime rate used for late-contribution interest was not sourced, and what happens when the reporting date falls on a weekend or a public holiday was not found. Where the demo needed a value, it is a demo design choice. See [The rules reference and its limits](#doc:rules-reference).
`,
  ],
};
