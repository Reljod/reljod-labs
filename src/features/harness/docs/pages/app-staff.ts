import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "app-staff",
  section: "using",
  title: "Staff switcher",
  summary: "Choose who you act as inside your Workspace.",
  body: [
    md`
The Staff switcher is at the right of the bar across the top, the same bar every demo on this site opens with. It shows who you are signed in as (their initials, and their name on a wide screen) and their Role. On a phone the initials alone stand for the Role: filled ink is an admin.

## Switching

Choose another Staff member. The app reloads what is on screen as them. Your choice is remembered in a cookie that only says which of your own Staff is active. The server checks it against your Workspace on every request.

## Why you may switch to the admin

So that every visitor can try both Roles. A user works cases. An admin edits Skills and Rules, settles Conflicts, approves high-risk Approvals, uses the Sandbox and reads the whole Audit trail. See [Workspace, Staff and Roles](#doc:workspace-staff-roles).

## What switching does not change

- A Claude connection you already made keeps the Staff member it was signed in as. Switching in the app does not change a token already issued. See [OAuth sign-in step by step](#doc:claude-oauth).
- A Session belongs to the Staff member who opened it. After a switch, the open Session may not be yours, and the app moves you on.
- Every switch is an Audit event.

## Four-eyes

To approve a high-risk Run you started, switch to the admin. The admin did not start the Run, so the rule is met. If the admin started the Run, no one else could approve it, because the seed Workspace has one admin. Start Runs as an officer.
`,
  ],
};
