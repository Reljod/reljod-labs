import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "claude-prompts",
  section: "claude",
  title: "Example prompts to try in Claude",
  summary: "Things to ask once Claude is connected.",
  body: [
    md`
These work in Claude.ai, Claude Code and Cowork once the Harness is connected. Claude's answer depends on the Staff member you signed in as. The records and documents are fictional.

## Look around

> List the Harness Pipelines and what each one takes as input.

> Which Employers are delinquent?

> Find the Member with the number I give you and show their Member requests.

## Run a Pipeline

> Start the member request Pipeline for the transfer out of Member <member number>. Tell me the Findings and link me to the Run.

> Run contribution processing for the latest Schedule of <employer code> and tell me what does not add up.

Then open the link Claude gives you and give the Approval yourself, as the right Staff member.

## Ask the Knowledge base

> What does the Knowledge base say about transferring a balance to a plan outside Cayman? Cite the Passages.

> Is there an open Conflict about the time limit for a transfer?

## Read the rules

> List the Rules the delinquency report uses, with their Parameters, and say where each comes from.

## Review what happened

> Show the Audit trail for the Run you just started.

## Data work

> Add up the contribution lines in this Schedule and show me the total by Member.

You do not need to mention the Sandbox. The Agent writes and runs code there when a number needs working out. It has no network and limited time. See [Sandbox](#doc:sandbox).

## Prompts Claude should refuse

> Approve that Run.

Claude should say it cannot, and give the link. If it claims it did, it did not: check the Run. See [What Claude cannot do](#doc:claude-limits).
`,
  ],
};
