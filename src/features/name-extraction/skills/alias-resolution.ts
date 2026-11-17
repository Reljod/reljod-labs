/** Skill: fold the forms of one party into one Name, and keep different parties apart. */
export const aliasResolution = {
  title: "Alias resolution",
  description:
    "Cluster the Register's forms of one party in code (folding, token sets, initials, Jaro-Winkler), then merge with record_names; ask only about ambiguous clusters.",
  body: `# Alias resolution

## When to use
After the Readers return and before the recall audit, when the Register has
several forms of the same party ("Ana Lucía Ferreira-Vos", "FERREIRA-VOS A L",
"Ms Ferreira-Vos", "A. Ferreira"). Only when the Rulebook's \`resolveAliases\` is on;
when it is off, record each form as its own Name.

## Steps
1. Cluster in code, not in your head. \`run_code\` reads \`/vercel/doc/register.json\`
   and uses the helpers in \`/vercel/doc/sieve.mjs\`:
   - \`fold(s)\`: lower case, diacritics removed, punctuation and honorifics dropped.
   - \`tokenSet(a, b)\`: same tokens in any order ("Bank of Meridia" vs "Meridia Bank").
   - \`initialsMatch(a, b)\`: "A L Ferreira-Vos" against "Ana Lucía Ferreira-Vos".
   - \`jaroWinkler(a, b)\`: 0..1, with the OFAC-style prefix bonus; 0.92 and above is
     a strong signal, 0.85 to 0.92 needs evidence.
2. Print the clusters with their pages and roles, e.g.
   \`[["Ana Lucía Ferreira-Vos","FERREIRA-VOS A L","Ms Ferreira-Vos"], ...]\`.
3. Decide each cluster:
   - **Fold** when the forms share a surname and compatible given names or initials,
     and nothing in the text separates them (same account, same role, same address,
     "also known as", "trading as", "formerly").
   - **Keep apart** when the text gives different given names, dates of birth,
     generations (Sr/Jr), different companies with the same stem ("Vos Holdings Ltd"
     and "Vos Holdings (Meridia) SA" are two companies), or two roles that cannot be
     one person (the payer and the payee of the same wire).
   - **Unsure**: keep apart, and say why in the note. Recall first: a wrong merge can
     hide a party from screening; a missed merge costs one look.
4. Merge with \`record_names\`:
   \`merge: [{ into: "Ana Lucía Ferreira-Vos", from: ["FERREIRA-VOS A L", "Ms Ferreira-Vos"] }]\`.
   The canonical is the fullest form. Every other form stays as an alias, never
   dropped: screening downstream matches on every form.
5. Organizations: fold legal-suffix variants ("Ltd", "Limited", "Ltd."), "The",
   and "&" vs "and". Keep a different legal form or jurisdiction apart.
6. Transliterations ("Mohammed", "Muhammad", "Mohamed"; "Aleksandr", "Alexander"):
   fold only with supporting evidence (same account, same address, the text says so).

## Pitfalls
- Folding on surname alone. Family members share surnames.
- Dropping an alias because it looks ugly ("FERREIRA-VOS A L"): keep it.
- Merging a person into the company they direct.
- Merging before all Readers are back: do it once, near the end, then re-check.`,
};
