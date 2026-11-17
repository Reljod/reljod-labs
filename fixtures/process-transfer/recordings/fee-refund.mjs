// Approving a fee refund within authority limits, handed over on a call.
// Format: fixtures/process-transfer/README.md.

const fee = (id, date, desc, amt, st) => ({
  id,
  cells: { date, desc, amt, st },
});

export default {
  slug: "fee-refund",
  title: "Approving a fee refund",
  callTitle: "Handover: fee refund requests",
  callSub: "Customer Care",
  agenda:
    "Agenda: Lorna walks Dev through fee refunds before he joins the refunds rota.",
  timerOffset: 0,
  system: "Care Console",
  presenter: {
    name: "Lorna Quayle",
    role: "Customer Care Team Lead",
    initials: "LQ",
    color: "#2e7d8c",
    voice: "bf_isabella",
    speed: 1.05,
  },
  receiver: {
    name: "Dev Okonjo-Hart",
    role: "Customer Care Agent",
    initials: "DO",
    color: "#9b5d1f",
    voice: "am_puck",
    speed: 1.05,
  },
  ui: {
    appName: "Care Console",
    brand: "#0e5e6f",
    accent: "#ffd166",
    accent2: "#ffd166",
    soft: "#e2f1f4",
    userName: "L. Quayle",
    userInitials: "LQ",
    env: "PRODUCTION",
    nav: [
      { section: "Customers" },
      { id: "nav-search", label: "Customer search", icon: "search" },
      { id: "nav-cases", label: "Complaints", icon: "chat", count: "9" },
      { id: "nav-accounts", label: "Accounts", icon: "card" },
      { section: "Team" },
      { id: "nav-refunds", label: "Refund log", icon: "swap" },
      { id: "nav-limits", label: "My authority", icon: "key" },
    ],
    page: "search",
    pages: {
      search: {
        id: "search",
        nav: "nav-search",
        crumbs: ["Care Console", "Customer search"],
        title: "Find a customer",
        subtitle: "Search by name, customer number or account number",
        blocks: [
          {
            type: "filters",
            id: "s-filters",
            fields: [
              {
                id: "f-query",
                label: "Customer or account",
                placeholder: "e.g. 20-447-1093",
                kind: "text",
                icon: "search",
                w: 300,
              },
              {
                id: "f-type",
                label: "Type",
                value: "Personal",
                kind: "select",
                w: 160,
              },
            ],
            buttons: [{ id: "btn-find", label: "Search", kind: "primary" }],
          },
          {
            type: "table",
            id: "s-results",
            title: "Results",
            empty: "Enter a name or number to search.",
            columns: [
              { key: "cif", label: "Customer", mono: true },
              { key: "name", label: "Name" },
              { key: "acct", label: "Account", mono: true },
              { key: "open", label: "Open complaint" },
              { key: "st", label: "Status", chip: true },
            ],
            rows: [],
          },
        ],
      },
      cust: {
        id: "cust",
        nav: "nav-accounts",
        crumbs: ["Care Console", "Accounts", "0391-552-018"],
        title: "Philippa Wrenfield",
        subtitle: "Current account 0391-552-018 · CMP-60233",
        chip: "Open",
        actions: [
          {
            id: "btn-refund",
            label: "Refund fees",
            kind: "primary",
            icon: "swap",
            disabled: true,
          },
          { id: "btn-resolve", label: "Resolve complaint", icon: "check" },
        ],
        blocks: [
          {
            type: "row",
            blocks: [
              {
                type: "table",
                id: "fees",
                title: "Fees charged · last 90 days",
                flex: 1.7,
                columns: [
                  { key: "date", label: "Date" },
                  { key: "desc", label: "Fee" },
                  { key: "amt", label: "M$", align: "r" },
                  { key: "st", label: "Status", chip: true },
                ],
                rows: [
                  fee(
                    "fee-od",
                    "18 Nov",
                    "Unarranged overdraft",
                    "35.00",
                    "Charged",
                  ),
                  fee("fee-ui", "18 Nov", "Unpaid item", "12.00", "Charged"),
                  fee(
                    "fee-card",
                    "02 Oct",
                    "Card replacement",
                    "8.00",
                    "Charged",
                  ),
                  fee(
                    "fee-stmt",
                    "30 Sep",
                    "Paper statement",
                    "2.50",
                    "Charged",
                  ),
                ],
              },
              {
                type: "checklist",
                id: "elig",
                title: "Refund eligibility",
                flex: 1,
                items: [
                  {
                    id: "ch-12m",
                    label: "No refund in last 12 months",
                    checked: false,
                  },
                  {
                    id: "ch-cause",
                    label: "Salary credit was late",
                    checked: false,
                  },
                  {
                    id: "ch-coll",
                    label: "Account not in collections",
                    checked: false,
                  },
                ],
              },
            ],
          },
          {
            type: "row",
            blocks: [
              {
                type: "meter",
                id: "limit",
                title: "My refund authority",
                flex: 1,
                value: 0,
                label: "M$ 0 of 50",
                color: "#0e5e6f",
                text: "Agents up to M$ 50 · team leads up to M$ 250 · above that, Complaints.",
              },
              {
                type: "notes",
                id: "acct-notes",
                title: "Account notes",
                flex: 1.2,
                items: [
                  {
                    who: "Webchat",
                    when: "19 Nov 10:04",
                    text: "Salary came a day late; asks for the fees back.",
                  },
                ],
                composer: {
                  id: "note-input",
                  placeholder: "Add an account note…",
                  kind: "text",
                },
              },
            ],
          },
        ],
      },
    },
  },
  lines: [
    {
      s: "P",
      text: "Okay, so this complaint is from Philippa Wrenfield. I search her customer number first, so I'm on the right account.",
      step: "Search for the customer and open the account",
      at: 2.6,
      act: [
        { type: "f-query", text: "20-447-1093" },
        { click: "btn-find" },
        { blur: true },
        { loading: ["s-results", 0.7] },
        { wait: 0.7 },
        {
          add: [
            "s-results",
            {
              id: "res-1",
              cells: {
                cif: "20-447-1093",
                name: "Philippa Wrenfield",
                acct: "0391-552-018",
                open: "CMP-60233",
                st: "Active",
              },
            },
          ],
        },
        { click: "res-1" },
        { nav: "cust" },
      ],
    },
    {
      s: "P",
      text: "She went overdrawn on the eighteenth because her salary came in a day late. So we charged her thirty five for the overdraft, and twelve for an unpaid item. Forty seven in total.",
      step: "Identify the disputed fees",
      at: 2.8,
      act: [
        { click: "fee-od" },
        { set: ["fee-od", { selected: true }] },
        { click: "fee-ui" },
        { set: ["fee-ui", { selected: true }] },
        { set: ["btn-refund", { disabled: false }] },
      ],
    },
    { s: "R", text: "Do we refund everyone who asks?" },
    {
      s: "P",
      text: "No. You go down this eligibility list. If she's had a refund in the last twelve months, you decline it politely, unless it was our mistake. She's had none, the salary was late, and she's not in collections. So she's eligible.",
      step: "Check the refund eligibility rules",
      at: 1.4,
      act: [
        { wait: 4 },
        { check: "ch-12m" },
        { wait: 1.2 },
        { check: "ch-cause" },
        { wait: 0.4 },
        { check: "ch-coll" },
      ],
    },
    {
      s: "P",
      text: "Next, authority. You can approve up to fifty yourself. Up to two hundred and fifty it goes to a team lead like me, and anything above that goes to the Complaints team. Forty seven is inside your limit.",
      step: "Check the amount against the refund authority limit",
      at: 1.0,
      act: [
        { point: "limit", fx: 0.5, fy: 0.5, hold: 0.5 },
        {
          set: ["limit", { value: 94, label: "M$ 47 of 50", color: "#1d7a46" }],
        },
      ],
    },
    {
      s: "P",
      text: "So, refund fees. I pick the reason, check the amount, and post it.",
      step: "Post the refund to the account",
      at: 0.4,
      act: [
        { click: "btn-refund" },
        {
          modal: {
            id: "refund-modal",
            title: "Refund 2 fees",
            icon: "swap",
            width: 520,
            blocks: [
              {
                type: "form",
                id: "refund-form",
                cols: 2,
                fields: [
                  {
                    id: "f-amt",
                    label: "Amount M$",
                    value: "47.00",
                    kind: "readonly",
                  },
                  {
                    id: "f-to",
                    label: "Credit to",
                    value: "0391-552-018 (fee account)",
                    kind: "readonly",
                  },
                  {
                    id: "f-reason",
                    label: "Reason",
                    placeholder: "Choose a reason",
                    kind: "select",
                    span: 2,
                  },
                ],
              },
            ],
            buttons: [
              { id: "btn-refund-cancel", label: "Cancel" },
              { id: "btn-refund-post", label: "Post refund", kind: "primary" },
            ],
          },
        },
        { wait: 0.3 },
        {
          select: {
            id: "f-reason",
            options: [
              "Goodwill: first occurrence",
              "Bank error",
              "Fee charged in error",
            ],
            value: "Goodwill: first occurrence",
          },
        },
        { click: "btn-refund-post" },
        { modal: null },
        {
          set: [
            "fee-od",
            {
              selected: false,
              cells: {
                date: "18 Nov",
                desc: "Unarranged overdraft",
                amt: "35.00",
                st: "Refunded",
              },
            },
          ],
        },
        {
          set: [
            "fee-ui",
            {
              selected: false,
              cells: {
                date: "18 Nov",
                desc: "Unpaid item",
                amt: "12.00",
                st: "Refunded",
              },
            },
          ],
        },
        { set: ["btn-refund", { disabled: true }] },
        {
          toast: {
            title: "Refund posted",
            text: "M$ 47.00 credited to 0391-552-018.",
          },
        },
      ],
    },
    {
      s: "P",
      text: "One thing to watch. The refund always goes back to the account the fee came from. Never to a different account. That's a payment, not a refund, and it gets flagged.",
    },
    { s: "R", text: "What if she wants compensation on top, for the trouble?" },
    {
      s: "P",
      text: "Then it's not a fee refund any more. You note it, and pass it to Complaints. Speaking of notes, always leave one on the account.",
      step: "Leave a note on the account",
      at: 4.0,
      act: [
        {
          type: "note-input",
          text: "Refunded M$ 47 goodwill: salary late. CMP-60233.",
          cps: 17,
        },
        { blur: true },
        { set: ["note-input", { value: "" }] },
        {
          add: [
            "acct-notes",
            {
              who: "L. Quayle",
              when: "24 Nov 11:32",
              text: "Refunded M$ 47 goodwill: salary late. CMP-60233.",
            },
          ],
        },
      ],
    },
    {
      s: "P",
      text: "And finally, resolve the complaint, so the customer gets the outcome letter.",
      step: "Resolve the complaint",
      at: 0.8,
      act: [
        { click: "btn-resolve" },
        { set: ["cust", { chip: "Resolved" }] },
        { set: ["btn-resolve", { label: "Resolved", disabled: true }] },
        {
          toast: {
            tone: "info",
            title: "Complaint CMP-60233 resolved",
            text: "Outcome letter queued to the customer.",
          },
        },
      ],
    },
    {
      s: "R",
      text: "Does the unpaid item fee count towards her yearly goodwill allowance?",
    },
    {
      s: "P",
      text: "I'm not certain. The policy only talks about overdraft fees. I'll check with the Product team, and come back to you.",
    },
    { s: "R", text: "Okay, that's clear. Thanks Lorna." },
  ],
  decisions: [
    "If the customer has had a fee refund in the last 12 months, decline politely unless the fee was the bank's mistake; otherwise, if the eligibility checks pass, refund.",
    "Agents approve refunds up to M$50; up to M$250 goes to a team lead; above M$250 goes to the Complaints team.",
    "If the customer asks for compensation on top of the refund, note it and pass it to Complaints.",
  ],
  warnings: [
    "Refund only to the account the fee was taken from; crediting a different account is a payment, not a refund, and gets flagged.",
  ],
  openQuestions: [
    "Whether the unpaid item fee counts toward the customer's yearly goodwill allowance: Lorna will check with the Product team.",
  ],
};
