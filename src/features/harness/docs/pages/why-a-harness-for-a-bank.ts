import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "why-a-harness-for-a-bank",
  section: "introduction",
  title: "Why a harness for a bank",
  summary:
    "The guardrails: a person decides, answers are grounded and cited, everything is logged, rules are data, and the AI gives no advice.",
  body: [
    md`
A chat model on its own can answer a pension question fluently and get it wrong. A bank cannot work like that. The Harness is built around five guardrails, and each one is a feature you can see, not a promise.

## A person decides

A Run stops at an **Approval** before anything leaves the desk. Low-risk Approvals (a letter, a request for missing documents) can be given by any Staff member. High-risk Approvals (a payment instruction, a rejection, a report to the regulator) need an admin who did not start the Run. This is the four-eyes rule.

The Agent cannot give an Approval. No tool on the MCP server does, so Claude cannot either. See [Approvals and four-eyes](#doc:approvals).

## Answers are grounded and cited

The Agent answers from the **Knowledge base** and the records, and cites the **Passage** it used. Search finds Passages by meaning and by exact words together, so a form number or a section is found as well as a paraphrase. When two Passages disagree, the Harness records a **Conflict** and a person settles it. Until then, an answer that cites either Passage says a Conflict is open. See [Conflicts and Resolutions](#doc:conflicts).

## Everything is logged for audit

Every message, tool call, Step, Finding, Approval, edit and Sandbox command is an **Audit event**. Events are only ever added: a database trigger refuses updates and deletes. Agent events carry the model, the tokens and the cost. See [Audit trail](#doc:audit-trail).

## Rules are data

Pension rules change. If they live only in prompts, a model decides eligibility and nobody can say which rule produced a decision. If they live only in code, a change of a number needs an engineer. In the Harness a **Rule** is data with Parameters an admin can edit, an Outcome, a citation and an effective date. The check that uses it is code. Every Run records the Version of every Rule it applied, so an old decision can be explained after the Rule changes. See [Rulebooks and Rules](#doc:rulebooks-rules).

## No advice by AI

Models do two jobs in a Pipeline: they read documents and they write Drafts. They never return a Finding. Calculations (days late, amounts, rate checks) are done in code and shown with their inputs. A Draft is text for a person to approve, not a decision.

## What these guardrails do not do

- They do not make the demo a compliance system. The Rules are illustrative.
- A Role separates duties inside a Workspace. It is not a security boundary between visitors. Anyone in a Workspace can switch to its admin, on purpose, so every visitor can try both Roles. See [Access, Owners and why Staff are not Auth users](#doc:arch-access).
`,
  ],
};
