/**
 * Page layouts per genre of AML file. Each genre prints names through
 * PageBuilder.name, so every printed name lands in the Answer key, and fills
 * the rest of the page with name-free text and decoys.
 */

import type { EntityType } from "../contract";
import type { PageBuilder, Slot } from "./page";
import type { OfficialKind, Style } from "./parties";

export type Block = {
  max: number;
  /** The entity type each position needs; positions past the list take any. */
  wants?: EntityType[];
  render(pb: PageBuilder, slots: Slot[]): void;
};

export type Genre = {
  key: string;
  label: string;
  header(pb: PageBuilder, holder?: Slot): void;
  /** Who is printed in every page header, if anyone. */
  holder?: "person" | "organization";
  blocks: Block[];
  officials: OfficialKind[];
  official(pb: PageBuilder, slot: Slot): void;
  fillers: ((pb: PageBuilder) => void)[];
  /** Sentence around a name split across a page break; narrative genres only. */
  split?: (pb: PageBuilder) => [string, string];
};

const NARRATIVE: Style[] = [
  "full",
  "short",
  "initials",
  "initialShort",
  "honorific",
  "honSurname",
  "translit",
  "typo",
  "native",
  "alt",
  "orgShort",
];
const TABLE: Style[] = [
  "full",
  "reordered",
  "reorderedShort",
  "caps",
  "initials",
  "native",
  "alt",
  "lower",
  "typo",
];
const FIELD: Style[] = [
  "full",
  "caps",
  "reordered",
  "honorific",
  "translit",
  "native",
  "lower",
];
const SWIFT: Style[] = ["swift", "swiftReversed"];

/** Fills "{0}", "{1}"... with names and "{d}", "{a}", "{p}", "{v}" with filler. */
function fill(
  pb: PageBuilder,
  template: string,
  slots: Slot[],
  styles: Style[],
): string {
  return template.replace(/\{(\w)\}/g, (_, key: string) => {
    if (/\d/.test(key)) return pb.name(slots[Number(key)], styles);
    if (key === "d") return pb.date(pb.rng.int(0, 3));
    if (key === "a") return pb.amount();
    if (key === "p") return pb.place();
    if (key === "v") return pb.vessel();
    if (key === "s") return pb.address();
    if (key === "t") return pb.jobTitle();
    if (key === "r") return pb.product();
    return key;
  });
}

const arity = (template: string) =>
  new Set(template.match(/\{\d\}/g) ?? []).size;

/** A narrative block: one sentence per name group, wrapped as a paragraph. */
function narrative(
  templates: string[],
  styles: Style[] = NARRATIVE,
  numbered = false,
): Block {
  return {
    max: 4,
    render(pb, slots) {
      const sentences: string[] = [];
      let rest = slots;
      while (rest.length > 0) {
        const fits = templates.filter((t) => arity(t) <= rest.length);
        const template = pb.rng.pick(fits);
        const n = arity(template);
        sentences.push(fill(pb, template, rest.slice(0, n), styles));
        rest = rest.slice(n);
      }
      const text = sentences.join(" ");
      if (numbered) {
        pb.doc.serial += 1;
        pb.para(`${(pb.doc.serial % 180) + 1}. ${text}`);
      } else pb.para(text);
      pb.line();
    },
  };
}

function prose(pb: PageBuilder, templates: string[], count = 1) {
  const sentences = pb.rng
    .shuffle([...templates])
    .slice(0, count)
    .map((t) => fill(pb, t, [], []));
  pb.para(sentences.join(" "));
  pb.line();
}

function specimen(pb: PageBuilder, left: string) {
  pb.line(left);
  pb.line(
    "SPECIMEN - synthetic document - Republic of Meridia - not a real record",
  );
  pb.line();
}

// Shared filler ---------------------------------------------------------------------

const TERMS = [
  "Interest is calculated daily on the cleared balance and applied on the last business day of each month.",
  "Charges are set out in the tariff available at any branch in {p} and on request from the service centre.",
  "Cheques paid in are subject to clearance and may be returned unpaid up to six business days after the value date.",
  "Customers must notify the bank of any unauthorised transaction without undue delay and in any case within thirteen months.",
  "Foreign currency amounts are converted at the bank's reference rate on the day the payment is processed.",
  "This statement should be retained for tax purposes; duplicate statements carry a fee of M$ 15.00 per page.",
  "Deposits are protected by the Meridian Deposit Guarantee Scheme up to M$ 100,000 per depositor.",
  "Payments received after the cut-off time of 15:30 are processed on the next business day.",
];

const POLICY = [
  "The relationship was reviewed under the enhanced due diligence standard because of the jurisdictions involved.",
  "Source of wealth evidence must be refreshed at least every twelve months for customers rated high risk.",
  "Where a document is not in English, a certified translation must be placed on file before the account is used.",
  "Transactions that do not match the expected activity profile are referred to the second line for review.",
  "The analyst considered the frequency, value and direction of payments against the customer's declared business.",
  "Records are retained for seven years after the end of the relationship in line with the Proceeds of Crime Act.",
  "Screening is repeated whenever the consolidated list is updated and on every change of customer details.",
  "No adverse media was identified in the searches carried out on {d}, save as noted in the summary.",
];

function txFiller(pb: PageBuilder) {
  const descriptions = [
    () => `POS ${pb.product().toUpperCase()}`,
    () => `ATM WDL ${pb.place().toUpperCase()}`,
    () => "MONTHLY ACCOUNT FEE",
    () => "FX SETTLEMENT MRD/USD",
    () => "INTEREST CREDIT",
    () => `SO RENT ${pb.street().toUpperCase()}`,
    () => "NOSTRO SWEEP",
    () => `CARD REFUND ${pb.product().toUpperCase()}`,
    () => "CASH DEPOSIT BRANCH 041",
  ];
  const rows: string[][] = [];
  const n = pb.rng.int(4, 9);
  for (let i = 0; i < n; i++) {
    const credit = pb.rng.chance(0.4);
    rows.push([
      pb.date(pb.rng.int(0, 1)),
      pb.rng.pick(descriptions)(),
      credit ? "" : pb.amount(5, 9000),
      credit ? pb.amount(5, 9000) : "",
      pb.amount(1000, 900000),
    ]);
  }
  pb.table(["Date", "Description", "Debit", "Credit", "Balance"], rows);
  pb.line();
}

// Genres ---------------------------------------------------------------------------------

const wire: Genre = {
  key: "wire",
  label: "Wire transfer ledger",
  header(pb) {
    pb.line("MERIDIA CENTRAL BANK - PAYMENTS OPERATIONS");
    specimen(pb, `SWIFT MT103 ledger - ${pb.doc.title}`);
  },
  officials: [],
  official(pb, slot) {
    pb.para(
      `Referred to ${pb.name(slot, ["honorific", "full"])} under production order PO-${pb.rng.int(100, 999)}.`,
    );
  },
  blocks: [
    {
      max: 2,
      render(pb, [ordering, beneficiary]) {
        pb.line(
          `{1:F01MCBKMRPSAXXX${pb.rng.int(1000, 9999)}${pb.rng.int(100000, 999999)}}{2:I103${pb.bic()}N}`,
        );
        pb.line(`:20:${pb.ref("TRF")}`);
        pb.line(":23B:CRED");
        pb.line(
          `:32A:${pb.swiftDate()}MRD${pb.amount().replace(/,/g, "").replace(".", ",")}`,
        );
        pb.line(`:50K:/${pb.account()}`);
        pb.line(pb.name(ordering, SWIFT));
        pb.line(pb.address().toUpperCase());
        pb.line(`:52A:${pb.bic()}`);
        if (beneficiary) {
          pb.line(`:59:/${pb.account()}`);
          pb.line(pb.name(beneficiary, SWIFT));
          pb.line(pb.address().toUpperCase());
        } else {
          pb.line(`:59A:/${pb.account()}`);
          pb.line(pb.bic());
        }
        pb.line(
          `:70:INV ${pb.rng.int(1000, 9999)} FREIGHT ${pb.vessel().toUpperCase()}`,
        );
        pb.line(`:71A:${pb.rng.pick(["SHA", "OUR", "BEN"])}`);
        pb.line("-}");
        pb.line();
      },
    },
    {
      max: 4,
      render(pb, slots) {
        const rows = slots.map((slot) => {
          const left = pb.rng.chance(0.5);
          const name = pb.name(slot, [
            "swift",
            "caps",
            "full",
            "reorderedShort",
            "typo",
            "lower",
          ]);
          return [
            pb.date(1),
            pb.ref("TRF"),
            left ? name : "own account",
            left ? pb.bic() : name,
            pb.amount(),
          ];
        });
        pb.table(
          [
            "Value date",
            "Reference",
            "Ordering customer",
            "Beneficiary",
            "Amount M$",
          ],
          rows,
        );
        pb.line();
      },
    },
    narrative([
      "Screening note: {0} screened against the consolidated list on {d}; no true match recorded.",
      "Payment returned by the beneficiary bank on {d}: account name did not match {0}.",
      "Recall request received for the transfer to {0}; the ordering customer {1} cited a duplicate payment.",
    ]),
  ],
  fillers: [
    txFiller,
    (pb) => prose(pb, TERMS, 3),
    (pb) => {
      pb.line(
        `:20:${pb.ref("MT950")}  :25:${pb.account()}  :28C:${pb.rng.int(1, 300)}/1`,
      );
      for (let i = 0; i < pb.rng.int(6, 10); i++)
        pb.line(
          `:61:${pb.swiftDate()}${pb.rng.pick(["C", "D"])}${pb.amount().replace(/,/g, "")}NTRF${pb.ref("REF")}//${pb.ref("BK")}`,
        );
      pb.line();
    },
  ],
};

const statement: Genre = {
  key: "statement",
  label: "Bank statement",
  holder: "organization",
  header(pb, holder) {
    pb.line(
      `MERIDIA CENTRAL BANK - STATEMENT OF ACCOUNT - ${pb.once("product", () => pb.product())}`,
    );
    if (holder)
      pb.line(
        `Account holder: ${pb.name(holder, ["full"])}   Account no. MR12 MCBK 0045 2290 18`,
      );
    specimen(
      pb,
      `Branch: ${pb.once("branch", () => pb.place())}  Period ending ${pb.date()}`,
    );
  },
  officials: [],
  official(pb, slot) {
    pb.para(
      `Statement produced to ${pb.name(slot, ["honorific"])} on ${pb.date()}.`,
    );
  },
  blocks: [
    {
      max: 5,
      render(pb, slots) {
        const rows: string[][] = [];
        for (const slot of slots) {
          rows.push([
            pb.date(pb.rng.int(0, 1)),
            "CASH DEPOSIT BRANCH 041",
            "",
            pb.amount(50, 5000),
            pb.amount(1000, 900000),
          ]);
          const verb = pb.rng.pick([
            "TRF TO",
            "TRF FROM",
            `CHQ 00${pb.rng.int(1000, 9999)}`,
            "SO",
          ]);
          const debit = verb !== "TRF FROM";
          rows.push([
            pb.date(),
            `${verb} ${pb.name(slot, ["swift", "caps", "reorderedShort", "full", "typo", "lower", "swiftReversed"])}`,
            debit ? pb.amount(50, 90000) : "",
            debit ? "" : pb.amount(50, 90000),
            pb.amount(1000, 900000),
          ]);
        }
        pb.table(["Date", "Description", "Debit", "Credit", "Balance"], rows);
        pb.line();
      },
    },
    narrative([
      "Branch note: {0} called on {d} to ask why the transfer to {1} had been held.",
      "Mandate change: {0} added as an authorised signatory on {d}.",
      "Returned item: cheque payable to {0} presented on {d} with an altered amount.",
    ]),
  ],
  fillers: [txFiller, txFiller, (pb) => prose(pb, TERMS, 4)],
};

const kyc: Genre = {
  key: "kyc",
  label: "KYC file",
  holder: "person",
  header(pb, holder) {
    pb.line("MERIDIA CENTRAL BANK - CUSTOMER DUE DILIGENCE FILE");
    if (holder)
      pb.line(`Customer: ${pb.name(holder, ["full"])}   CIF 0041-2290`);
    specimen(pb, `Prepared ${pb.date()} - Restricted`);
  },
  officials: ["notary"],
  official(pb, slot) {
    pb.para(
      `Certified a true copy of the original passport on ${pb.date()} by ${pb.name(slot, ["honorific", "full"])}, ${pb.place()}.`,
    );
    pb.line();
  },
  blocks: [
    {
      max: 1,
      wants: ["person"],
      render(pb, [slot]) {
        pb.line("CUSTOMER PROFILE");
        pb.line(`Full name:            ${pb.name(slot, FIELD)}`);
        if (pb.rng.chance(0.5))
          pb.line(
            `Also known as:        ${pb.name(slot, ["nickname", "translit", "initials", "short", "native"])}`,
          );
        pb.line(
          `Date of birth:        ${pb.rng.int(1, 28)}/${pb.rng.int(1, 12)}/${pb.rng.int(1950, 2000)}`,
        );
        pb.line(`Residential address:  ${pb.address()}`);
        pb.line(`Occupation:           ${pb.jobTitle()}`);
        pb.line(
          `Source of funds:      ${pb.rng.pick(["salary", "sale of property", "dividends", "inheritance"])}`,
        );
        pb.line();
      },
    },
    {
      max: 4,
      render(pb, slots) {
        pb.line("RELATED PARTIES");
        pb.table(
          ["Name", "Relationship", "ID verified"],
          slots.map((slot) => [
            pb.name(slot, TABLE),
            pb.rng.pick([
              "spouse",
              "co-signatory",
              "employer",
              "beneficial owner",
              "introducer",
              "power of attorney",
            ]),
            pb.rng.pick(["yes", "pending", "no"]),
          ]),
        );
        pb.line();
      },
    },
    {
      max: 2,
      wants: ["person", "organization"],
      render(pb, [a, b]) {
        pb.line(`Introduced by:        ${pb.name(a, FIELD)}`);
        if (b)
          pb.line(
            `c/o ${pb.name(b, ["full", "caps", "alt"])}, ${pb.address()}`,
          );
        pb.line();
      },
    },
    narrative([
      "The customer states that the funds originate from the sale of a property in {p} to {0}.",
      "{0} acts under a power of attorney granted on {d} and registered in {p}.",
      "Screening returned a partial match for {0} against the consolidated list; discounted on date of birth.",
      "The customer's employer, {0}, confirmed the salary in a letter dated {d}.",
    ]),
    {
      max: 1,
      wants: ["person"],
      render(pb, [slot]) {
        pb.line("Signed: ______________________");
        pb.line(`Name:   ${pb.name(slot, ["full", "initials", "caps"])}`);
        pb.line(`Date:   ${pb.date()}`);
        pb.line();
      },
    },
  ],
  fillers: [
    (pb) => prose(pb, POLICY, 4),
    (pb) => {
      pb.line("DOCUMENT CHECKLIST");
      pb.table(
        ["Document", "Received", "Checked by"],
        [
          "Passport",
          "Proof of address",
          "Bank reference",
          "Source of wealth letter",
          "Tax residency form",
        ].map((d) => [
          d,
          pb.date(),
          pb.rng.pick(["onboarding team", "branch 041", "second line"]),
        ]),
      );
      pb.line();
    },
    (pb) => {
      pb.line("RISK SCORING");
      pb.table(
        ["Factor", "Score", "Comment"],
        [
          "Geography",
          "Product",
          "Channel",
          "Occupation",
          "Expected activity",
        ].map((f) => [
          f,
          String(pb.rng.int(1, 5)),
          pb.rng.pick(["within appetite", "elevated", "see note", "standard"]),
        ]),
      );
      pb.line();
    },
  ],
};

const registry: Genre = {
  key: "registry",
  label: "Corporate registry extract",
  header(pb) {
    pb.line("COMPANIES REGISTRY OF MERIDIA - CERTIFIED EXTRACT");
    specimen(
      pb,
      `Extract no. ${pb.rng.int(10000, 99999)} - issued at ${pb.once("registry", () => pb.place())}`,
    );
  },
  officials: ["registrar"],
  official(pb, slot) {
    pb.line(
      `Extract issued under the seal of the registry by ${pb.name(slot, ["honorific", "full", "honSurname"])}.`,
    );
    pb.line();
  },
  blocks: [
    {
      max: 1,
      wants: ["organization"],
      render(pb, [slot]) {
        pb.line(
          `Company name:       ${pb.name(slot, ["full", "caps", "alt"])}`,
        );
        pb.line(`Registration no.:   MC-${pb.rng.int(100000, 999999)}`);
        pb.line(`Registered office:  ${pb.address()}`);
        pb.line(`Incorporated:       ${pb.date()}`);
        pb.line();
      },
    },
    {
      max: 4,
      render(pb, slots) {
        pb.line("DIRECTORS");
        pb.table(
          ["Name", "Appointed", "Nationality", "Service address"],
          slots.map((slot) => [
            pb.name(slot, TABLE),
            pb.date(),
            pb.rng.pick(["Meridian", "Lusitanian", "Nordmark", "Aurelian"]),
            pb.address(),
          ]),
        );
        pb.line();
      },
    },
    {
      max: 3,
      render(pb, slots) {
        pb.line("SHAREHOLDERS");
        pb.table(
          ["Holder", "Class", "Shares", "%"],
          slots.map((slot) => [
            pb.name(slot, TABLE),
            pb.rng.pick(["Ordinary", "Preference", "A Ordinary"]),
            String(pb.rng.int(1, 100000)),
            `${pb.rng.int(1, 100)}`,
          ]),
        );
        pb.line();
      },
    },
    narrative([
      "{0} is wholly owned by {1}, which is in turn controlled by {2}.",
      "{0} holds its shares as nominee for {1} under a declaration of trust dated {d}.",
      "Ultimate beneficial owner declared: {0} (indirect, through {1}).",
      "{0} resigned as director on {d}.",
    ]),
  ],
  fillers: [
    (pb) => {
      pb.line("FILING HISTORY");
      pb.table(
        ["Date", "Form", "Description"],
        Array.from({ length: pb.rng.int(5, 9) }, () => [
          pb.date(pb.rng.int(5, 40)),
          `RC${pb.rng.int(1, 30)}`,
          pb.rng.pick([
            "Annual return",
            "Change of registered office",
            "Allotment of shares",
            "Accounts filed",
            "Charge registered",
            "Change of auditor",
          ]),
        ]),
      );
      pb.line();
    },
    (pb) =>
      prose(
        pb,
        [
          "The liability of the members is limited by shares.",
          "The objects of the company are unrestricted.",
          "Any director may sign on behalf of the company together with the company secretary.",
          "This extract reflects the register as at the close of business on {d}.",
          "Charges registered against the company are listed in Part 4 of this extract.",
          "Annual returns must be delivered within 28 days of the anniversary of incorporation.",
        ],
        4,
      ),
  ],
};

const judgment: Genre = {
  key: "judgment",
  label: "Court judgment",
  header(pb) {
    pb.line("IN THE HIGH COURT AT PORT SELENE - COMMERCIAL DIVISION");
    pb.decoy("Port Selene");
    specimen(
      pb,
      `Claim no. HC-2026-${pb.rng.int(100, 999)} - Approved judgment`,
    );
  },
  officials: ["judge"],
  official(pb, slot) {
    pb.line(`Before: ${pb.name(slot, ["honorific"])}`);
    pb.line();
    pb.para(
      `${pb.name(slot, ["honSurname", "honorific"])} handed down this judgment remotely on ${pb.date()}.`,
    );
    pb.line();
  },
  blocks: [
    {
      max: 2,
      render(pb, [a, b]) {
        pb.line("BETWEEN:");
        pb.line(`    ${pb.name(a, ["caps", "full"])}                Claimant`);
        if (b) {
          pb.line("    - and -");
          pb.line(
            `    ${pb.name(b, ["caps", "full"])}                Defendant`,
          );
        }
        pb.line();
      },
    },
    narrative(
      [
        "The claimant's case is that {0} acted as nominee for the true owner of the funds.",
        "I accept the evidence of {0}, who gave a clear account of the transfers made on {d}.",
        "Counsel for {0} submitted that the payments to {1} were genuine trade settlements.",
        "It is common ground that {0} was a director of {1} at the material time.",
        "{0} did not attend the hearing and was not represented.",
        "The bank statements show that {0} paid M$ {a} to {1} and a further sum to {2} on the same day.",
      ],
      NARRATIVE,
      true,
    ),
  ],
  fillers: [
    (pb) =>
      prose(
        pb,
        [
          "The burden of proof rests on the claimant on the balance of probabilities.",
          "Section 14 of the Proceeds of Crime Act requires the court to consider whether the property is criminal property.",
          "Dishonesty is to be judged by the standards of ordinary decent people.",
          "The documents disclosed by the bank were not challenged.",
          "I turn to the question of tracing through the mixed accounts.",
          "The court has had regard to the overriding objective and to proportionality.",
          "Costs follow the event unless there is a good reason to depart from that rule.",
        ],
        5,
      ),
  ],
  split: (pb) => [
    `${(pb.doc.serial % 180) + 1}. The tracing exercise follows the money from the operating account to`,
    "and from there to the accounts identified in the schedule to this judgment.",
  ],
};

const sar: Genre = {
  key: "sar",
  label: "SAR narrative",
  header(pb) {
    pb.line("SUSPICIOUS ACTIVITY REPORT - INTERNAL - MLRO REVIEW");
    specimen(
      pb,
      `Ref ${pb.ref("SAR")} - Meridia Central Bank Financial Crime Unit`,
    );
  },
  officials: ["police"],
  official(pb, slot) {
    pb.para(
      `Consent request discussed by telephone with ${pb.name(slot, ["honorific", "honSurname"])} of the economic crime unit on ${pb.date()}.`,
    );
    pb.line();
  },
  blocks: [
    {
      max: 1,
      render(pb, [slot]) {
        pb.line(`Subject ${pb.rng.int(1, 9)}`);
        pb.line(`Name:            ${pb.name(slot, FIELD)}`);
        if (pb.rng.chance(0.5))
          pb.line(
            `Also known as:   ${pb.name(slot, ["nickname", "translit", "initials", "native", "alt"])}`,
          );
        pb.line(
          `Role:            ${pb.rng.pick(["account holder", "counterparty", "beneficial owner", "signatory"])}`,
        );
        pb.line();
      },
    },
    narrative([
      "On {d}, {0} instructed an outgoing transfer of M$ {a} to an account held at a correspondent in {p}.",
      "Branch staff report that {0} appeared anxious and asked whether transfers below M$ 10,000 are reported.",
      "Open-source checks link {0} to a dormant trading company registered at {s}.",
      "{0} received M$ {a} from {1} in nine transfers, each just below the reporting threshold.",
      "Funds were layered through {0} before reaching {1}, which holds no operating licence in Meridia.",
      "{0} and {1} share a residential address at {s}.",
      "The onward payments went to {0}, {1} and {2} within 48 hours of receipt.",
    ]),
    {
      max: 3,
      render(pb, slots) {
        pb.table(
          ["Date", "From", "To", "Amount M$"],
          slots.map((slot) => {
            const name = pb.name(slot, [
              "swift",
              "caps",
              "full",
              "reorderedShort",
              "lower",
            ]);
            return pb.rng.chance(0.5)
              ? [pb.date(), name, "subject account", pb.amount()]
              : [pb.date(), "subject account", name, pb.amount()];
          }),
        );
        pb.line();
      },
    },
    {
      max: 1,
      wants: ["person"],
      render(pb, [slot]) {
        pb.line(
          `Prepared by: ${pb.name(slot, ["full", "initials"])}, ${pb.jobTitle()}`,
        );
        pb.line();
      },
    },
  ],
  fillers: [
    (pb) => prose(pb, POLICY, 4),
    txFiller,
    (pb) =>
      prose(
        pb,
        [
          "The pattern is consistent with structuring to avoid the cash reporting threshold.",
          "Turnover on the account exceeded the declared annual income within the first quarter.",
          "The account received round-sum credits from several unrelated remitters.",
          "Cash was withdrawn at ATMs in {p} shortly after each credit.",
          "The stated purpose of the payments, consultancy services, is not supported by invoices.",
        ],
        4,
      ),
  ],
  split: () => [
    "Further analysis of the beneficiary accounts shows repeated round-sum credits ordered by",
    "through accounts opened within a week of each other.",
  ],
};

const comms: Genre = {
  key: "comms",
  label: "Email and chat export",
  header(pb) {
    pb.line("eDISCOVERY EXPORT - MAILBOX AND CHAT REVIEW SET");
    specimen(pb, `Custodian set ${pb.rng.int(1, 40)} - produced ${pb.date()}`);
  },
  officials: [],
  official(pb, slot) {
    pb.para(
      `Forwarded to ${pb.name(slot, ["honorific"])} under the production order.`,
    );
  },
  blocks: [
    {
      max: 3,
      render(pb, [from, to, cc]) {
        const people = (slot: Slot) =>
          slot.party.type === "person"
            ? `${pb.name(slot, ["full", "translit", "short", "native"])} <${pb.email(slot)}>`
            : `${pb.name(slot, ["full", "alt"])} <${pb.email(slot)}>`;
        pb.line(`From:    ${people(from)}`);
        if (to) pb.line(`To:      ${people(to)}`);
        if (cc) pb.line(`Cc:      ${people(cc)}`);
        pb.line(
          `Date:    ${pb.date(1)} ${pb.rng.int(7, 21)}:${String(pb.rng.int(0, 59)).padStart(2, "0")}`,
        );
        pb.line(`Subject: RE: cargo on ${pb.vessel()} - payment schedule`);
        pb.line();
      },
    },
    narrative(
      [
        "Hi all, {0} confirmed the cargo is loaded on the {v} and wants the balance today.",
        "Can you send the invoice to {0} before Friday? Use the old account details.",
        "Spoke to {0} this morning, they want the payment split across two accounts again.",
        "{0} says {1} will cover the freight; please do not copy compliance on this.",
        "Please ask {0} to sign the side letter, the bank keeps asking about it.",
      ],
      [
        "full",
        "nickname",
        "short",
        "honSurname",
        "translit",
        "orgShort",
        "alt",
        "typo",
      ],
    ),
    {
      max: 3,
      render(pb, slots) {
        for (const slot of slots) {
          const time = `[${pb.rng.int(7, 22)}:${String(pb.rng.int(0, 59)).padStart(2, "0")}]`;
          if (slot.party.type === "person")
            pb.line(
              `${time} ${pb.name(slot, ["nickname", "full", "short"])}: ${pb.rng.pick(["ok sending now", "call me", "bank flagged it again", "use the other account", "done, check the portal"])}`,
            );
          else
            pb.line(
              `${time} desk: did ${pb.name(slot, ["orgShort", "full", "caps"])} pay yet?`,
            );
        }
        pb.line();
      },
    },
    {
      max: 2,
      wants: ["person", "organization"],
      render(pb, [person, org]) {
        pb.line("Regards,");
        pb.line(pb.name(person, ["full", "initials"]));
        pb.line(
          org
            ? `${pb.jobTitle()} | ${pb.name(org, ["full", "alt"])}`
            : pb.jobTitle(),
        );
        pb.line();
      },
    },
  ],
  fillers: [
    (pb) =>
      prose(
        pb,
        [
          "This email and any attachments are confidential and intended only for the addressee.",
          "If you have received this message in error, please delete it and notify the sender.",
          "Emails are monitored for compliance and security purposes.",
        ],
        3,
      ),
    (pb) => {
      const quoted = pb.rng.shuffle([
        "> Please confirm the revised schedule before the vessel sails.",
        "> The port agent needs the documents by noon.",
        `> Weather at ${pb.place()} may delay loading by two days.`,
        "> Invoice attached, same terms as last time.",
        "> Can you check the container count against the packing list?",
        "> Bank cut-off is 15:30, anything later goes tomorrow.",
        `> Ship's agent at ${pb.place()} confirmed the berth for Thursday.`,
      ]);
      for (const l of quoted.slice(0, pb.rng.int(2, 5))) pb.line(l);
      pb.line();
    },
    (pb) =>
      prose(
        pb,
        [
          "Thanks, will check with the warehouse and revert.",
          "Can we move the call to tomorrow morning?",
          "Freight rates are up again this week.",
          "The container numbers are in the spreadsheet on the shared drive.",
          "Customs at {p} want the original certificate of origin.",
        ],
        3,
      ),
  ],
  split: () => [
    "Following up on the call: the balance should go out today, and the instruction will come from",
    "as usual, so please do not wait for the bank to call back.",
  ],
};

const tradefinance: Genre = {
  key: "tradefinance",
  label: "Trade finance file",
  header(pb) {
    pb.line("MERIDIA CENTRAL BANK - TRADE FINANCE OPERATIONS");
    specimen(pb, `Documentary credit file - ${pb.ref("DC")}`);
  },
  officials: [],
  official(pb, slot) {
    pb.para(`Survey report countersigned by ${pb.name(slot, ["honorific"])}.`);
  },
  blocks: [
    {
      max: 2,
      render(pb, [applicant, beneficiary]) {
        pb.line("IRREVOCABLE DOCUMENTARY CREDIT");
        pb.line(`Credit number:      ${pb.ref("LC")}`);
        pb.line(
          `Applicant:          ${pb.name(applicant, ["full", "caps", "alt", "swift"])}`,
        );
        if (beneficiary)
          pb.line(
            `Beneficiary:        ${pb.name(beneficiary, ["full", "caps", "alt", "swift", "lower"])}`,
          );
        pb.line(`Advising bank:      ${pb.bic()}`);
        pb.line(`Amount:             MRD ${pb.amount(10000, 2000000)}`);
        pb.line(`Expiry:             ${pb.date(20)} at ${pb.place()}`);
        pb.line();
      },
    },
    {
      max: 3,
      render(pb, [shipper, consignee, notify]) {
        pb.line("BILL OF LADING");
        pb.line(
          `Shipper:            ${pb.name(shipper, ["caps", "full", "swift"])}`,
        );
        if (consignee)
          pb.line(
            `Consignee:          TO ORDER OF ${pb.name(consignee, ["caps", "swift"])}`,
          );
        if (notify)
          pb.line(
            `Notify party:       ${pb.name(notify, ["full", "caps", "lower", "typo"])}`,
          );
        pb.line(`Vessel:             ${pb.vessel()}`);
        pb.line(`Port of loading:    ${pb.place()}`);
        pb.line(`Port of discharge:  ${pb.place()}`);
        pb.line();
      },
    },
    {
      max: 2,
      wants: ["person", "organization"],
      render(pb, [person, org]) {
        if (org)
          pb.line(`For and on behalf of ${pb.name(org, ["full", "caps"])}`);
        pb.line("______________________");
        pb.line(pb.name(person, ["full", "initials", "caps"]));
        pb.line("Authorised Signatory");
        pb.line();
      },
    },
    narrative([
      "Insurance certificate issued by {0} covering 110 per cent of the invoice value.",
      "Draft drawn on {0} at 90 days sight, endorsed in favour of {1}.",
      "Discrepancy notice: the invoice names {0} but the bill of lading names {1}.",
    ]),
  ],
  fillers: [
    (pb) =>
      prose(
        pb,
        [
          "This credit is subject to the Uniform Customs and Practice for Documentary Credits.",
          "Documents must be presented within 21 days after the date of shipment.",
          "Partial shipments are allowed; transhipment is not allowed.",
          "All banking charges outside Meridia are for the account of the beneficiary.",
          "A full set of clean on board ocean bills of lading made out to order is required.",
        ],
        4,
      ),
    (pb) => {
      pb.line("PACKING LIST");
      pb.table(
        ["Item", "Description", "Cartons", "Gross kg"],
        Array.from({ length: pb.rng.int(5, 9) }, (_, i) => [
          String(i + 1),
          pb.rng.pick([
            "Frozen fish fillets",
            "Cotton yarn",
            "Copper cathodes",
            "Ceramic tiles",
            "Engine spares",
            "Cocoa beans",
          ]),
          String(pb.rng.int(10, 900)),
          String(pb.rng.int(100, 25000)),
        ]),
      );
      pb.line();
    },
  ],
};

const minutes: Genre = {
  key: "minutes",
  label: "Board minutes",
  holder: "organization",
  header(pb, holder) {
    pb.line(
      `MINUTES OF A MEETING OF THE BOARD OF DIRECTORS OF ${holder ? pb.name(holder, ["caps"]) : "THE COMPANY"}`,
    );
    specimen(pb, `Held at ${pb.once("venue", () => pb.address())}`);
  },
  officials: [],
  official(pb, slot) {
    pb.para(
      `The board noted correspondence from ${pb.name(slot, ["honorific"])}.`,
    );
  },
  blocks: [
    {
      max: 4,
      wants: ["person", "person", "person", "person"],
      render(pb, slots) {
        const names = slots.map((slot) =>
          pb.name(slot, [
            "honSurname",
            "full",
            "honorific",
            "initials",
            "orgShort",
          ]),
        );
        pb.para(`Present: ${names.join(", ")}`);
        pb.line(`In attendance: the ${pb.jobTitle()}`);
        pb.line();
      },
    },
    narrative([
      "{0} reported that the audit of the {p} branch had been completed without exceptions.",
      "{0} presented the quarterly figures and noted a rise in receivables from {1}.",
      "The board noted the resignation of {0} with effect from {d}.",
      "RESOLVED that {0} be appointed a director of the Company with effect from {d}.",
      "{0} declared an interest in the contract with {1} and did not vote.",
      "The loan of M$ {a} from {0} was approved on the terms tabled.",
    ]),
    {
      max: 1,
      wants: ["person"],
      render(pb, [slot]) {
        pb.line("Signed as a correct record:");
        pb.line(
          `Chair: ${pb.name(slot, ["full", "initials"])}    Date: ${pb.date()}`,
        );
        pb.line();
      },
    },
  ],
  fillers: [
    (pb) =>
      prose(
        pb,
        [
          "The minutes of the previous meeting were approved and signed.",
          "There were no matters arising that were not on the agenda.",
          "The board reviewed the risk register and agreed the updated ratings.",
          "The management accounts for the period were noted.",
          "The board discussed the renewal of the insurance programme.",
          "Any other business: none.",
          "The date of the next meeting was confirmed as {d}.",
        ],
        5,
      ),
    (pb) => {
      pb.line("AGENDA");
      for (const [i, item] of [
        "Apologies",
        "Minutes of the previous meeting",
        "Finance report",
        "Risk and compliance",
        "Contracts for approval",
        "Any other business",
      ].entries())
        pb.line(`${i + 1}. ${item}`);
      pb.line();
    },
  ],
  split: () => [
    "The chair reminded the board that the guarantee given in favour of the lender had been signed by",
    "without the approval of the full board, and asked that this be recorded.",
  ],
};

export const GENRES: Record<string, Genre> = {
  wire,
  statement,
  kyc,
  registry,
  judgment,
  sar,
  comms,
  tradefinance,
  minutes,
};

// Hard-only parties ----------------------------------------------------------------------

/** Around a name broken over a page, for genres without their own sentence. */
export const GENERIC_SPLIT = (): [string, string] => [
  "The file note records that the outstanding balance was to be settled directly by",
  "once the documents had been released by the agent.",
];

/**
 * Prints a hard-only party: OCR-damaged text, an unlabelled table cell, an
 * email address or initials. Shared by every genre; never a clean form.
 */
export function renderHard(pb: PageBuilder, slot: Slot) {
  switch (slot.party.hard) {
    case "ocr": {
      const template = pb.rng.pick([
        "Scanned annex (OCR text, unverified): received with thanks from {0} the sum of M$ {a}.",
        "Handwritten note on the file copy, transcribed: call {0} about the second cheque.",
        "Fax copy, partly illegible: instruction from {0} dated {d}, amount M$ {a}.",
        "Stamp on the reverse of the cheque reads {0}, branch {p}.",
      ]);
      pb.para(fill(pb, template, [slot], ["ocr", "lower"]));
      pb.line();
      return;
    }
    case "cell": {
      const rows = [
        [pb.date(), "own account", pb.amount(), pb.ref("RCP")],
        [
          pb.date(),
          pb.name(slot, ["lower", "ocr"]),
          pb.amount(),
          pb.ref("RCP"),
        ],
        [pb.date(), "cash", pb.amount(50, 9000), pb.ref("RCP")],
      ];
      pb.table(
        ["Date", "Payer / payee", "Amount M$", "Ref"],
        pb.rng.shuffle(rows),
      );
      pb.line();
      return;
    }
    case "handle": {
      const local = pb.name(slot, ["handle"]);
      const domain = pb.rng.pick(
        pb.doc.domains.length > 0 ? pb.doc.domains : ["post.mr"],
      );
      const template = pb.rng.pick([
        `Copy of this page e-mailed to ${local}@${domain} on {d}.`,
        `Instruction received from ${local}@${domain}; no call-back recorded.`,
        `Out-of-office reply from ${local}@${domain}, forwarded to the desk.`,
      ]);
      pb.para(fill(pb, template, [], []));
      pb.line();
      return;
    }
    case "initials": {
      const template = pb.rng.pick([
        "Reviewed and initialled by {0} on {d}.",
        "Approval given by {0} by e-mail, {d}.",
        "Per telephone note, {0} confirmed the beneficiary details.",
      ]);
      pb.para(fill(pb, template, [slot], ["initialShort", "initials"]));
      pb.line();
      return;
    }
  }
}
