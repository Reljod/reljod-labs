import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "arch-access",
  section: "architecture",
  title: "Access, Owners and why Staff are not Auth users",
  summary:
    "Who may open the Harness, whose data it is, and why Roles are not a boundary between visitors.",
  body: [
    md`
## Access

The Harness calls a paid model, so §/demos/harness§ and §/api/harness/*§ open only to a **Host** (a Supabase Auth account) or a **Guest** on a live Guest pass. Two gates are both required:

1. The **proxy** turns visitors away before a page or route runs.
2. Every route handler and server function calls the Access gate itself (§requireStaff()§ or §staffOrDenied()§), because a server action can be posted to any page.

A Guest is an anonymous Auth user. Anyone can become one, so an Auth session alone grants nothing. Access comes from a row binding the user to a live Guest pass.

## Owners

Every row the Harness saves carries an §owner§: §host:<auth user id>§, §guest:<guest pass id>§ or §e2e§ (ADR 0011). A Guest's Owner is their Guest pass, never their Auth user, so their data survives the user's clean-up, a new Guest code and an extension.

Every list and every load is scoped to the Owner in the server function. A cookie, an id in the URL or the visitor hash never scopes saved data. Rate limits stay on the visitor hash.

A user action on a Guest pass never hard-deletes an Owner's data. Deleting a pass marks it. A cron job purges the pass and its data 30 days later, and the Host can restore it until then.

## Why Staff are not Auth users

ADR 0014 explains the choice. With one identity per Workspace, nobody is left to separate, and the "who" column of an Audit trail would hold one name. Making the Host the only admin would be real access control that no Guest could ever see.

So each Workspace is seeded with named Staff, and the visitor picks who they are signed in as. The choice is kept in a cookie (§harness_staff§) that only remembers which of the Owner's own Staff is active. The server checks it against the Owner on every request. §requireStaff()§ returns the Owner and the Staff member, and §can(staff, action)§ is the one place Roles are decided.

Staff are rows, not Auth users. That means nothing here touches the clean-up job for anonymous users.

## What a Role is, and is not

A Role separates duties inside a Workspace so that you can see four-eyes and RBAC at work. It is **not** a security boundary between visitors. Anyone in a Workspace can switch to its admin, by design. What protects one visitor from another is Access and the Owner.

The consequence for risky features is plain: "admin only" would not protect them from a Guest. So the Sandbox is open to every Role, and its own limits hold it in. See [Sandbox design](#doc:arch-sandbox).

## MCP tokens

An MCP token names an Owner and a Staff member. A Guest's token is also checked against their Guest pass, so a revoked pass stops working at once. See [OAuth sign-in step by step](#doc:claude-oauth).

## Registered for purge

§harness.workspaces§ is the only Harness table in §access.owned_tables§. Everything else cascades from it.
`,
  ],
};
