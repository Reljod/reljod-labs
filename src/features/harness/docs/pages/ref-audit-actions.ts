import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "ref-audit-actions",
  section: "reference",
  title: "Audit actions",
  summary: "The fixed list of things an Audit event can record.",
  body: [
    md`
Every Audit event has one of these actions. The list is in §AUDIT_ACTIONS§ in §domain/audit.ts§. A new action is added there first. The server accepts no other, and the database checks the shape of the name.

`,
    { live: "audit-actions" },
    md`
## Actors

An event's actor is one of three kinds: §staff§ (a named Staff member), §agent§ or §system§.

## How to use the list

In the [Audit tab](#tab:audit), filter by action to answer a question such as "who gave Approvals today" (§approval.decided§) or "what did the Agent cost" (§model.called§). See [Audit design](#doc:arch-audit).
`,
  ],
};
