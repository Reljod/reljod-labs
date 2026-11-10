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
A Host's invitation to the demos: for a named person, until a set time, on a set number of devices. A Host can revoke it early.
_Avoid_: Invite, token, key

**Guest code**:
The twelve symbols that redeem a Guest pass, shown to the Host once and handed over by word of mouth. Only its hash is stored.
_Avoid_: Password, token, PIN

**Guest**:
A visitor who redeemed a Guest code: an anonymous Supabase Auth user bound to that Guest pass. An anonymous user with no live Guest pass has no Access.
_Avoid_: Anon, visitor, user

**Door**:
The page at `/access` where a visitor without Access lands, enters a Guest code or signs in.
_Avoid_: Login page, paywall
