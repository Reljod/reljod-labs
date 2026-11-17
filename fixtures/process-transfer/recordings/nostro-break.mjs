// Investigating a nostro reconciliation break, handed over on a call.
// Format: fixtures/process-transfer/README.md.

const item = (id, side, vd, ref, amt, st) => ({
  id,
  cells: { side, vd, ref, amt, st },
});

export default {
  slug: "nostro-break",
  title: "Investigating a nostro break",
  callTitle: "Handover: nostro breaks, USD at Coraline Federal",
  callSub: "Treasury Operations",
  agenda: "Agenda: show Kenji the daily nostro break routine.",
  timerOffset: 0,
  system: "Recon Station",
  presenter: {
    name: "Ingrid Solberg-Ade",
    role: "Treasury Operations Manager",
    initials: "IS",
    color: "#b4562c",
    voice: "bf_alice",
    speed: 1.05,
  },
  receiver: {
    name: "Kenji Abernathy",
    role: "Reconciliations Analyst",
    initials: "KA",
    color: "#3a6fb0",
    voice: "am_eric",
    speed: 1.05,
  },
  ui: {
    appName: "Recon Station",
    brand: "#0f4c3a",
    accent: "#7ed6b0",
    accent2: "#7ed6b0",
    soft: "#e2f3eb",
    userName: "I. Solberg-Ade",
    userInitials: "IS",
    env: "PRODUCTION",
    nav: [
      { section: "Reconciliation" },
      { id: "nav-over", label: "Nostro overview", icon: "bank" },
      { id: "nav-breaks", label: "Breaks", icon: "alert", count: "2" },
      { id: "nav-rules", label: "Match rules", icon: "settings" },
      { id: "nav-ageing", label: "Ageing report", icon: "clock" },
      { section: "Messages" },
      { id: "nav-queries", label: "Queries", icon: "mail" },
      { id: "nav-stmts", label: "Statements", icon: "file" },
    ],
    page: "over",
    pages: {
      over: {
        nav: "nav-over",
        crumbs: ["Recon Station", "Nostro overview"],
        title: "Nostro accounts",
        subtitle: "Correspondent statements loaded 07:10 · 14 Nov 2026",
        blocks: [
          {
            type: "kpis",
            id: "over-kpis",
            items: [
              { label: "Accounts", value: "6" },
              { label: "Fully matched", value: "5", tone: "good" },
              { label: "Open breaks", value: "2", tone: "bad" },
              { label: "Oldest break", value: "1 day" },
            ],
          },
          {
            type: "table",
            id: "accounts",
            title: "Accounts by currency",
            columns: [
              { key: "ccy", label: "Ccy" },
              { key: "bank", label: "Correspondent" },
              { key: "acct", label: "Account", mono: true },
              { key: "br", label: "Breaks", align: "r" },
              { key: "st", label: "Status", chip: true },
            ],
            rows: [
              {
                id: "acc-usd",
                cells: {
                  ccy: "USD",
                  bank: "Coraline Federal Trust",
                  acct: "4410-118-07",
                  br: "2",
                  st: "Break",
                },
              },
              {
                id: "acc-eur",
                cells: {
                  ccy: "EUR",
                  bank: "Valmont Girobank",
                  acct: "7720-004-31",
                  br: "0",
                  st: "Cleared",
                },
              },
              {
                id: "acc-gbp",
                cells: {
                  ccy: "GBP",
                  bank: "Ashcombe & Rede",
                  acct: "0193-552-60",
                  br: "0",
                  st: "Cleared",
                },
              },
              {
                id: "acc-chf",
                cells: {
                  ccy: "CHF",
                  bank: "Banque Lisière",
                  acct: "3307-219-88",
                  br: "0",
                  st: "Cleared",
                },
              },
              {
                id: "acc-jpy",
                cells: {
                  ccy: "JPY",
                  bank: "Seiran Trust Bank",
                  acct: "5561-080-12",
                  br: "0",
                  st: "Cleared",
                },
              },
            ],
          },
        ],
      },
      usd: {
        id: "usd",
        nav: "nav-breaks",
        crumbs: ["Recon Station", "Nostro overview", "USD 4410-118-07"],
        title: "USD · Coraline Federal Trust",
        subtitle: "Statement 14 Nov 2026 vs general ledger",
        chip: "Break",
        actions: [
          { id: "btn-compare", label: "Compare", icon: "swap" },
          { id: "btn-actions", label: "Actions", icon: "chev" },
          {
            id: "btn-refresh",
            label: "Refresh",
            kind: "primary",
            icon: "refresh",
          },
        ],
        blocks: [
          {
            type: "kpis",
            id: "usd-kpis",
            items: [
              {
                id: "k-stmt",
                label: "Statement bal. USD",
                value: "2,418,905.10",
              },
              {
                id: "k-diff",
                label: "Stmt − ledger",
                value: "−240.00",
                tone: "bad",
              },
              {
                id: "k-items",
                label: "Unmatched items",
                value: "3",
                tone: "bad",
              },
              {
                id: "k-value",
                label: "Unmatched USD",
                value: "37,140.00",
                tone: "bad",
              },
            ],
          },
          {
            type: "tabs",
            id: "usd-tabs",
            items: [
              { id: "tab-all", label: "All items (5)", on: true },
              { id: "tab-unm", label: "Unmatched (3)" },
              { id: "tab-m", label: "Matched (2)" },
            ],
          },
          {
            type: "table",
            id: "items",
            columns: [
              { key: "side", label: "Side" },
              { key: "vd", label: "Value date" },
              { key: "ref", label: "Reference", mono: true },
              { key: "amt", label: "Amount USD", align: "r" },
              { key: "st", label: "Status", chip: true },
            ],
            rows: [
              item(
                "it-s1",
                "Statement",
                "12 Nov",
                "CFT-55120",
                "9,800.00 Cr",
                "Matched",
              ),
              item(
                "it-s2",
                "Statement",
                "13 Nov",
                "CFT-55187",
                "18,450.00 Dr",
                "Unmatched",
              ),
              item(
                "it-l1",
                "Ledger",
                "14 Nov",
                "PAY-88213",
                "18,450.00 Dr",
                "Unmatched",
              ),
              item(
                "it-s3",
                "Statement",
                "14 Nov",
                "CFT-55204",
                "240.00 Dr",
                "Unmatched",
              ),
              item(
                "it-l2",
                "Ledger",
                "12 Nov",
                "RCV-40177",
                "9,800.00 Cr",
                "Matched",
              ),
            ],
          },
        ],
      },
    },
  },
  lines: [
    {
      s: "P",
      text: "Right, this is Recon Station. Every morning I start on the nostro overview. The U.S. dollar account at Coraline Federal Trust has two breaks, so I'll open that one.",
      step: "Open the USD nostro account with breaks",
      at: 4.5,
      act: [
        { point: "acc-usd", hold: 0.9 },
        { click: "acc-usd" },
        { nav: "usd" },
      ],
    },
    {
      s: "P",
      text: "First I switch to the unmatched tab, so the matched items are out of the way.",
      step: "Filter to unmatched items",
      at: 1.2,
      act: [
        { click: "tab-unm" },
        { set: ["tab-all", { on: false }] },
        { set: ["tab-unm", { on: true }] },
        { set: ["it-s1", { hidden: true }] },
        { set: ["it-l2", { hidden: true }] },
      ],
    },
    { s: "R", text: "So these three are the breaks?" },
    {
      s: "P",
      text: "Yes. This statement debit for eighteen thousand, four hundred and fifty has nothing against it. And down here is a ledger payment for the same amount. I select both, and compare.",
      step: "Select the statement debit and the ledger payment and compare them",
      at: 1.0,
      act: [
        { point: "it-s2", hold: 1.6 },
        { point: "it-l1", hold: 1.6 },
        { click: "it-s2" },
        { set: ["it-s2", { selected: true }] },
        { click: "it-l1" },
        { set: ["it-l1", { selected: true }] },
        { click: "btn-compare" },
        {
          modal: {
            id: "cmp-modal",
            title: "Compare 2 items",
            icon: "swap",
            width: 600,
            blocks: [
              {
                type: "compare",
                id: "cmp",
                left: "Statement CFT-55187",
                right: "Ledger PAY-88213",
                rows: [
                  {
                    id: "cmp-amt",
                    label: "Amount",
                    a: "USD 18,450.00 Dr",
                    b: "USD 18,450.00 Dr",
                    result: "nomatch",
                    resultLabel: "Same",
                  },
                  {
                    id: "cmp-dir",
                    label: "Direction",
                    a: "Debit",
                    b: "Debit",
                    result: "nomatch",
                    resultLabel: "Same",
                  },
                  {
                    id: "cmp-narr",
                    label: "Narrative",
                    a: "PAY-88213 HARTWELL MARINE",
                    b: "PAY-88213",
                    result: "nomatch",
                    resultLabel: "Ref found",
                  },
                  {
                    id: "cmp-vd",
                    label: "Value date",
                    a: "13 Nov 2026",
                    b: "14 Nov 2026",
                    result: "partial",
                    resultLabel: "1 day apart",
                  },
                ],
              },
            ],
            buttons: [
              { id: "btn-cmp-close", label: "Close" },
              { id: "btn-mm", label: "Manual match", kind: "primary" },
            ],
          },
        },
      ],
    },
    {
      s: "P",
      text: "Same amount, same direction, and our payment reference is in their narrative. Only the value date differs. They booked it on the thirteenth, we booked it on the fourteenth.",
      step: "Check amount, reference and value date",
      at: 0.4,
      act: [
        { point: "cmp-amt", hold: 1.2 },
        { point: "cmp-narr", hold: 2.2 },
        { point: "cmp-vd", hold: 1.2 },
      ],
    },
    { s: "R", text: "How do you decide whether you can match it, then?" },
    {
      s: "P",
      text: "If the amount and the reference agree, and the dates are one business day apart, you manual match it, with the reason value date difference. If the amount is different, or there's no ledger item at all, you don't match. You raise a query with the correspondent.",
    },
    {
      s: "P",
      text: "So here. Manual match, reason, value date difference, and confirm.",
      step: "Manually match the pair with reason 'value date difference'",
      at: 0.3,
      act: [
        { click: "btn-mm" },
        {
          modal: {
            id: "mm-modal",
            title: "Manual match",
            icon: "check",
            width: 500,
            blocks: [
              {
                type: "form",
                id: "mm-form",
                cols: 1,
                fields: [
                  {
                    id: "mm-reason",
                    label: "Reason",
                    kind: "select",
                    placeholder: "Choose a reason",
                  },
                  {
                    id: "mm-items",
                    label: "Items",
                    kind: "readonly",
                    value: "CFT-55187 ↔ PAY-88213 · USD 18,450.00",
                  },
                ],
              },
            ],
            buttons: [
              { id: "btn-mm-cancel", label: "Cancel" },
              { id: "btn-mm-ok", label: "Confirm match", kind: "primary" },
            ],
          },
        },
        { wait: 0.3 },
        {
          select: {
            id: "mm-reason",
            options: ["Value date difference", "Split payment", "FX rounding"],
            value: "Value date difference",
          },
        },
        { click: "btn-mm-ok" },
        { modal: null },
        {
          set: [
            "it-s2",
            {
              selected: false,
              cells: {
                side: "Statement",
                vd: "13 Nov",
                ref: "CFT-55187",
                amt: "18,450.00 Dr",
                st: "Matched",
              },
            },
          ],
        },
        {
          set: [
            "it-l1",
            {
              selected: false,
              cells: {
                side: "Ledger",
                vd: "14 Nov",
                ref: "PAY-88213",
                amt: "18,450.00 Dr",
                st: "Matched",
              },
            },
          ],
        },
        { set: ["k-items", { value: "1" }] },
        { set: ["tab-unm", { label: "Unmatched (1)" }] },
        { set: ["tab-m", { label: "Matched (4)" }] },
        { set: ["k-value", { value: "240.00", tone: "warn" }] },
        {
          toast: {
            title: "Manual match saved",
            text: "CFT-55187 ↔ PAY-88213 · reason: value date difference",
          },
        },
      ],
    },
    {
      s: "P",
      text: "Now, a warning. Never force a match where the amounts differ, just to get a break off the ageing report. Audit samples manual matches every month, and that's the first thing they look for.",
    },
    {
      s: "P",
      text: "The last break is a two hundred and forty dollar debit, with no reference we recognise. That one goes to the correspondent.",
      step: "Raise a query to the correspondent for the unexplained debit",
      at: 1.4,
      act: [
        { click: "it-s3" },
        { set: ["it-s3", { selected: true }] },
        {
          pick: {
            anchor: "btn-actions",
            items: [
              { id: "mi-match", label: "Manual match" },
              { id: "mi-wo", label: "Write off (needs approval)" },
              { id: "mi-query", label: "Raise query to correspondent" },
            ],
            choose: "mi-query",
          },
        },
        {
          modal: {
            id: "q-modal",
            title: "Query to Coraline Federal Trust",
            icon: "mail",
            width: 560,
            blocks: [
              {
                type: "form",
                id: "q-form",
                cols: 2,
                fields: [
                  {
                    id: "q-type",
                    label: "Query type",
                    kind: "select",
                    placeholder: "Choose",
                  },
                  {
                    id: "q-follow",
                    label: "Follow-up date",
                    kind: "date",
                    placeholder: "dd Mon yyyy",
                  },
                  {
                    id: "q-msg",
                    label: "Message",
                    kind: "textarea",
                    placeholder: "What do you need from the correspondent?",
                    span: 2,
                  },
                ],
              },
            ],
            buttons: [
              { id: "btn-q-cancel", label: "Cancel" },
              {
                id: "btn-q-send",
                label: "Send query",
                kind: "primary",
                icon: "send",
              },
            ],
          },
        },
      ],
    },
    {
      s: "P",
      text: "Query type, unknown charge. Then a short message with their reference, and a follow-up date, three business days out.",
      step: "Write the query, set a follow-up date and send it",
      at: 0.4,
      act: [
        {
          select: {
            id: "q-type",
            options: ["Unknown charge", "Missing credit", "Duplicate debit"],
            value: "Unknown charge",
          },
        },
        {
          type: "q-msg",
          text: "Please advise basis of USD 240.00 debit, ref CFT-55204.",
          cps: 18,
        },
        { type: "q-follow", text: "19 Nov 2026" },
        { click: "btn-q-send" },
        { modal: null },
        {
          set: [
            "it-s3",
            {
              selected: false,
              cells: {
                side: "Statement",
                vd: "14 Nov",
                ref: "CFT-55204",
                amt: "240.00 Dr",
                st: "Query",
              },
            },
          ],
        },
        {
          toast: {
            tone: "info",
            title: "Query sent",
            text: "To Coraline Federal Trust · follow up 19 Nov",
          },
        },
      ],
    },
    {
      s: "R",
      text: "Does it go out straight away, or does someone approve it?",
    },
    {
      s: "P",
      text: "Straight away. Queries don't need approval. Only write-offs do.",
    },
    {
      s: "P",
      text: "Finally I refresh, and the unmatched value should equal what's still open. Two hundred and forty. Good.",
      step: "Refresh and check the unmatched value equals the open break",
      at: 0.9,
      act: [
        { click: "btn-refresh" },
        { loading: ["usd-kpis", 1.0] },
        { wait: 1.0 },
        { set: ["usd", { chip: "Query" }] },
        {
          toast: {
            title: "Reconciliation refreshed",
            text: "1 open item · USD 240.00 under query",
          },
        },
        { point: "k-value", hold: 0.6 },
      ],
    },
    {
      s: "P",
      text: "One thing I'm not sure about. Coraline may have started a monthly account fee, which would explain the two forty. I'll confirm that with the correspondent banking team before the next statement.",
    },
    { s: "R", text: "Okay. And if it is a fee, we book it on our side?" },
    { s: "P", text: "Yes. But only once they confirm it in writing." },
  ],
  decisions: [
    "If the amount and reference agree and the value dates are one business day apart, manually match the pair with the reason 'value date difference'; if the amount differs or there is no ledger item, do not match and raise a query with the correspondent.",
  ],
  warnings: [
    "Never force a match where the amounts differ just to clear the ageing report; audit samples manual matches every month.",
    "Queries go out without approval, but write-offs need approval.",
  ],
  openQuestions: [
    "Whether Coraline Federal Trust has started a monthly account fee that explains the USD 240 debit: Ingrid will confirm with the correspondent banking team before the next statement.",
  ],
};
