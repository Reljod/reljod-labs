import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "member-request",
  section: "desk",
  title: "Member request",
  summary:
    "Check a Member's request against the Rules and prepare the Drafts for a person to approve.",
  body: [
    md`
**Tool:** §pipeline_member_request§

## Purpose

A Member asks the plan to do something: transfer their balance out, withdraw because they are leaving Cayman, withdraw for property, retire, or claim on death. This Pipeline reads the request and its papers, checks the Member's facts against the Rules for that kind of request, and prepares what the desk would send. A person approves it.

## What goes in

`,
    { live: "pipeline-inputs", arg: "member_request" },
    md`
The §kind§ input is optional. A kind given when a person starts the Run in the app, or set by the guide in Demo mode, is used as given. A kind the Agent or an MCP client passes is a model's reading, not a person's statement: it stands only when the papers' own wording (keywords in code) names the same kind, and otherwise **Request kind confirmed** is not met and a person confirms it. Left out, the Pipeline reads the kind from the papers twice, once by the model and once by keywords in code. The Rule **Request kind confirmed** (§mr.kind-confirmed§, Outcome refer) asks a person to confirm the kind when the two disagree or the model could not be asked.

## Steps

`,
    { live: "pipeline-steps", arg: "member_request" },
    md`
The Rule **Old enough to retire** also knows the age-60 option: a Member born on or before 31 December of a cut-off year (1969 by default) may retire from age 60. Age, cut-off year and early age are Parameters. The cut-off comes from secondary sources, and the Rule's citation says so.

Model Steps classify the request, read the papers and write the Draft. They never return a Finding. Only code does, and the Decide Step combines the Findings in code: any Rule with the Outcome block rejects, any refer asks for papers or a look, and otherwise the request proceeds.

## Rules

Each Rule shows where it comes from and the date its Default took effect. The values shown are the Defaults. An admin can change them in the [Skills tab](#tab:skills), and every Run records the Version it used.

`,
    { live: "rules", arg: "member_request" },
    md`
## Drafts and Approval

The model writes the Draft from the Findings, and the amounts in it come from code. The Draft is a letter asking for papers, a rejection, or a payment or transfer instruction. A letter that asks for missing papers is **low risk**: any Staff member may approve it. A rejection or a payment or transfer instruction is **high risk** and needs an admin who did not start the Run. After the Approval, the last Step records the Member request and its status. See [Approvals and four-eyes](#doc:approvals).

## Where to read more

- The Skill that tells the Agent when to use it is listed under [Skills](#doc:skills).
- The Rules cite the Cayman National Pensions Act. Read [The rules reference and its limits](#doc:rules-reference) before relying on any of them.
`,
  ],
};
