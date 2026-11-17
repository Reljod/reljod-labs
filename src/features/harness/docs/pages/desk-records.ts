import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "desk-records",
  section: "desk",
  title: "The desk and its records",
  summary:
    "The Pensions Operations Desk of Harbour Bank & Trust, and the records its Pipelines read.",
  body: [
    md`
The first desk the Harness is set up for is the **Pensions Operations Desk** of Harbour Bank & Trust, a fictional Cayman bank that administers a private-sector pension plan. The desk's work follows the published shape of the Cayman National Pensions Act. Nothing here is real: see [What is in the demo, and what is fictional](#doc:in-the-demo).

## What the desk does

Three kinds of work, each a Pipeline:

- answering a **Member request** (a transfer out, a withdrawal, retirement, a claim on death): [Member request](#doc:member-request);
- processing an **Employer's monthly contributions**: [Contribution processing](#doc:contribution-processing);
- reporting **late contributions**: [Delinquency report](#doc:delinquency-report).

A fourth kind of work is answering a Member's questions. It is a Skill, not a Pipeline: [Member service answers](#doc:member-service-answers).

## The records

Records are in your Workspace, seeded the first time you open the Harness. The Agent reads them through MCP tools such as §find_members§, §get_member§, §get_employer§ and §list_schedules§. Amounts are in Cayman Islands dollars (KYD).

| Record | What it is |
| --- | --- |
| **Employer** | A company in the plan that remits contributions for its Members each month. It has a code and a status: active, delinquent, suspended or closed. |
| **Member** | A person with a pension account in the plan. Not a Staff member. It has a member number, an Employer, a balance, a status and dates such as when they left Cayman. |
| **Schedule** | An Employer's monthly file of contribution lines, one per Member: earnings and the employee, employer and voluntary amounts. |
| **Remittance** | The money an Employer paid for one month, to be matched to its Schedule. |
| **Member request** | What a Member asks the plan to do. |

The kinds of Member request:

`,
    { live: "member-request-kinds" },
    md`
## Sample case papers

The Chat tab can attach sample files: SPECIMEN letters, forms and Schedules for the fictional Members and Employers. A Schedule can be a spreadsheet or CSV; it is read as a pending Source and handed to a Pipeline.

## Where records come from

In this demo they are seed data. In a real deployment, they would come from the bank's systems. Connectors for that are on the [Roadmap](#doc:ops-roadmap).
`,
  ],
};
