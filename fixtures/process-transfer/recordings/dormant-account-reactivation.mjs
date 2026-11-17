// Reactivating a dormant account, handed over on a call.
// Format: fixtures/process-transfer/README.md.

export default {
  slug: "dormant-account-reactivation",
  title: "Reactivating a dormant account",
  callTitle: "Handover: dormant account reactivation",
  callSub: "Branch Operations",
  agenda: "Agenda: Delphine shows Joel how to reactivate a dormant account.",
  timerOffset: 0,
  system: "Branch Desk",
  presenter: {
    name: "Delphine Marrow",
    role: "Branch Operations Lead",
    initials: "DM",
    color: "#c0573a",
    voice: "af_heart",
    speed: 1.05,
  },
  receiver: {
    name: "Joel Okafor-Lind",
    role: "Customer Service Officer",
    initials: "JO",
    color: "#3a6fc0",
    voice: "am_fenrir",
    speed: 1.05,
  },
  ui: {
    appName: "Branch Desk",
    brand: "#0b4f5c",
    accent: "#f0a73a",
    accent2: "#f0a73a",
    soft: "#e2f1f3",
    userName: "D. Marrow",
    userInitials: "DM",
    env: "PORT SELENE CENTRAL",
    nav: [
      { section: "Customers" },
      { id: "nav-search", label: "Customer search", icon: "search" },
      { id: "nav-accounts", label: "Accounts", icon: "card" },
      { id: "nav-kyc", label: "Identity checks", icon: "shield" },
      { section: "Branch" },
      { id: "nav-approvals", label: "Approvals", icon: "check", count: "2" },
      { id: "nav-cash", label: "Teller cash", icon: "bank" },
      { id: "nav-letters", label: "Letters", icon: "mail" },
    ],
    page: "search",
    pages: {
      search: {
        nav: "nav-search",
        crumbs: ["Branch Desk", "Customer search"],
        title: "Customer search",
        subtitle: "Find a customer by name, account number or national ID",
        blocks: [
          {
            type: "filters",
            id: "search-filters",
            fields: [
              {
                id: "f-query",
                label: "Account or customer",
                placeholder: "e.g. 0418-221907-03",
                kind: "text",
                w: 300,
                icon: "search",
              },
              {
                id: "f-type",
                label: "Account type",
                value: "All types",
                kind: "select",
                w: 170,
              },
            ],
            buttons: [
              {
                id: "btn-search",
                label: "Search",
                kind: "primary",
                icon: "search",
              },
            ],
          },
          {
            type: "table",
            id: "results",
            title: "Results",
            empty: "Enter an account number or name, then Search.",
            columns: [
              { key: "acct", label: "Account", mono: true },
              { key: "name", label: "Customer" },
              { key: "type", label: "Type" },
              { key: "bal", label: "Balance M$", align: "r" },
              { key: "st", label: "Status", chip: true },
            ],
            rows: [],
          },
          {
            type: "callout",
            id: "search-tip",
            tone: "info",
            text: "Accounts with no customer activity for 24 months are flagged Dormant and blocked for debits.",
          },
        ],
      },
      acct: {
        id: "acct",
        nav: "nav-accounts",
        crumbs: ["Branch Desk", "Accounts", "0418-221907-03"],
        title: "Teodora Vance-Ibe",
        subtitle: "Savings 0418-221907-03",
        chip: "Dormant",
        actions: [
          { id: "btn-actions", label: "Actions", icon: "chev" },
          {
            id: "btn-reactivate",
            label: "Reactivate",
            kind: "primary",
            disabled: true,
          },
        ],
        blocks: [
          {
            type: "detail",
            id: "acct-detail",
            cols: 4,
            items: [
              { id: "d-since", label: "Dormant since", value: "14 Mar 2026" },
              { id: "d-last", label: "Last activity", value: "14 Mar 2024" },
              { id: "d-bal", label: "Balance", value: "M$ 3,206.18" },
              {
                id: "d-block",
                label: "Debit block",
                value: "Blocked",
                chip: true,
              },
            ],
          },
          {
            type: "row",
            blocks: [
              {
                type: "checklist",
                id: "idcheck",
                title: "Identity re-check",
                flex: 1,
                items: [
                  {
                    id: "chk-photo",
                    label: "Photo ID sighted, in date",
                    checked: false,
                  },
                  {
                    id: "chk-address",
                    label: "Address proof under 3 months",
                    checked: false,
                  },
                  {
                    id: "chk-sig",
                    label: "Signature matches mandate",
                    checked: false,
                  },
                  {
                    id: "chk-phone",
                    label: "Mobile number confirmed",
                    checked: false,
                  },
                ],
              },
              {
                type: "docs",
                id: "docs",
                title: "Documents on file",
                flex: 1.15,
                items: [
                  {
                    id: "doc-old",
                    name: "National ID card",
                    meta: "Expired 02 Jan 2026",
                    status: "Expired",
                    ext: "JPG",
                  },
                  {
                    id: "doc-mandate",
                    name: "Account mandate",
                    meta: "Signed 2019",
                    status: "Current",
                  },
                ],
                drop: "Drop a scan here or browse",
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
      text: "Right, so a customer walks in, and their account is dormant. First I find the account in Customer search, by the account number on their card.",
      step: "Find the dormant account in Customer search",
      at: 2.4,
      act: [
        { type: "f-query", text: "0418-221907-03" },
        { click: "btn-search" },
        { loading: ["results", 0.7] },
        { wait: 0.7 },
        {
          add: [
            "results",
            {
              id: "res-1",
              cells: {
                acct: "0418-221907-03",
                name: "Teodora Vance-Ibe",
                type: "Savings",
                bal: "3,206.18",
                st: "Dormant",
              },
            },
          ],
        },
        { wait: 0.4 },
        { click: "res-1" },
        { nav: "acct" },
      ],
    },
    {
      s: "P",
      text: "Here you can see it went dormant in March, two years after her last transaction. And the account is blocked for debits.",
      step: "Confirm the dormancy date and the debit block",
      at: 0.5,
      act: [
        { point: "d-since", hold: 2.4 },
        { point: "d-last", hold: 1.8 },
        { point: "d-block", hold: 0.6 },
      ],
    },
    { s: "R", text: "So we can't just lift the flag for her at the counter?" },
    {
      s: "P",
      text: "No. First the identity re-check. I look at her photo ID, proof of address, and compare her signature with the mandate, and I tick each one as I go.",
      step: "Re-check the customer's identity",
      at: 3.0,
      act: [
        { check: "chk-photo" },
        { wait: 0.4 },
        { check: "chk-address" },
        { wait: 0.4 },
        { check: "chk-sig" },
        { wait: 0.4 },
        { check: "chk-phone" },
      ],
    },
    {
      s: "P",
      text: "Her old ID card on file has expired, so I scan the new one and drop it in here.",
      step: "Upload the new ID document",
      at: 1.2,
      act: [
        { point: "docs-drop", hold: 0.6 },
        { loading: ["docs", 0.8] },
        { wait: 0.8 },
        { set: ["doc-old", { status: "Superseded" }] },
        {
          add: [
            "docs",
            {
              id: "doc-new",
              name: "National ID card (new)",
              meta: "Scanned today · valid to 2036",
              status: "Verified",
              ext: "JPG",
            },
            "start",
          ],
        },
        {
          toast: {
            title: "Document uploaded",
            text: "National ID card added and verified.",
          },
        },
      ],
    },
    { s: "R", text: "What if she comes in without a proof of address?" },
    {
      s: "P",
      text: "Then you stop there. If the ID has expired, or the address doesn't match, you don't reactivate. You book her in for a full KYC refresh instead. Otherwise, you carry on to the test transaction.",
    },
    {
      s: "P",
      text: "Actions, post test transaction. One Meridian dollar, as a credit, with the narrative reactivation test.",
      step: "Post a one dollar test credit",
      at: 0.4,
      act: [
        {
          pick: {
            anchor: "btn-actions",
            items: [
              { id: "mi-test", label: "Post test transaction" },
              { id: "mi-statement", label: "Print statement" },
              { id: "mi-confirm", label: "Send confirmation" },
              { id: "mi-close", label: "Close account", danger: true },
            ],
            choose: "mi-test",
          },
        },
        {
          modal: {
            id: "test-modal",
            title: "Post test transaction",
            icon: "swap",
            width: 520,
            blocks: [
              {
                type: "form",
                id: "test-form",
                cols: 2,
                fields: [
                  {
                    id: "t-dir",
                    label: "Direction",
                    value: "Credit",
                    kind: "select",
                  },
                  {
                    id: "t-amt",
                    label: "Amount M$",
                    placeholder: "0.00",
                    kind: "text",
                  },
                  {
                    id: "t-narr",
                    label: "Narrative",
                    placeholder: "Shown on statement",
                    kind: "text",
                    span: 2,
                  },
                ],
              },
            ],
            buttons: [
              { id: "t-cancel", label: "Cancel" },
              { id: "t-post", label: "Post", kind: "primary" },
            ],
          },
        },
        { type: "t-amt", text: "1.00" },
        { type: "t-narr", text: "Reactivation test" },
        { click: "t-post" },
        { modal: null },
        { set: ["d-last", { value: "Today, M$ 1.00 credit" }] },
        { set: ["btn-reactivate", { disabled: false }] },
        {
          toast: {
            title: "Test credit posted",
            text: "M$ 1.00 credited to 0418-221907-03.",
          },
        },
      ],
    },
    {
      s: "P",
      text: "Big warning here. Never test with a debit. A debit on a dormant account trips the fraud rule, and freezes the account for seventy two hours.",
    },
    {
      s: "P",
      text: "Now Reactivate. I give the reason, and it goes to the supervisor for approval.",
      step: "Submit the reactivation for supervisor approval",
      at: 0.3,
      act: [
        { click: "btn-reactivate" },
        {
          modal: {
            id: "re-modal",
            title: "Reactivate account",
            icon: "refresh",
            width: 500,
            blocks: [
              {
                type: "form",
                id: "re-form",
                cols: 1,
                fields: [
                  {
                    id: "re-reason",
                    label: "Reason",
                    value: "Customer returned in branch",
                    kind: "select",
                  },
                  {
                    id: "re-approver",
                    label: "Approver",
                    value: "Gareth Ruskin, Branch Supervisor",
                    kind: "readonly",
                  },
                ],
              },
            ],
            buttons: [
              { id: "re-cancel", label: "Cancel" },
              {
                id: "re-submit",
                label: "Submit for approval",
                kind: "primary",
              },
            ],
          },
        },
        { wait: 0.6 },
        { click: "re-submit" },
        { modal: null },
        { set: ["acct", { chip: "Awaiting approval" }] },
        {
          set: [
            "btn-reactivate",
            { disabled: true, label: "Pending approval" },
          ],
        },
        {
          toast: {
            tone: "info",
            title: "Sent for approval",
            text: "Gareth Ruskin has been asked to approve.",
          },
        },
      ],
    },
    {
      s: "P",
      text: "Gareth usually approves from his queue within a few minutes. There, it's come through, and the debit block is gone.",
      step: {
        title: "Supervisor approves the reactivation",
        actor: "Supervisor (Gareth Ruskin)",
      },
      at: 2.6,
      act: [
        { set: ["acct", { chip: "Active" }] },
        { set: ["d-block", { value: "None" }] },
        { set: ["btn-reactivate", { label: "Reactivated" }] },
        {
          toast: {
            title: "Reactivation approved",
            text: "Approved by G. Ruskin. Account is active.",
          },
        },
        { wait: 1.2 },
        { point: "d-block", hold: 0.6 },
      ],
    },
    {
      s: "P",
      text: "Last step, Actions, send confirmation, so she gets a text and a letter.",
      step: "Send the reactivation confirmation to the customer",
      at: 0.4,
      act: [
        {
          pick: {
            anchor: "btn-actions",
            items: [
              { id: "mi2-test", label: "Post test transaction" },
              { id: "mi2-statement", label: "Print statement" },
              { id: "mi2-confirm", label: "Send confirmation" },
              { id: "mi2-close", label: "Close account", danger: true },
            ],
            choose: "mi2-confirm",
          },
        },
        {
          toast: {
            title: "Confirmation queued",
            text: "SMS sent and letter added to tonight's print run.",
          },
        },
      ],
    },
    { s: "R", text: "Does she get back the dormancy fees she paid?" },
    {
      s: "P",
      text: "Good question. I think they're refunded on request now, but I'm not certain. I'll confirm the fee refund rule with the Product team, and let you know.",
    },
    { s: "R", text: "Perfect. I'll take the next one in the queue." },
  ],
  decisions: [
    "If the ID has expired or the proof of address does not match, do not reactivate and book the customer in for a full KYC refresh; otherwise continue to the test transaction.",
  ],
  warnings: [
    "Never use a debit as the test transaction: a debit on a dormant account trips the fraud rule and freezes the account for 72 hours.",
  ],
  openQuestions: [
    "Whether dormancy fees are refunded on request: Delphine will confirm the fee refund rule with the Product team.",
  ],
};
