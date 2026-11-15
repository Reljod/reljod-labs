# Access

Who may open the demos. The demos call a paid model, so they open only to a Host or to a Guest on a live Guest pass. The landing and About pages need no Access.

## Language

**Access**:
The right to use the demos, held by a Host or by a Guest. Checked on every demo page, route and server action.
_Avoid_: Auth, permission, login

**Host**:
A Supabase Auth account, with a confirmed email on the Host list (`ACCESS_HOST_EMAILS`), that opens the demos without a code and issues Guest passes.
_Avoid_: Admin, owner, user

**Guest pass**:
A Host's invitation to the demos: for a named person, until a set time, on a set number of devices. A Host can extend it, renew it after it ended, give it a new Guest code, revoke it early, or delete it. Everything its Guests save belongs to it.
_Avoid_: Invite, token, key

**Owner**:
Who saved demo data belongs to: a Host, a Guest pass (shared by every device on it), or the e2e suite. Every saved row carries one, and every read is scoped to it.
_Avoid_: User, session, account

**Deleted pass**:
A Guest pass the Host deleted. Its Guests lose Access at once; the pass and what they saved are kept 30 days so the Host can restore it, then purged.
_Avoid_: Archived, removed

**Guest code**:
The twelve symbols that redeem a Guest pass, shown to the Host once and handed over by word of mouth. Only its hash is stored. A new code replaces the old one and signs out the devices on it; the data stays with the pass.
_Avoid_: Password, token, PIN

**Guest**:
A visitor who redeemed a Guest code: an anonymous Supabase Auth user bound to that Guest pass. An anonymous user with no live Guest pass has no Access.
_Avoid_: Anon, visitor, user

**Profile settings**:
The page at `/access/profile` where a Host edits their name and password and opens guest access.
_Avoid_: Account page, dashboard

**Door**:
The page at `/access` where a visitor without Access lands, enters a Guest code or signs in.
_Avoid_: Login page, paywall

**Audience**:
Which group a browser falls in for Web Analytics: host, guest or visitor (not signed in). Read from the profile hint cookie, so it groups traffic and grants nothing.
_Avoid_: Segment, cohort, role
