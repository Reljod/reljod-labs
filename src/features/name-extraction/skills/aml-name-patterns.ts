/** Skill: where names hide in AML Documents, and what only looks like a name. */
export const amlNamePatterns = {
  title: "AML name patterns",
  description:
    "Where parties hide in AML files (SWIFT fields, signature blocks, registries, UBO chains) and the decoys that are not parties.",
  body: `# AML name patterns

## When to use
When planning code or grep patterns for a Document, when a Reader's focus line
needs to say what to look for, and when deciding whether a Candidate is a party.

## Where parties are named
- **SWIFT MT103 / MT202 fields**: \`50K:\` / \`50F:\` ordering customer (a name on the
  line after the account, e.g. \`/GB12MERI...\` then \`ANA FERREIRA-VOS\`), \`59:\` /
  \`59A:\` beneficiary customer, \`52A:\` ordering institution, \`56A:\` intermediary,
  \`57A:\` account with institution, \`70:\` remittance information (often names an
  invoice party or "ON BEHALF OF ..."), \`72:\` sender to receiver information.
  In \`50F\`, the name follows \`1/\` and the address \`2/\`, \`3/\`.
  BIC codes (8 or 11 letters, e.g. \`MERIMRMXXXX\`) are institutions; record the bank
  name only if the text names it.
- **Ledgers and statements**: "Counterparty", "Beneficiary", "Remitter", "Payee",
  "Narrative" and "Details" columns. Names are often upper case and truncated
  ("FERREIRA-VOS A L"), with initials after the surname.
- **Signature blocks**: "Signed by", "For and on behalf of", "Director", "Authorised
  signatory", "Witness", "Notary", "In the presence of". The person and the company
  they sign for are two Names.
- **Company registries and UBO chains**: "Registered office", "Shareholder",
  "Ultimate beneficial owner", "Nominee", "Trustee", "Settlor", "Protector",
  percentages ("holds 62% of"), and chains ("X Ltd, which is wholly owned by Y SA,
  in turn controlled by Z"). Every link is a party, nominee directors included.
- **KYC forms**: applicant, joint holder, introducer, power of attorney holder,
  PEP declarations (relatives and close associates are parties), source of funds
  narratives ("proceeds from the sale of shares in ...").
- **Judgments and reports**: the case caption ("Republic v. ..."), counsel,
  judges and registrars (officials: follow the Rulebook's \`includeOfficials\`),
  "also known as", "trading as", "formerly", "née".
- **Emails and handles**: \`a.ferreira@...\`, \`@anaferreira\`. Extract the person
  only if the Rulebook's \`includeHandles\` is on, and only when the handle clearly
  stands for a person or company.

## Decoys (not parties)
- Streets, buildings and places named after people ("Ferreira Avenue",
  "St Ana's Wharf"), ports, vessels' home ports.
- Products, funds' share classes and accounts named after a party ("Vos Growth
  Fund Class B" is the fund if a fund is a party; the share class is not).
- Laws, cases cited only as precedent, regulators acting as regulators (unless
  the Rulebook includes officials), the bank's own name when the Rulebook excludes it.
- Column headers, form labels and boilerplate ("Account Holder", "Beneficial
  Owner", "Name of Applicant").
- Upper-case words of a heading ("STRICTLY CONFIDENTIAL", "SPECIMEN").

## Pitfalls
- A name split across a line or a page break is one Name ("Ana Lucía" / "Ferreira-
  Vos"). Overlapping Reader ranges catch page breaks; code should join wrapped
  lines before matching.
- Truncated ledger names are aliases of the full name, not new parties.
- Same surname, different people (a father and daughter): two Names. Fold only on
  evidence (alias-resolution).
- Initials-only references ("A.L.F.-V.") are aliases when the text ties them to a
  full name; otherwise keep them as a low-confidence Name with a note.`,
};
