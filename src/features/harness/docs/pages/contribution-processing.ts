import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "contribution-processing",
  section: "desk",
  title: "Contribution processing",
  summary:
    "Check an Employer's monthly Schedule against the Rules and match it to the Remittance.",
  body: [
    md`
**Tool:** §pipeline_contribution_processing§

## Purpose

Each month an Employer sends a **Schedule** (one line per Member) and pays a **Remittance**. This Pipeline reads the Schedule, checks each line against the contribution Rules, such as the rates and the cap on pensionable earnings, and matches the total to the money received. It then decides in code whether to post the Schedule or hold it. Where something does not add up, it prepares an Employer query for a person to approve. Where everything does, it prepares a posting note.

All arithmetic is done in code and is shown with its inputs. A Schedule arrives as a CSV or a spreadsheet and is read by code. A model writes the Employer query. It does not decide whether a line is right.

## What goes in

`,
    { live: "pipeline-inputs", arg: "contribution_processing" },
    md`
## Steps

`,
    { live: "pipeline-steps", arg: "contribution_processing" },
    md`
A negative amount (in earnings or any contribution) is a refund or a correction, not a contribution. The line is left out, the problem names its row, and the Schedule is **held** for a person instead of being posted.

## Rules

The values shown are the Defaults. An admin can change them. Every Run records the Version it used.

`,
    { live: "rules", arg: "contribution_processing" },
    md`
## Drafts and Approval

The Run prepares an Employer query listing the exceptions, or a posting note. A query or a clean posting is **low risk**. Posting a Schedule over exceptions is **high risk** and needs an admin who did not start the Run. The input §overrideExceptions§ (true or false) asks to post a held Schedule over its exceptions. The Agent uses it only when a person asks in so many words. Then the Draft is a posting instruction instead of an Employer query, the Approval is high risk, and an approved Schedule is marked posted (§reconciled§) rather than held (§queried§). After the Approval, the last Step marks the Schedule posted (reconciled) or held (queried). See [Approvals and four-eyes](#doc:approvals).

## Limits of the check

The reference note behind the Rules lists things it could not verify, such as how a plan applies the earnings cap within a year and any tolerance for rounding. Where the demo had to choose, the choice is a demo design choice and the Rule says so. See [The rules reference and its limits](#doc:rules-reference).
`,
  ],
};
