# Staff and their Roles live inside each Owner's Workspace

The Harness needs RBAC (users and admins) and an Audit trail that says who acted. But ADR 0011 gives every visitor exactly one identity, the Owner, and keeps Owners from seeing each other. With one identity per Workspace there is nobody to separate and the "who" column would hold one name. Making the Host the only admin would be real RBAC that no Guest could ever see.

Each Owner's Workspace is seeded with named Staff (two `user` pensions officers and one `admin` operations manager). The visitor picks who they are signed in as; the choice is kept in a cookie that only remembers which of the Owner's own Staff is active, and is checked against the Owner on every request (ADR 0011's rule for cookies). `requireStaff()` in `src/features/harness/server/context.ts` returns the Owner and the Staff member; `can(staff, action)` in `domain/permissions.ts` is the one place Roles are decided, and every server function that writes calls it.

Approvals use the Roles: low risk needs any Staff member, high risk (payment instruction, rejection, regulator report) needs an admin who is not the Staff member that started the Run. The Agent has no Role and can approve nothing.

## Consequences

- RBAC here separates duties inside a Workspace. It is not a security boundary between visitors: Access and the Owner still are. Anyone in a Workspace can switch to its admin, by design, so every visitor can try both Roles.
- Because of that, "admin only" does not protect the Sandbox from a Guest. The Sandbox's own limits do (ADR 0017).
- Staff are rows, not Auth users, so nothing here touches the anonymous-user cleanup job.
