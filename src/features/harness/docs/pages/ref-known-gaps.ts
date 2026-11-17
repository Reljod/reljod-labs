import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "ref-known-gaps",
  section: "reference",
  title: "Known gaps",
  summary:
    "Things a review found that are deliberately not fixed yet, and what we expect to do.",
  body: [
    md`
This is a demo, and these are its known weaknesses. The full list, with the proposed fix for each, is §docs/engineering/harness-known-gaps.md§ in the repository. An entry is removed when its fix lands.

## Uploaded files outlive the Owner purge

When a Guest pass is deleted, the Owner's rows are purged 30 days later. A Source's row goes, but the file it points to stays in the private §harness§ bucket. Removing one Source in the app does delete its file. Only the purge path leaves files behind. The Client Manager's bucket has the same gap. The expected fix is a daily clean-up route that removes files whose Owner no longer has a Workspace, through the Storage API.

## Owner is not part of the foreign keys

Child tables carry §owner§ and reference their parent by id alone, so the schema does not stop a row whose Owner differs from its parent's. Every write path takes the parent from an Owner-scoped read, so no such row is written today. The gap is latent. The expected fix is a composite key (owner and id) on each parent and composite references in each child, as one change of its own.

## OAuth codes and tokens

Authorization codes, access tokens and refresh tokens are signed and keep no state on the server. A code can be redeemed more than once within its two-minute life, and one token cannot be revoked on its own. A token ends at its expiry, when the Guest pass behind it ends, or for everyone when §RATE_LIMIT_SALT§ is rotated. The exposure is small: redeeming a code needs its PKCE verifier, and a token acts only inside its Owner's Workspace. The expected fix is a table of grants with a used and a revoked time, and a Disconnect action on the Connect page.

## Other limits to know

The Sandbox runs code from any visitor (see [Sandbox and Runner](#doc:arch-sandbox)), and the Rules illustrate the Act and are not legal advice (see [The rules reference and its limits](#doc:rules-reference)).
`,
  ],
};
