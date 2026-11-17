// Month-end pension contribution reconciliation, handed over on a call.
// Format: fixtures/process-transfer/README.md.

const lines = [
  ["MR-77304", "Abena Kirwan-Dale", "1,240.00", "1,240.00"],
  ["MR-77305", "Lucio Bramhall", "986.50", "986.50"],
  ["MR-77308", "Sefa Morrow", "1,410.20", "1,410.20"],
  ["MR-77310", "Dario Ferreira", "500.00", "0.00"],
  ["MR-77312", "Ines Takahara", "1,102.75", "1,102.75"],
  ["MR-77315", "Gideon Ploughman", "1,318.00", "1,318.00"],
];

export default {
  slug: "contribution-reconciliation",
  title: "Month-end contribution reconciliation",
  callTitle: "Handover: October contribution reconciliation",
  callSub: "Pensions Operations",
  agenda:
    "Agenda: walk Tomas through month-end reconciliation before Corinne's leave.",
  timerOffset: 0,
  system: "Pensions Desk",
  presenter: {
    name: "Corinne Ashdown",
    role: "Senior Pensions Analyst",
    initials: "CA",
    color: "#8a4fbf",
    voice: "bf_emma",
    speed: 1.05,
  },
  receiver: {
    name: "Tomas Reyner",
    role: "Pensions Analyst",
    initials: "TR",
    color: "#2f7d6d",
    voice: "am_michael",
    speed: 1.05,
  },
  ui: {
    appName: "Pensions Desk",
    brand: "#1f3a68",
    accent: "#f2c14e",
    accent2: "#f2c14e",
    soft: "#e6edf9",
    userName: "C. Ashdown",
    userInitials: "CA",
    env: "PRODUCTION",
    nav: [
      { section: "Operations" },
      { id: "nav-dash", label: "Dashboard", icon: "home" },
      { id: "nav-employers", label: "Employers", icon: "bank" },
      { id: "nav-remit", label: "Remittances", icon: "inbox", count: "3" },
      { id: "nav-sched", label: "Schedules", icon: "list" },
      { id: "nav-members", label: "Member records", icon: "users" },
      { section: "Finance" },
      { id: "nav-post", label: "Postings", icon: "swap" },
      { id: "nav-reports", label: "Reports", icon: "chart" },
    ],
    page: "dash",
    pages: {
      dash: {
        nav: "nav-dash",
        crumbs: ["Pensions Desk", "Dashboard"],
        title: "Good morning, Corinne",
        subtitle: "Month end · October 2026 · 3 remittances waiting",
        blocks: [
          {
            type: "kpis",
            id: "dash-kpis",
            items: [
              { label: "Remittances received", value: "38" },
              { label: "Reconciled", value: "35", tone: "good" },
              { label: "Unreconciled", value: "3", tone: "warn" },
              { label: "Posting cut-off", value: "5 Nov" },
            ],
          },
          {
            type: "table",
            id: "dash-queue",
            title: "My work queues",
            columns: [
              { key: "q", label: "Queue" },
              { key: "n", label: "Items", align: "r" },
              { key: "o", label: "Oldest" },
              { key: "s", label: "Status", chip: true },
            ],
            rows: [
              {
                id: "q1",
                cells: {
                  q: "Remittances to reconcile",
                  n: "3",
                  o: "1 Nov",
                  s: "Due",
                },
              },
              {
                id: "q2",
                cells: {
                  q: "Member transfers in",
                  n: "7",
                  o: "29 Oct",
                  s: "Open",
                },
              },
              {
                id: "q3",
                cells: {
                  q: "Employer queries",
                  n: "1",
                  o: "24 Oct",
                  s: "Awaiting",
                },
              },
              {
                id: "q4",
                cells: {
                  q: "Leaver notifications",
                  n: "4",
                  o: "30 Oct",
                  s: "New",
                },
              },
            ],
          },
        ],
      },
      remit: {
        nav: "nav-remit",
        crumbs: ["Pensions Desk", "Remittances"],
        title: "Employer remittances",
        subtitle:
          "Money received from employers against their contribution schedules",
        blocks: [
          {
            type: "filters",
            id: "remit-filters",
            fields: [
              {
                id: "f-period",
                label: "Period",
                value: "September 2026",
                kind: "select",
                w: 190,
              },
              {
                id: "f-status",
                label: "Status",
                value: "All",
                kind: "select",
                w: 170,
              },
              {
                id: "f-emp",
                label: "Employer",
                placeholder: "Any employer",
                kind: "text",
                w: 190,
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
            id: "remit-table",
            title: "Results",
            empty: "Choose a period and status, then Search.",
            columns: [
              { key: "id", label: "Remittance", mono: true },
              { key: "emp", label: "Employer" },
              { key: "sch", label: "Scheduled M$", align: "r" },
              { key: "rec", label: "Received M$", align: "r" },
              { key: "st", label: "Status", chip: true },
            ],
            rows: [],
          },
        ],
      },
      detail: {
        id: "detail",
        nav: "nav-remit",
        crumbs: ["Pensions Desk", "Remittances", "RM-2026-10-0418"],
        title: "Harbourline Logistics",
        subtitle: "RM-2026-10-0418 · October 2026",
        chip: "Variance",
        actions: [
          { id: "btn-automatch", label: "Auto-match", icon: "refresh" },
          { id: "btn-actions", label: "Actions", icon: "chev" },
          {
            id: "btn-post",
            label: "Post to members",
            kind: "primary",
            disabled: true,
          },
        ],
        blocks: [
          {
            type: "kpis",
            id: "kpis",
            items: [
              {
                id: "kpi-sched",
                label: "Schedule total M$",
                value: "48,612.40",
              },
              { id: "kpi-recv", label: "Received M$", value: "48,112.40" },
              {
                id: "kpi-var",
                label: "Variance M$",
                value: "−500.00",
                tone: "bad",
              },
              { id: "kpi-match", label: "Lines matched", value: "0 / 42" },
            ],
          },
          {
            type: "row",
            blocks: [
              {
                type: "table",
                id: "lines",
                title: "Member lines",
                meta: "6 of 42 shown",
                flex: 2,
                columns: [
                  { key: "m", label: "Member", mono: true },
                  { key: "n", label: "Name" },
                  { key: "s", label: "Sched.", align: "r" },
                  { key: "r", label: "Recv.", align: "r" },
                  { key: "st", label: "Status", chip: true },
                ],
                rows: lines.map(([m, n, s, r]) => ({
                  id: `ln-${m}`,
                  cells: { m, n, s, r, st: "Pending" },
                })),
              },
              {
                type: "notes",
                id: "notes",
                title: "Notes",
                flex: 1,
                items: [
                  {
                    who: "System",
                    when: "31 Oct 16:02",
                    text: "Remittance received by bank transfer, ref HBL-OCT-26.",
                  },
                ],
                composer: {
                  id: "note-input",
                  placeholder: "Add a note…",
                  kind: "textarea",
                },
                buttons: [{ id: "btn-addnote", label: "Add note" }],
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
      text: "Okay, so this is the Pensions Desk. At month end the first thing I do is open Remittances, and filter to October, unreconciled only.",
      step: "Open Remittances and filter to October, unreconciled",
      at: 2.2,
      act: [
        { click: "nav-remit" },
        { nav: "remit" },
        { wait: 0.5 },
        {
          select: {
            id: "f-period",
            options: ["November 2026", "October 2026", "September 2026"],
            value: "October 2026",
          },
        },
        {
          select: {
            id: "f-status",
            options: ["All", "Unreconciled", "Reconciled", "Query"],
            value: "Unreconciled",
          },
        },
        { click: "btn-search" },
        { loading: ["remit-table", 0.8] },
        { wait: 0.8 },
        {
          add: [
            "remit-table",
            {
              id: "rm-harbour",
              cells: {
                id: "RM-0418",
                emp: "Harbourline Logistics",
                sch: "48,612.40",
                rec: "48,112.40",
                st: "Variance",
              },
            },
          ],
        },
        {
          add: [
            "remit-table",
            {
              id: "rm-quarry",
              cells: {
                id: "RM-0421",
                emp: "Quarrybend Foods",
                sch: "12,930.00",
                rec: "12,930.00",
                st: "Pending",
              },
            },
          ],
        },
        {
          add: [
            "remit-table",
            {
              id: "rm-solace",
              cells: {
                id: "RM-0426",
                emp: "Solace Bay Clinics",
                sch: "27,455.15",
                rec: "27,455.15",
                st: "Pending",
              },
            },
          ],
        },
      ],
    },
    { s: "R", text: "So everything on this list still needs to be matched?" },
    {
      s: "P",
      text: "Exactly. Three today. Two are clean, they just need posting. Harbourline Logistics is flagged as a variance, so let's start there.",
      step: "Open the Harbourline Logistics remittance",
      at: 3.6,
      act: [
        { point: "rm-harbour", hold: 0.8 },
        { click: "rm-harbour" },
        { nav: "detail" },
      ],
    },
    {
      s: "P",
      text: "On the left is what the employer said they would pay on their schedule. Forty eight thousand, six hundred and twelve. What actually arrived is forty eight thousand, one hundred and twelve. So we are five hundred short.",
      step: "Compare the schedule total with the amount received",
      at: 0.6,
      act: [
        { point: "kpi-sched", hold: 3.2 },
        { point: "kpi-recv", hold: 3.6 },
        { point: "kpi-var", hold: 1.2 },
      ],
    },
    {
      s: "P",
      text: "Next I run auto match, which pairs each member line on the schedule with the money that came in.",
      step: "Run auto-match on the member lines",
      at: 1.0,
      act: [
        { click: "btn-automatch" },
        { loading: ["lines", 1.2] },
        { wait: 1.2 },
        {
          set: [
            "ln-MR-77304",
            {
              cells: {
                m: "MR-77304",
                n: "Abena Kirwan-Dale",
                s: "1,240.00",
                r: "1,240.00",
                st: "Matched",
              },
            },
          ],
        },
        {
          set: [
            "ln-MR-77305",
            {
              cells: {
                m: "MR-77305",
                n: "Lucio Bramhall",
                s: "986.50",
                r: "986.50",
                st: "Matched",
              },
            },
          ],
        },
        {
          set: [
            "ln-MR-77308",
            {
              cells: {
                m: "MR-77308",
                n: "Sefa Morrow",
                s: "1,410.20",
                r: "1,410.20",
                st: "Matched",
              },
            },
          ],
        },
        {
          set: [
            "ln-MR-77310",
            {
              neg: "r",
              cells: {
                m: "MR-77310",
                n: "Dario Ferreira",
                s: "500.00",
                r: "0.00",
                st: "Unmatched",
              },
            },
          ],
        },
        {
          set: [
            "ln-MR-77312",
            {
              cells: {
                m: "MR-77312",
                n: "Ines Takahara",
                s: "1,102.75",
                r: "1,102.75",
                st: "Matched",
              },
            },
          ],
        },
        {
          set: [
            "ln-MR-77315",
            {
              cells: {
                m: "MR-77315",
                n: "Gideon Ploughman",
                s: "1,318.00",
                r: "1,318.00",
                st: "Matched",
              },
            },
          ],
        },
        { set: ["kpi-match", { value: "41 / 42", tone: "warn" }] },
        {
          toast: {
            tone: "warn",
            title: "Auto-match complete",
            text: "41 of 42 member lines matched. 1 line unmatched.",
          },
        },
      ],
    },
    { s: "R", text: "What's the tolerance, though? Do we chase every cent?" },
    {
      s: "P",
      text: "No. If the variance is fifty Meridian dollars or less, you accept it and write a note. Anything over fifty, like this one, you have to find the line that explains it.",
    },
    {
      s: "P",
      text: "Here, the unmatched line is Dario Ferreira. I'll open his member record.",
      step: "Investigate the unmatched member line",
      at: 1.6,
      act: [
        { click: "ln-MR-77310" },
        { set: ["ln-MR-77310", { selected: true }] },
        {
          modal: {
            id: "member-modal",
            title: "Member MR-77310 · Dario Ferreira",
            icon: "user",
            width: 560,
            blocks: [
              {
                type: "detail",
                id: "member-detail",
                cols: 3,
                items: [
                  { label: "Employment status", value: "Leaver", chip: true },
                  { label: "Left employer", value: "12 Oct 2026" },
                  { label: "Last contribution", value: "September 2026" },
                  { label: "Employer", value: "Harbourline Logistics" },
                  { label: "Scheduled October", value: "M$ 500.00" },
                  { label: "Leaver notice", value: "Received 30 Oct" },
                ],
              },
              {
                type: "callout",
                id: "member-call",
                tone: "warn",
                text: "Member left before the October payroll. A contribution is not due for October.",
              },
            ],
            buttons: [
              { id: "btn-member-close", label: "Close" },
              {
                id: "btn-exclude",
                label: "Exclude line as leaver",
                kind: "primary",
              },
            ],
          },
        },
      ],
    },
    {
      s: "P",
      text: "See, he left the company on the twelfth of October. So the employer was right not to pay. The schedule is wrong, not the remittance.",
      at: 0.8,
      act: [{ point: "member-detail", fx: 0.25, fy: 0.3, hold: 1 }],
    },
    { s: "R", text: "And if he hadn't left? If he was still active?" },
    {
      s: "P",
      text: "Then it's an employer query. Actions, raise query, and the remittance sits in query status until they pay the difference. You do not post it.",
    },
    {
      s: "P",
      text: "Here I exclude the line as a leaver, and the variance drops to zero.",
      step: "Exclude the leaver's line from the schedule",
      at: 0.5,
      act: [
        { click: "btn-exclude" },
        { modal: null },
        {
          set: [
            "ln-MR-77310",
            {
              selected: false,
              neg: null,
              cells: {
                m: "MR-77310",
                n: "Dario Ferreira",
                s: "0.00",
                r: "0.00",
                st: "Excluded",
              },
            },
          ],
        },
        { set: ["kpi-sched", { value: "48,112.40" }] },
        { set: ["kpi-var", { value: "0.00", tone: "good" }] },
        { set: ["kpi-match", { value: "41 / 41", tone: "good" }] },
        { set: ["btn-post", { disabled: false }] },
        {
          toast: {
            title: "Schedule amended",
            text: "Line MR-77310 excluded. Variance now M$ 0.00.",
          },
        },
      ],
    },
    {
      s: "P",
      text: "One warning. Always fix the schedule before you post. Posting locks the period, and reversing it needs a ticket to Treasury and a second approver.",
    },
    {
      s: "P",
      text: "Now, post to member accounts, and confirm.",
      step: "Post the contributions to member accounts",
      at: 0.3,
      act: [
        { click: "btn-post" },
        {
          modal: {
            id: "post-modal",
            title: "Post contributions",
            icon: "swap",
            width: 500,
            blocks: [
              {
                type: "callout",
                id: "post-call",
                tone: "info",
                text: "Post 41 contributions totalling M$ 48,112.40 to member accounts for October 2026? The period will be locked.",
              },
            ],
            buttons: [
              { id: "btn-post-cancel", label: "Cancel" },
              {
                id: "btn-post-confirm",
                label: "Post 41 contributions",
                kind: "primary",
              },
            ],
          },
        },
        { wait: 0.4 },
        { click: "btn-post-confirm" },
        { modal: null },
        { set: ["detail", { chip: "Posted" }] },
        { set: ["btn-post", { disabled: true, label: "Posted" }] },
        {
          toast: {
            title: "Posted",
            text: "41 member accounts credited · M$ 48,112.40",
          },
        },
      ],
    },
    {
      s: "P",
      text: "Last thing. A note on the remittance, so the audit trail says why.",
      step: "Record a note explaining the variance",
      at: 0.6,
      act: [
        {
          type: "note-input",
          text: "MR-77310 excluded: left 12 Oct. Variance cleared.",
        },
        { click: "btn-addnote" },
        { blur: true },
        { set: ["note-input", { value: "" }] },
        {
          add: [
            "notes",
            {
              who: "C. Ashdown",
              when: "3 Nov 09:41",
              text: "MR-77310 excluded: left 12 Oct. Variance cleared.",
            },
          ],
        },
      ],
    },
    { s: "R", text: "Is there a deadline for posting October?" },
    {
      s: "P",
      text: "Third working day of the month. But I'm not sure of the exact cut-off time this quarter, so I'll confirm the cut-off with Treasury and send it to you.",
    },
    { s: "R", text: "Great, thanks. I'll do the two clean ones now." },
  ],
  decisions: [
    "If the variance is M$50 or less, accept it and record a note; if it is over M$50, find the member line that explains it.",
    "If the unmatched member has left the employer, exclude the line as a leaver; if the member is still active, raise an employer query from Actions and do not post until the employer pays the difference.",
  ],
  warnings: [
    "Always amend the schedule before posting: posting locks the period, and reversing it needs a Treasury ticket and a second approver.",
  ],
  openQuestions: [
    "The exact posting cut-off time this quarter (third working day): Corinne will confirm it with Treasury.",
  ],
};
