# Joins are Ledger's only words on the answer page

Amends ADR 0006. A Reform used to lay the placed Content blocks out as a grid of cards, which showed what Ledger found but not how the pieces answer the question. Now the blocks line up in answer order as one sentence, and each fetch step in the Build plan carries a Join: the few linking words the model writes before that piece, such as "Reljod is now" [job] "after" [job] "and before that" [job]. Every piece is still cut word for word from the site and is shown in full beneath the sentence with the section it came from. Joins are the first model words on the answer page, so code keeps them to linking words: a Join with a digit in it, or over 60 characters, is dropped, and a toss never has one. Joins are drawn in muted italics, apart from the blocks, so a reader can tell Ledger's words from the site's. We chose this over a sentence the model writes freely with the pieces cited inside it, which would put unchecked facts in the headline, and over fixed list words ("," and "and") alone, which cannot make most answers read as a sentence.

## Consequences

- A Join can still be wrong in tone or grammar, but it cannot add a number, and the instructions forbid facts in it. Like the chat answer, it is only as grounded as the instructions make it.
- Builds stored before Joins existed read back with empty Joins, and an empty Join falls back to list words ("," between pieces, "and" before the last), so old sessions still read as one sentence.
- Stubbed e2e plans carry hand-written Joins, so the stubbed suite shows the same sentence as a live Build.
