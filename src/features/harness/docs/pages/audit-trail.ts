import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "audit-trail",
  section: "concepts",
  title: "Audit trail",
  summary:
    "One append-only record of who did what, when, and with which model.",
  body: [
    md`
An **Audit event** is one recorded action: who (a Staff member, the Agent or the system), when, what, on what, and in which Session. Agent events also carry the model, the tokens and the cost. Events are only ever added.

The **Audit trail** is the Audit events of a Session, or of the whole Workspace for an admin.

## What is recorded

Every action in the fixed list below. A new kind of action is added to that list in code first, and the server accepts nothing else.

`,
    { live: "audit-actions" },
    md`
## What is not recorded

Details hold ids, names, sizes and Rule Versions. They never hold a secret or a whole document. Long text is cut, long lists are trimmed, and anything under a key that looks like a credential is replaced with §[redacted]§.

## Who can read it

A user reads their own Sessions' trails. An admin reads the whole Workspace's. See [Audit tab](#doc:app-audit).

## Why it can be trusted

A database trigger refuses every update and delete, and every truncate. Events go only when the whole Workspace goes. See [Audit design](#doc:arch-audit).
`,
  ],
};
