import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "ops-roadmap",
  section: "operations",
  title: "Roadmap",
  summary:
    "What is planned, and what is deliberately left out. Nothing here is promised.",
  body: [
    md`
This is a list of directions, not a schedule.

## Planned

- **Connectors for mail and chat.** Gmail and Slack as sources of the Knowledge base. See [Add a Connector](#doc:ops-add-connector).
- **More desks.** The Harness is set up for one desk, the Pensions Operations Desk. A desk is records, Pipelines, Rules and Skills. Others, such as a loans desk, would add their own and reuse the rest.

## Open questions

- **Who may code.** The Sandbox is open to every visitor and held in by its caps and the Audit trail. A real deployment would decide which Staff may code and keep the Role as a boundary. See [Sandbox design](#doc:arch-sandbox).
- **Separate people.** In a real deployment, Staff would be separate Auth users and Roles would be a boundary. The demo keeps them together on purpose.
- **A tamper-proof Audit trail.** Today the trail is append-only for the application. A real deployment would also ship events to storage the database owner cannot change.
- **Verified Rules.** The research note lists what could not be verified. A real deployment would have a pensions specialist confirm each Rule.

## Out of scope

- Giving advice to Members.
- Sending anything to a real person or regulator.
- Letting an Agent give an Approval.
`,
  ],
};
