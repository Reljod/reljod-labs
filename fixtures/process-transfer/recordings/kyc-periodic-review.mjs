// KYC periodic review refresh, handed over on a call.
// Format: fixtures/process-transfer/README.md.

const due = (id, name, seg, risk, dueOn) => ({
  id,
  cells: { name, seg, risk, due: dueOn, st: "Due" },
});

export default {
  slug: "kyc-periodic-review",
  title: "KYC periodic review",
  callTitle: "Handover: KYC periodic reviews",
  callSub: "Compliance · Customer Due Diligence",
  agenda: "Agenda: Femi shows Rosa how to work the November review list.",
  timerOffset: 0,
  system: "KYC Workbench",
  presenter: {
    name: "Femi Adeyemi-Clarke",
    role: "KYC Senior Analyst",
    initials: "FA",
    color: "#c0743a",
    voice: "bm_daniel",
    speed: 1.05,
  },
  receiver: {
    name: "Rosa Linwood",
    role: "KYC Analyst",
    initials: "RL",
    color: "#5b6fc7",
    voice: "af_sarah",
    speed: 1.05,
  },
  ui: {
    appName: "KYC Workbench",
    brand: "#3d2a6b",
    accent: "#c9a7ff",
    accent2: "#c9a7ff",
    soft: "#eee8fa",
    userName: "F. Adeyemi-Clarke",
    userInitials: "FA",
    env: "PRODUCTION",
    nav: [
      { section: "Reviews" },
      { id: "nav-due", label: "Due list", icon: "cal", count: "14" },
      { id: "nav-mine", label: "My reviews", icon: "list" },
      { id: "nav-edd", label: "EDD escalations", icon: "flag" },
      { section: "Customers" },
      { id: "nav-search", label: "Customer search", icon: "search" },
      { id: "nav-docs", label: "Document vault", icon: "file" },
      { id: "nav-policy", label: "Risk policy", icon: "shield" },
    ],
    page: "due",
    pages: {
      due: {
        nav: "nav-due",
        crumbs: ["KYC Workbench", "Due list"],
        title: "Periodic review due list",
        subtitle: "Customers whose KYC review falls due in the chosen window",
        blocks: [
          {
            type: "filters",
            id: "due-filters",
            fields: [
              {
                id: "f-window",
                label: "Due window",
                value: "Next 7 days",
                kind: "select",
                w: 180,
              },
              {
                id: "f-seg",
                label: "Segment",
                value: "All segments",
                kind: "select",
                w: 180,
              },
            ],
            buttons: [
              {
                id: "btn-load",
                label: "Load due list",
                kind: "primary",
                icon: "refresh",
              },
            ],
          },
          {
            type: "table",
            id: "due-table",
            title: "Reviews due",
            empty: "Choose a window and load the due list.",
            columns: [
              { key: "name", label: "Customer" },
              { key: "seg", label: "Segment" },
              { key: "risk", label: "Risk", chip: true },
              { key: "due", label: "Due" },
              { key: "st", label: "Status", chip: true },
            ],
            rows: [],
          },
        ],
      },
      cust: {
        id: "cust",
        nav: "nav-mine",
        crumbs: ["KYC Workbench", "Due list", "CIF 210-447-019"],
        title: "Tidewater Chandlery",
        subtitle: "CIF 210-447-019 · due 20 Nov",
        chip: "In review",
        actions: [
          { id: "btn-rescore", label: "Re-score", icon: "refresh" },
          {
            id: "btn-escalate",
            label: "Escalate to EDD",
            kind: "danger",
            icon: "flag",
          },
          { id: "btn-approve", label: "Approve review", kind: "primary" },
        ],
        blocks: [
          {
            type: "tabs",
            id: "cust-tabs",
            items: [
              { id: "tab-docs", label: "Documents", on: true },
              { id: "tab-risk", label: "Risk" },
              { id: "tab-hist", label: "History" },
            ],
          },
          {
            type: "row",
            id: "view-docs",
            blocks: [
              {
                type: "docs",
                id: "docs",
                title: "Documents on file",
                flex: 1.5,
                drop: "Drop new documents here",
                items: [
                  {
                    id: "doc-coi",
                    name: "Certificate of incorporation",
                    meta: "Registry of Meridia · 2014",
                    status: "Verified",
                  },
                  {
                    id: "doc-poa",
                    name: "Proof of address",
                    meta: "Lease, Port Selene · Oct 2024",
                    status: "Expired",
                  },
                  {
                    id: "doc-id",
                    name: "Director ID · Odile Marchetti",
                    meta: "Passport · expired 02 Oct 2026",
                    status: "Expired",
                  },
                ],
              },
              {
                type: "detail",
                id: "profile",
                title: "Profile",
                flex: 1,
                cols: 1,
                items: [
                  { label: "Business", value: "Marine supplies, wholesale" },
                  { label: "Director", value: "Odile Marchetti" },
                  { label: "Last review", value: "20 Nov 2024" },
                  { label: "Current risk", value: "Medium", chip: true },
                ],
              },
            ],
          },
          {
            type: "row",
            id: "view-risk",
            hidden: true,
            blocks: [
              {
                type: "checklist",
                id: "factors",
                title: "Risk factors",
                flex: 1.2,
                items: [
                  {
                    id: "rf-cash",
                    label: "Cash-intensive business",
                    checked: false,
                  },
                  { id: "rf-pep", label: "PEP connected", checked: false },
                  {
                    id: "rf-xb",
                    label: "Cross-border payments > M$ 250k / month",
                    checked: false,
                  },
                  {
                    id: "rf-adv",
                    label: "Adverse media in last 24 months",
                    checked: false,
                  },
                ],
              },
              {
                type: "meter",
                id: "score",
                title: "Risk score",
                flex: 1,
                value: 42,
                label: "42 · Medium",
                color: "#d08a00",
                text: "70 or above is High: escalate to EDD.",
              },
            ],
          },
          {
            type: "notes",
            id: "notes",
            title: "Review notes",
            hidden: true,
            items: [],
            composer: { id: "note-input", placeholder: "Add a review note…" },
            buttons: [{ id: "btn-addnote", label: "Add note" }],
          },
        ],
      },
    },
  },
  lines: [
    {
      s: "P",
      text: "So this is the KYC Workbench. Periodic reviews come off the due list. I set the window to November, all segments, and load it.",
      step: "Load the November due list",
      at: 3.4,
      act: [
        {
          select: {
            id: "f-window",
            options: ["Next 7 days", "November 2026", "December 2026"],
            value: "November 2026",
          },
        },
        { click: "btn-load" },
        { loading: ["due-table", 0.9] },
        { wait: 0.9 },
        {
          add: [
            "due-table",
            due(
              "d-tide",
              "Tidewater Chandlery Ltd",
              "Corporate",
              "Medium",
              "20 Nov",
            ),
          ],
        },
        {
          add: [
            "due-table",
            due("d-orla", "Orla Benedetti", "Retail", "Low", "22 Nov"),
          ],
        },
        {
          add: [
            "due-table",
            due(
              "d-kest",
              "Kestrel Point Dental",
              "Business",
              "Medium",
              "24 Nov",
            ),
          ],
        },
        {
          add: [
            "due-table",
            due("d-hal", "Halyard Freight Co.", "Corporate", "High", "27 Nov"),
          ],
        },
        {
          add: [
            "due-table",
            due("d-mira", "Mirabel Osterhout", "Private", "Low", "29 Nov"),
          ],
        },
      ],
    },
    { s: "R", text: "Do I work them in date order?" },
    {
      s: "P",
      text: "Yes, oldest due date first. Tidewater Chandlery is due on the twentieth, so that's the first one.",
      step: "Open the first review on the list",
      at: 1.4,
      act: [{ click: "d-tide" }, { nav: "cust" }],
    },
    {
      s: "P",
      text: "Documents tab. The certificate of incorporation is fine. But the proof of address, and the director's I.D., have both expired.",
      step: "Check which documents have expired",
      at: 0.8,
      act: [
        { point: "doc-coi", hold: 1.6 },
        { point: "doc-poa", hold: 1.5 },
        { point: "doc-id", hold: 1.2 },
      ],
    },
    { s: "R", text: "So do we go back to the customer for both?" },
    {
      s: "P",
      text: "It depends. If we already hold a newer copy, say from the director's personal account, you link it instead of asking again. Otherwise, you request it from the customer.",
    },
    {
      s: "P",
      text: "The director, Odile Marchetti, renewed her passport with us in September, so I link that one.",
      step: "Link the director's renewed passport from her own customer record",
      at: 1.4,
      act: [
        {
          pick: {
            anchor: "doc-id",
            alignRight: true,
            items: [
              { id: "mi-link", label: "Link from customer record" },
              { id: "mi-req", label: "Request from customer" },
              { id: "mi-view", label: "View document" },
            ],
            choose: "mi-link",
          },
        },
        {
          set: [
            "doc-id",
            {
              meta: "Passport · linked from CIF 300-118-442 · exp 2036",
              status: "Verified",
            },
          ],
        },
        {
          toast: {
            title: "Document linked",
            text: "Passport for Odile Marchetti, valid to 2036.",
          },
        },
      ],
    },
    {
      s: "P",
      text: "For the proof of address there's nothing newer on file, and the customer sent a utility bill this morning. So I drop it in, and mark it verified.",
      step: "Upload the new proof of address and verify it",
      at: 2.0,
      act: [
        { click: "docs-drop" },
        { set: ["doc-poa", { status: "Superseded" }] },
        {
          add: [
            "docs",
            {
              id: "doc-bill",
              ext: "JPG",
              name: "Utility bill · Oct 2026",
              meta: "Uploaded just now · 412 KB",
              status: "Received",
            },
          ],
        },
        { wait: 0.6 },
        {
          pick: {
            anchor: "doc-bill",
            alignRight: true,
            items: [
              { id: "mi-ver", label: "Mark verified" },
              { id: "mi-rej", label: "Reject", danger: true },
            ],
            choose: "mi-ver",
          },
        },
        { set: ["doc-bill", { status: "Verified" }] },
      ],
    },
    {
      s: "P",
      text: "Now the risk tab. The score was forty two, medium. This year they started paying suppliers in Vossland, over two hundred and fifty thousand a month. So I tick cross-border payments, and re-score.",
      step: "Update the risk factors and re-score the customer",
      at: 0.6,
      act: [
        { click: "tab-risk" },
        { set: ["tab-docs", { on: false }] },
        { set: ["tab-risk", { on: true }] },
        { set: ["view-docs", { hidden: true }] },
        { set: ["view-risk", { hidden: false }] },
        { set: ["notes", { hidden: false }] },
        { point: "score", hold: 3.0 },
        { check: "rf-xb" },
        { click: "btn-rescore" },
        { loading: ["score", 1.0] },
        { wait: 1.0 },
        { set: ["score", { value: 71, label: "71 · High", color: "#c62828" }] },
      ],
    },
    { s: "P", text: "Seventy one. That's high." },
    { s: "R", text: "And what happens at high?" },
    {
      s: "P",
      text: "Seventy or above, you escalate to enhanced due diligence, and you don't approve the review yourself. Below seventy, you approve it and set the next review date. Two years for medium, three for low.",
    },
    {
      s: "P",
      text: "So. Escalate to E.D.D., with a short reason.",
      step: "Escalate the review to enhanced due diligence",
      at: 0.4,
      act: [
        { click: "btn-escalate" },
        {
          modal: {
            id: "esc-modal",
            title: "Escalate to EDD",
            icon: "flag",
            width: 520,
            blocks: [
              {
                type: "form",
                id: "esc-form",
                cols: 1,
                fields: [
                  {
                    id: "esc-score",
                    label: "Risk score",
                    kind: "readonly",
                    value: "71 · High (was 42 · Medium)",
                  },
                  {
                    id: "esc-reason",
                    label: "Reason",
                    kind: "textarea",
                    placeholder: "Why does this need EDD?",
                  },
                ],
              },
            ],
            buttons: [
              { id: "btn-esc-cancel", label: "Cancel" },
              { id: "btn-esc-ok", label: "Escalate", kind: "dangerfill" },
            ],
          },
        },
        {
          type: "esc-reason",
          text: "New supplier payments to Vossland, M$ 250k+ a month.",
          cps: 18,
        },
        { click: "btn-esc-ok" },
        { modal: null },
        { set: ["cust", { chip: "Escalated" }] },
        { set: ["btn-approve", { disabled: true }] },
        {
          toast: {
            tone: "warn",
            title: "Escalated to EDD",
            text: "Tidewater Chandlery Ltd · case EDD-2026-0377",
          },
        },
      ],
    },
    {
      s: "P",
      text: "One warning. The system will let you approve a review with an expired document still on file. Don't. It fails the quality check every time, and the review gets reopened.",
    },
    {
      s: "P",
      text: "Last, a note on the file, so the E.D.D. team knows what changed.",
      step: "Record a review note for the EDD team",
      at: 0.5,
      act: [
        {
          type: "note-input",
          text: "POA and director ID refreshed. Re-scored 42 to 71.",
          cps: 18,
        },
        { click: "btn-addnote" },
        { blur: true },
        { set: ["note-input", { value: "" }] },
        {
          add: [
            "notes",
            {
              who: "F. Adeyemi-Clarke",
              when: "14 Nov 11:06",
              text: "POA and director ID refreshed. Re-scored 42 to 71.",
            },
          ],
        },
      ],
    },
    {
      s: "P",
      text: "And one open point. I'm not sure Vossland is on the high-risk country list under the new policy. I'll confirm that with the financial crime policy team, because it changes the score.",
    },
    { s: "R", text: "Okay. I'll pick up the next one on the list." },
  ],
  decisions: [
    "If a newer copy of an expired document is already held (e.g. on the director's personal record), link it; otherwise request it from the customer.",
    "If the re-scored risk is 70 or above (High), escalate to enhanced due diligence and do not approve the review yourself; below 70, approve it and set the next review date (two years for Medium, three for Low).",
  ],
  warnings: [
    "Do not approve a review while an expired document is still on file: the system allows it, but it fails the quality check and the review is reopened.",
  ],
  openQuestions: [
    "Whether Vossland is on the high-risk country list under the new policy (it changes the score): Femi will confirm with the financial crime policy team.",
  ],
};
