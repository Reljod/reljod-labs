// Provisioning core-banking user access, handed over on a call.
// Format: fixtures/process-transfer/README.md.

export default {
  slug: "user-access-request",
  title: "Provisioning core-banking access",
  callTitle: "Handover: core-banking access requests",
  callSub: "IT Security · Identity & Access",
  agenda:
    "Agenda: Victor hands the access request queue to Ruben for the next quarter.",
  timerOffset: 0,
  system: "Access Hub",
  presenter: {
    name: "Victor Halloran",
    role: "Access Management Engineer",
    initials: "VH",
    color: "#5a6abf",
    voice: "bm_fable",
    speed: 1.05,
  },
  receiver: {
    name: "Ruben Arkwright",
    role: "Access Administrator",
    initials: "RA",
    color: "#a8433a",
    voice: "am_eric",
    speed: 1.05,
  },
  ui: {
    appName: "Access Hub",
    brand: "#263238",
    accent: "#4fc3f7",
    accent2: "#4fc3f7",
    soft: "#e3f2fd",
    userName: "V. Halloran",
    userInitials: "VH",
    env: "PRODUCTION",
    nav: [
      { section: "Requests" },
      { id: "nav-tickets", label: "Tickets", icon: "inbox", count: "5" },
      { id: "nav-users", label: "Users", icon: "users" },
      { id: "nav-roles", label: "Role matrix", icon: "key" },
      { id: "nav-sod", label: "SoD rules", icon: "shield" },
      { section: "Audit" },
      { id: "nav-recert", label: "Recertification", icon: "refresh" },
      { id: "nav-log", label: "Change log", icon: "list" },
    ],
    page: "tickets",
    pages: {
      tickets: {
        id: "tickets",
        nav: "nav-tickets",
        crumbs: ["Access Hub", "Access tickets"],
        title: "Access tickets",
        subtitle: "Requests for CoreLedger and connected systems",
        blocks: [
          {
            type: "kpis",
            id: "t-kpis",
            items: [
              { label: "Open tickets", value: "5" },
              { label: "Breaching SLA today", value: "1", tone: "bad" },
              { label: "Waiting on approver", value: "2", tone: "warn" },
              { label: "Closed this month", value: "64", tone: "good" },
            ],
          },
          {
            type: "table",
            id: "t-table",
            title: "Open tickets",
            columns: [
              { key: "id", label: "Ticket", mono: true },
              { key: "user", label: "User" },
              { key: "kind", label: "Request" },
              { key: "sys", label: "System" },
              { key: "st", label: "Status", chip: true },
            ],
            rows: [
              {
                id: "tk-1",
                cells: {
                  id: "ACC-30418",
                  user: "Mira Tolland",
                  kind: "Mover: new roles",
                  sys: "CoreLedger",
                  st: "New",
                },
              },
              {
                id: "tk-2",
                cells: {
                  id: "ACC-30415",
                  user: "Osric Benbow",
                  kind: "Leaver: revoke",
                  sys: "All systems",
                  st: "Overdue",
                },
              },
              {
                id: "tk-3",
                cells: {
                  id: "ACC-30409",
                  user: "Hana Wilbraham",
                  kind: "Joiner",
                  sys: "CoreLedger",
                  st: "Awaiting",
                },
              },
              {
                id: "tk-4",
                cells: {
                  id: "ACC-30402",
                  user: "Pell Ardagh",
                  kind: "Extra role",
                  sys: "PayOps",
                  st: "Awaiting",
                },
              },
              {
                id: "tk-5",
                cells: {
                  id: "ACC-30397",
                  user: "Cato Ferrand",
                  kind: "Password reset",
                  sys: "CoreLedger",
                  st: "Open",
                },
              },
            ],
          },
        ],
      },
      ticket: {
        id: "ticket",
        nav: "nav-tickets",
        crumbs: ["Access Hub", "Access tickets", "ACC-30418"],
        title: "ACC-30418 · Mira Tolland",
        subtitle: "Mover: Payments → Trade Finance · 25 Nov",
        chip: "New",
        actions: [
          { id: "btn-sod", label: "Run SoD check", icon: "shield" },
          {
            id: "btn-approve",
            label: "Approve & provision",
            kind: "primary",
            icon: "check",
            disabled: true,
          },
        ],
        blocks: [
          {
            type: "detail",
            id: "t-detail",
            cols: 4,
            items: [
              { label: "User ID", value: "MTOLLAND" },
              { label: "New department", value: "Trade Finance" },
              { label: "Line manager", value: "B. Achebe-Strand" },
              {
                id: "mgr-appr",
                label: "Manager approval",
                value: "Approved",
                chip: true,
              },
            ],
          },
          {
            type: "callout",
            id: "sod-result",
            tone: "bad",
            hidden: true,
            title: "SoD conflict.",
            text: "Payments Maker + Payments Checker on the same user lets one person create and release a payment.",
          },
          {
            type: "table",
            id: "roles",
            title: "CoreLedger roles",
            meta: "Trade Finance role matrix",
            columns: [
              { key: "role", label: "Role" },
              { key: "src", label: "Source" },
              { key: "mx", label: "In matrix?" },
              { key: "st", label: "Status", chip: true },
            ],
            rows: [
              {
                id: "r-tfm",
                cells: {
                  role: "TF Maker",
                  src: "Requested",
                  mx: "—",
                  st: "Requested",
                },
              },
              {
                id: "r-tfv",
                cells: {
                  role: "TF Viewer",
                  src: "Requested",
                  mx: "—",
                  st: "Requested",
                },
              },
              {
                id: "r-pm",
                cells: {
                  role: "Payments Maker",
                  src: "Requested",
                  mx: "—",
                  st: "Requested",
                },
              },
              {
                id: "r-pc",
                cells: {
                  role: "Payments Checker",
                  src: "Current (old team)",
                  mx: "—",
                  st: "Active",
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
      text: "So, access tickets. This one is a mover. Mira Tolland is moving from Payments into Trade Finance, and she wants new roles in CoreLedger.",
      step: "Open the access ticket",
      at: 3.0,
      act: [{ point: "tk-1", hold: 0.8 }, { click: "tk-1" }, { nav: "ticket" }],
    },
    {
      s: "P",
      text: "First check, her line manager has approved it. You see that here. No approval, no access. You send it back.",
      step: "Confirm the line manager's approval",
      at: 1.2,
      act: [
        { point: "mgr-appr", hold: 1.2 },
        { set: ["mgr-appr", { value: "Approved 23 Nov" }] },
      ],
    },
    {
      s: "P",
      text: "Next, the role matrix for Trade Finance. TF maker, yes, that's in the matrix. TF viewer, yes. Payments maker, no. It isn't a Trade Finance role at all.",
      step: "Check each requested role against the role matrix",
      at: 2.4,
      act: [
        { point: "r-tfm", hold: 0.8 },
        {
          set: [
            "r-tfm",
            {
              cells: {
                role: "TF Maker",
                src: "Requested",
                mx: "Yes",
                st: "Requested",
              },
            },
          ],
        },
        { wait: 1.2 },
        { point: "r-tfv", hold: 0.6 },
        {
          set: [
            "r-tfv",
            {
              cells: {
                role: "TF Viewer",
                src: "Requested",
                mx: "Yes",
                st: "Requested",
              },
            },
          ],
        },
        { wait: 0.9 },
        { point: "r-pm", hold: 0.6 },
        {
          set: [
            "r-pm",
            {
              cells: {
                role: "Payments Maker",
                src: "Requested",
                mx: "No",
                st: "Requested",
              },
              neg: "mx",
            },
          ],
        },
      ],
    },
    { s: "R", text: "So what happens to a role that isn't in the matrix?" },
    {
      s: "P",
      text: "If a role isn't in the matrix for her department, you don't grant it. It needs an exception, signed off by the role owner. If it is in the matrix, you carry on. Now the segregation of duties check.",
      step: "Run the segregation-of-duties check",
      at: 9.0,
      act: [
        { click: "btn-sod" },
        { loading: ["roles", 1.0] },
        { wait: 1.0 },
        { set: ["sod-result", { hidden: false }] },
        {
          set: [
            "r-pc",
            {
              cells: {
                role: "Payments Checker",
                src: "Current (old team)",
                mx: "No",
                st: "Conflict",
              },
            },
          ],
        },
        {
          set: [
            "r-pm",
            {
              cells: {
                role: "Payments Maker",
                src: "Requested",
                mx: "No",
                st: "Conflict",
              },
            },
          ],
        },
        { set: ["ticket", { chip: "Blocked" }] },
        {
          toast: {
            tone: "bad",
            title: "SoD check failed",
            text: "1 conflict: Payments Maker with Payments Checker.",
          },
        },
      ],
    },
    {
      s: "P",
      text: "And there's the problem. She still has payments checker from her old team. Maker plus checker means one person could create and release a payment. You never grant both.",
      at: 1.4,
      act: [
        { point: "sod-result", fx: 0.5, fy: 0.5, hold: 1 },
        { point: "r-pc", hold: 0.6 },
      ],
    },
    {
      s: "P",
      text: "So I reject payments maker, and remove her old checker role, because she's leaving that team anyway.",
      step: "Reject the conflicting role and remove the old one",
      at: 0.6,
      act: [
        { click: "r-pm" },
        { set: ["r-pm", { selected: true }] },
        {
          modal: {
            id: "pm-modal",
            title: "Payments Maker · requested",
            icon: "key",
            width: 480,
            blocks: [
              {
                type: "callout",
                id: "pm-call",
                tone: "bad",
                text: "Not in the Trade Finance matrix, and conflicts with Payments Checker.",
              },
            ],
            buttons: [
              { id: "btn-pm-exc", label: "Request exception" },
              { id: "btn-pm-reject", label: "Reject role", kind: "dangerfill" },
            ],
          },
        },
        { wait: 0.4 },
        { click: "btn-pm-reject" },
        { modal: null },
        {
          set: [
            "r-pm",
            {
              selected: false,
              neg: null,
              cells: {
                role: "Payments Maker",
                src: "Requested",
                mx: "No",
                st: "Rejected",
              },
            },
          ],
        },
        { click: "r-pc" },
        { set: ["r-pc", { selected: true }] },
        {
          modal: {
            id: "pc-modal",
            title: "Payments Checker · current",
            icon: "key",
            width: 480,
            blocks: [
              {
                type: "callout",
                id: "pc-call",
                tone: "warn",
                text: "Held from the Payments team. Not in the Trade Finance matrix.",
              },
            ],
            buttons: [
              { id: "btn-pc-keep", label: "Keep for 30 days" },
              { id: "btn-pc-remove", label: "Remove role", kind: "dangerfill" },
            ],
          },
        },
        { wait: 0.4 },
        { click: "btn-pc-remove" },
        { modal: null },
        {
          set: [
            "r-pc",
            {
              selected: false,
              cells: {
                role: "Payments Checker",
                src: "Current (old team)",
                mx: "No",
                st: "Removed",
              },
            },
          ],
        },
        {
          set: [
            "sod-result",
            {
              tone: "good",
              title: "SoD check passed.",
              text: "No conflicting roles remain on MTOLLAND.",
            },
          ],
        },
        { set: ["ticket", { chip: "In review" }] },
        { set: ["btn-approve", { disabled: false }] },
      ],
    },
    {
      s: "R",
      text: "Does she lose the old role today, even if she's still finishing work in Payments?",
    },
    {
      s: "P",
      text: "She does. And a warning: never copy another user's profile to save time. You inherit all their old roles, and that's how these conflicts creep in.",
    },
    {
      s: "P",
      text: "Now, approve and provision.",
      step: "Approve and provision the roles in CoreLedger",
      at: 0.3,
      act: [
        { click: "btn-approve" },
        {
          modal: {
            id: "prov-modal",
            title: "Provision in CoreLedger",
            icon: "key",
            width: 520,
            blocks: [
              {
                type: "detail",
                id: "prov-detail",
                cols: 2,
                items: [
                  { label: "Grant", value: "TF Maker, TF Viewer" },
                  { label: "Remove", value: "Payments Checker" },
                  { label: "Rejected", value: "Payments Maker" },
                  { label: "Effective", value: "25 Nov 2026 07:00" },
                ],
              },
            ],
            buttons: [
              { id: "btn-prov-cancel", label: "Cancel" },
              { id: "btn-prov-go", label: "Provision", kind: "primary" },
            ],
          },
        },
        { wait: 0.6 },
        { click: "btn-prov-go" },
        { modal: null },
        {
          set: [
            "r-tfm",
            {
              cells: {
                role: "TF Maker",
                src: "Requested",
                mx: "Yes",
                st: "Granted",
              },
            },
          ],
        },
        {
          set: [
            "r-tfv",
            {
              cells: {
                role: "TF Viewer",
                src: "Requested",
                mx: "Yes",
                st: "Granted",
              },
            },
          ],
        },
        { set: ["ticket", { chip: "Completed" }] },
        { set: ["btn-approve", { label: "Provisioned", disabled: true }] },
        {
          toast: {
            title: "Provisioned in CoreLedger",
            text: "2 roles granted, 1 removed for MTOLLAND.",
          },
        },
        { point: "r-tfm", fx: 0.85, hold: 1.4 },
      ],
    },
    {
      s: "P",
      text: "Last step, the ticket goes back to her manager with what was granted, and what was rejected and why.",
      step: "Confirm the outcome to the requester and close the ticket",
      at: 1.0,
      act: [
        { click: "nav-tickets" },
        {
          set: [
            "tk-1",
            {
              flash: true,
              cells: {
                id: "ACC-30418",
                user: "Mira Tolland",
                kind: "Mover: new roles",
                sys: "CoreLedger",
                st: "Resolved",
              },
            },
          ],
        },
        { nav: "tickets" },
        {
          toast: {
            tone: "info",
            title: "Confirmation sent",
            text: "B. Achebe-Strand notified: 2 granted, 1 rejected (SoD).",
          },
        },
      ],
    },
    {
      s: "R",
      text: "What if she really needs the payments role for a week or two, during handover?",
    },
    {
      s: "P",
      text: "Temporary access might be allowed, but I'm not sure on what terms. I'll confirm with the Payments role owner, and add it to the runbook.",
    },
    { s: "R", text: "Great. I'll pick up the leaver ticket next." },
  ],
  decisions: [
    "If the line manager has not approved the request, send it back; do not grant access.",
    "If a requested role is not in the role matrix for the user's department, do not grant it without an exception signed off by the role owner; if it is in the matrix, continue.",
    "If the segregation-of-duties check finds a conflict, never grant both roles: reject the conflicting role or remove the old one first.",
  ],
  warnings: [
    "Never copy another user's profile to save time: you inherit all their old roles, which is how SoD conflicts creep in.",
  ],
  openQuestions: [
    "Whether temporary payments access is allowed during a mover's handover period, and on what terms: Victor will confirm with the Payments role owner.",
  ],
};
