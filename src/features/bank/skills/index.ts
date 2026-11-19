/**
 * The Teller's Skills: SKILL.md text loaded on demand with `load_skill`.
 * A Skill is know-how in words. It decides nothing: Rules and the command
 * engine do.
 */
export type Skill = {
  id: string;
  name: string;
  description: string;
  body: string;
};

const skill = (
  id: string,
  name: string,
  description: string,
  body: string,
): Skill => ({
  id,
  name,
  description,
  body: `---\nname: ${id}\ndescription: ${description}\n---\n\n# ${name}\n\n${body.trim()}\n`,
});

export const SKILLS: Skill[] = [
  skill(
    "disputes",
    "Handling a dispute",
    "Use when a customer does not recognise a transaction, was charged twice, or wants money back.",
    `
1. Find the transaction first. Call \`list_transactions\` for the account (give \`query\` with a word from the description, such as the merchant, to search instead of paging) and identify the one they mean by date, amount and description. Read back what you found and ask if it is unclear which.
2. Only money that left the account can be disputed. A dispute is opened on the journal entry id (\`entryId\`) of that transaction, with \`open_dispute\`. Pick the reason that fits: \`not_recognised\`, \`duplicate\`, \`wrong_amount\`, \`not_received\`, \`other\`.
3. A card purchase that is still only authorised (a hold, not yet settled) is not a transaction yet. Say so: the merchant may still cancel it, and \`reverse_card_purchase\` releases the hold if the merchant has.
4. If they do not recognise a card purchase at all, offer to freeze the card (\`set_card_status\` with \`frozen\`), which they can undo.
5. Opening a dispute does not refund anything. A supervisor or compliance resolves it (\`resolve_dispute\`); if upheld, the bank refunds the customer from its own losses account. Tell the customer what happens next, not a date you cannot know.
6. An internal transfer sent by mistake is not a dispute: a supervisor can reverse it (\`reverse_payment\`), and every reversal needs a second supervisor's Approval.
`,
  ),
  skill(
    "loan-what-ifs",
    "Loan what-ifs",
    "Use for questions like 'what if I overpay by 200 a month', 'how much could I borrow', 'when would it be paid off'.",
    `
The bank's own arithmetic (so your answer matches what the bank will do):
- Interest for a month = balance x yearly rate / 12, rounded half up to the cent. The rate is in basis points (890 = 8.90%).
- Each instalment pays that month's interest first, the rest reduces the principal.
- An overpayment (\`repay_loan\` with more than what is due) comes straight off the principal. The monthly payment stays the same and the term gets shorter. It never pays interest that has not been earned yet.

How to answer:
1. Read the loan with \`get_loan\`: outstanding, rateBps, monthlyPayment, the schedule.
2. For a what-if, simulate month by month in \`run_code\` (see the sandbox-analysis Skill): the same loop with payment + extra, counting months and total interest, against the schedule as it stands. Report months saved and interest saved.
3. "How much could I borrow" is decided by the affordability Rule, not by you. Read it with \`list_rules\` (lending.affordability, lending.pricing) and explain the caps: the multiple of income, repayments within a percentage of income, what must be left over. Only \`apply_for_loan\` gives a real decision.
4. Never promise an approval. Say what the Rules would test.
`,
  ),
  skill(
    "reading-a-statement",
    "Reading a statement",
    "Use when someone asks what a line on their statement is, why the balance is what it is, or wants a month summarised.",
    `
1. A statement is a frozen copy of one month of an account from the ledger: opening balance, every line, closing balance. Get it with \`list_statements\` then \`get_statement\`; if the month is missing, \`request_statement\` generates it (a Workflow builds it in a moment).
2. Lines read: date, description, money in, money out, balance. The description says what it was: "Card: <merchant>" a settled card purchase, "<Payee>: <reference>" a payment to another bank, "Returned: ..." a payment the other bank sent back, "Savings interest" interest paid at month end, "Loan L... instalment n" a repayment.
3. The balance on a statement is the posted balance. It does not show holds: an authorised card purchase or a payment under review lowers the available balance without a line. If "my balance is wrong" is really "my available balance is lower", read \`get_account\` and explain the holds.
4. A payment to another bank shows the day it left the account, not the day it settled; a fee is included in that line's amount and named in the payment.
5. To summarise a month, use \`spending_summary\` or the statement lines in \`run_code\`; quote totals to the cent.
`,
  ),
  skill(
    "sandbox-analysis",
    "Analysis in the Sandbox",
    "Use before run_code: where the data is, how to print a chart, what the Sandbox cannot do.",
    `
\`run_code\` runs one Node.js (ESM) script in a sandbox with no network. Give it \`customerId\` and the bank writes that customer's data first:

- \`data/customer.json\`: profile (no card numbers; cards carry lastFour only), accounts with balances, loans.
- \`data/transactions/<accountNumber>.json\`: up to 400 latest transactions: { date, kind, description, direction: "in" | "out", amount, balanceAfter }.
- \`data/loans/<loanNumber>.json\`: the loan with its decision and schedule.
- \`data/rules.json\`: the Rulebook (sentences and Parameters).

Amounts are minor units (cents). Divide by 100 only when printing.

Read with \`JSON.parse(fs.readFileSync("data/customer.json", "utf8"))\` (\`import fs from "node:fs"\`). Print what you found with console.log; keep output short (a few KB).

To show a chart, print ONE line starting with \`CHART:\` followed by JSON:
\`CHART:{"type":"bar","title":"Spending by month","unit":"MRF","labels":["Sep","Oct"],"series":[{"name":"Out","values":[1234.5,980]}]}\`
\`type\` is "bar" or "line"; values are plain numbers in florins, not cents. The app draws it.

The Sandbox has no credentials, no network and no way to change the bank. Code is analysis: to change anything, use the bank's tools.
`,
  ),
  skill(
    "growing-the-bank",
    "Growing the bank",
    "Use when the person asks for something the bank cannot do, or reports a bug: how to raise it well.",
    `
The bank grows itself. A request raised with \`raise_request\` is triaged by the Growth Rules, filed as a GitHub issue, built by a scheduled agent, reviewed and merged by the PR pipeline, then deployed. Nobody at the bank does anything by hand.

1. First make sure no tool does it already. Check your tool list before you say the bank cannot.
2. Ask one question if the request is vague ("which format?", "what did you expect to see?"). One, not five.
3. Call \`raise_request\` with: \`kind\` (feature or bug), a short \`title\` in plain words ("Export transactions as OFX"), \`want\`: the person's own words, quoted, and for a bug \`evidence\`: what they did, what happened, what they expected.
4. Small and concrete gets built. "Add savings goals with a target and a progress bar" is good. "Make the bank better" is not; help them narrow it.
5. Some things the bank may not change, and the Rule will refuse them: sign-in and access, secrets, CI, other demos. Say so plainly if it does.
6. Tell them where to follow it: the Growth tab shows Requested, Triaged, Issue, Pull request, Merged, Live. When it is live you will tell them in this conversation.
`,
  ),
];

export const skillById = (id: string) =>
  SKILLS.find(
    (item) => item.id === id || item.name.toLowerCase() === id.toLowerCase(),
  );
