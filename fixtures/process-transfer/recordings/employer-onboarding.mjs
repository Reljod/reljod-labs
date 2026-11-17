// Onboarding a new employer to the pension plan, handed over on a call.
// Format: fixtures/process-transfer/README.md.

export default {
  slug: "employer-onboarding",
  title: "Onboarding a new employer",
  callTitle: "Handover: new employer onboarding",
  callSub: "Employer Relations",
  agenda:
    "Agenda: Halima walks Owen through setting up a new participating employer.",
  timerOffset: 0,
  system: "Employer Hub",
  presenter: {
    name: "Halima Strand",
    role: "Employer Relations Manager",
    initials: "HS",
    color: "#a1489a",
    voice: "af_bella",
    speed: 1.05,
  },
  receiver: {
    name: "Owen Tregarth",
    role: "Onboarding Analyst",
    initials: "OT",
    color: "#c47f17",
    voice: "bm_lewis",
    speed: 1.05,
  },
  ui: {
    appName: "Employer Hub",
    brand: "#1d5c3a",
    accent: "#e8d36a",
    accent2: "#e8d36a",
    soft: "#e3f2e9",
    userName: "H. Strand",
    userInitials: "HS",
    env: "PRODUCTION",
    nav: [
      { section: "Plan" },
      { id: "nav-employers", label: "Employers", icon: "bank" },
      { id: "nav-onboard", label: "Onboarding", icon: "plus", count: "3" },
      { id: "nav-rates", label: "Rate tables", icon: "chart" },
      { id: "nav-docs", label: "Documents", icon: "file" },
      { section: "Comms" },
      { id: "nav-packs", label: "Welcome packs", icon: "mail" },
      { id: "nav-portal", label: "Portal users", icon: "users" },
    ],
    page: "list",
    pages: {
      list: {
        nav: "nav-onboard",
        crumbs: ["Employer Hub", "Onboarding"],
        title: "Onboarding",
        subtitle: "Employers joining the Meridian Workplace Pension Plan",
        actions: [
          {
            id: "btn-new",
            label: "New employer",
            kind: "primary",
            icon: "plus",
          },
        ],
        blocks: [
          {
            type: "kpis",
            id: "ob-kpis",
            items: [
              { label: "In onboarding", value: "3" },
              { label: "Waiting on documents", value: "2", tone: "warn" },
              { label: "Went live this month", value: "5", tone: "good" },
            ],
          },
          {
            type: "table",
            id: "ob-table",
            title: "Employers in onboarding",
            columns: [
              { key: "name", label: "Employer" },
              { key: "reg", label: "Registration", mono: true },
              { key: "staff", label: "Staff", align: "r" },
              { key: "st", label: "Status", chip: true },
            ],
            rows: [
              {
                id: "o1",
                cells: {
                  name: "Brindle Hill Bakeries",
                  reg: "MRC-2015-11873",
                  staff: "64",
                  st: "Awaiting",
                },
              },
              {
                id: "o2",
                cells: {
                  name: "Lanternfield Studios",
                  reg: "MRC-2021-00412",
                  staff: "18",
                  st: "Missing",
                },
              },
              {
                id: "o3",
                cells: {
                  name: "Port Selene Ferries",
                  reg: "MRC-2008-07720",
                  staff: "212",
                  st: "In review",
                },
              },
            ],
          },
        ],
      },
      new: {
        nav: "nav-onboard",
        crumbs: ["Employer Hub", "Onboarding", "New employer"],
        title: "New employer",
        subtitle: "Step 1 of 3 · company details",
        blocks: [
          {
            type: "form",
            id: "new-form",
            title: "Company details",
            cols: 2,
            fields: [
              {
                id: "n-name",
                label: "Legal name",
                placeholder: "As on the certificate",
                kind: "text",
                span: 2,
              },
              {
                id: "n-reg",
                label: "Registration number",
                placeholder: "MRC-YYYY-NNNNN",
                kind: "text",
              },
              {
                id: "n-staff",
                label: "Eligible staff",
                placeholder: "0",
                kind: "text",
              },
              {
                id: "n-sector",
                label: "Sector",
                placeholder: "Choose a sector",
                kind: "select",
              },
              {
                id: "n-freq",
                label: "Payroll frequency",
                placeholder: "Choose",
                kind: "select",
              },
            ],
          },
          {
            type: "buttons",
            id: "new-buttons",
            items: [
              { id: "n-cancel", label: "Cancel" },
              { id: "n-save", label: "Create employer", kind: "primary" },
            ],
          },
        ],
      },
      emp: {
        id: "emp",
        nav: "nav-onboard",
        crumbs: ["Employer Hub", "Employers", "EMP-30418"],
        title: "Tidewater Ceramics Ltd",
        subtitle: "EMP-30418 · Manufacturing · monthly payroll",
        chip: "Draft",
        actions: [
          {
            id: "btn-pack",
            label: "Send welcome pack",
            icon: "mail",
            disabled: true,
          },
        ],
        blocks: [
          {
            type: "row",
            blocks: [
              {
                type: "docs",
                id: "docs",
                title: "Onboarding documents",
                meta: "0 of 3",
                flex: 1.1,
                items: [],
                drop: "Drop the employer's documents here",
              },
              {
                type: "form",
                id: "rates",
                title: "Contribution rates",
                flex: 1,
                cols: 2,
                fields: [
                  {
                    id: "r-er",
                    label: "Employer %",
                    placeholder: "0.0",
                    kind: "text",
                    hint: "Statutory min. 5.0",
                  },
                  {
                    id: "r-ee",
                    label: "Employee %",
                    placeholder: "0.0",
                    kind: "text",
                    hint: "Statutory min. 3.0",
                  },
                  {
                    id: "r-from",
                    label: "Effective from",
                    placeholder: "Choose a date",
                    kind: "select",
                    span: 2,
                  },
                ],
              },
            ],
          },
          {
            type: "buttons",
            id: "emp-buttons",
            items: [
              {
                id: "btn-saverates",
                label: "Save rates and activate",
                kind: "primary",
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
      text: "Okay. A new employer has signed up to the plan. In Employer Hub, I go to Onboarding and click New employer.",
      step: "Start a new employer record",
      at: 2.2,
      act: [{ click: "btn-new" }, { nav: "new" }],
    },
    {
      s: "P",
      text: "Legal name exactly as it is on the certificate of incorporation. Tidewater Ceramics Limited. Then the registration number, the staff count, the sector and the payroll frequency.",
      step: "Enter the company details and create the employer",
      at: 0.8,
      act: [
        { type: "n-name", text: "Tidewater Ceramics Ltd" },
        { type: "n-reg", text: "MRC-2019-04417" },
        { type: "n-staff", text: "47" },
        {
          select: {
            id: "n-sector",
            options: ["Construction", "Hospitality", "Manufacturing", "Retail"],
            value: "Manufacturing",
          },
        },
        {
          select: {
            id: "n-freq",
            options: ["Weekly", "Fortnightly", "Monthly"],
            value: "Monthly",
          },
        },
        { click: "n-save" },
        { nav: "emp" },
        {
          toast: {
            title: "Employer created",
            text: "EMP-30418 Tidewater Ceramics Ltd, status Draft.",
          },
        },
      ],
    },
    { s: "R", text: "Does the name have to match exactly? Even the Limited?" },
    {
      s: "P",
      text: "Yes, exactly, because the contributions bank account is checked against it. Next, the documents. Certificate of incorporation, the signed participation agreement, and their authorised signatory list.",
      step: "Upload the onboarding documents",
      at: 5.4,
      act: [
        { point: "docs-drop", hold: 0.5 },
        { loading: ["docs", 0.9] },
        { wait: 0.9 },
        {
          add: [
            "docs",
            {
              id: "doc-cert",
              name: "Certificate of incorporation",
              meta: "PDF · 2 pages",
              status: "Received",
            },
          ],
        },
        {
          add: [
            "docs",
            {
              id: "doc-agree",
              name: "Participation agreement",
              meta: "Signed by M. Oduya",
              status: "Received",
            },
          ],
        },
        {
          add: [
            "docs",
            {
              id: "doc-sig",
              name: "Authorised signatories",
              meta: "3 names",
              status: "Received",
            },
          ],
        },
        { set: ["docs", { meta: "3 of 3" }] },
      ],
    },
    {
      s: "P",
      text: "Now the check that matters. The person who signed the agreement must be on the signatory list. If they are, you mark the documents verified. If they're not, you stop, and send the agreement back for a proper signature.",
      step: "Check the agreement signer against the signatory list",
      at: 1.6,
      act: [
        { point: "doc-agree", hold: 1.6 },
        { point: "doc-sig", hold: 1.4 },
        { set: ["doc-cert", { status: "Verified" }] },
        { set: ["doc-agree", { status: "Verified" }] },
        { set: ["doc-sig", { status: "Verified" }] },
        {
          toast: {
            title: "Documents verified",
            text: "Signer M. Oduya is on the signatory list.",
          },
        },
      ],
    },
    {
      s: "P",
      text: "Then the contribution rates. Employer six percent, employee five percent, starting the first of December.",
      step: "Set the contribution rates and effective date",
      at: 1.0,
      act: [
        { type: "r-er", text: "6.0" },
        { type: "r-ee", text: "5.0" },
        {
          select: {
            id: "r-from",
            options: ["1 November 2026", "1 December 2026", "1 January 2027"],
            value: "1 December 2026",
          },
        },
      ],
    },
    { s: "R", text: "What if they ask for a lower employer rate?" },
    {
      s: "P",
      text: "Anything under the statutory minimum of five percent, you reject. Five or above, you just take what they signed for.",
    },
    {
      s: "P",
      text: "Save rates and activate. The status goes from draft to active.",
      step: "Save the rates and activate the employer",
      at: 0.4,
      act: [
        { click: "btn-saverates" },
        { set: ["emp", { chip: "Active" }] },
        { set: ["btn-saverates", { label: "Rates saved", disabled: true }] },
        { set: ["btn-pack", { disabled: false, kind: "primary" }] },
        {
          toast: {
            title: "Employer active",
            text: "Rates 6.0% and 5.0% from 1 Dec 2026.",
          },
        },
      ],
    },
    {
      s: "P",
      text: "A warning. Never send the welcome pack before the rates are saved. The schedule template in the pack is built from the rates, so it goes out blank.",
    },
    {
      s: "P",
      text: "Now, send welcome pack. Portal logins, the schedule template, and the payment instructions. Send.",
      step: "Send the welcome pack",
      at: 0.4,
      act: [
        { click: "btn-pack" },
        {
          modal: {
            id: "pack-modal",
            title: "Send welcome pack",
            icon: "mail",
            width: 500,
            blocks: [
              {
                type: "checklist",
                id: "pack-list",
                items: [
                  {
                    id: "pk-portal",
                    label: "Portal logins for 2 payroll contacts",
                    checked: false,
                  },
                  {
                    id: "pk-sched",
                    label: "Contribution schedule template",
                    checked: false,
                  },
                  {
                    id: "pk-pay",
                    label: "Payment instructions and account",
                    checked: false,
                  },
                ],
              },
              {
                type: "detail",
                id: "pack-to",
                cols: 1,
                items: [
                  {
                    label: "Send to",
                    value: "payroll@tidewater-ceramics.example",
                  },
                ],
              },
            ],
            buttons: [
              { id: "pk-cancel", label: "Cancel" },
              { id: "pk-send", label: "Send pack", kind: "primary" },
            ],
          },
        },
        { check: "pk-portal" },
        { check: "pk-sched" },
        { check: "pk-pay" },
        { click: "pk-send" },
        { modal: null },
        { set: ["btn-pack", { label: "Pack sent", disabled: true }] },
        {
          toast: {
            title: "Welcome pack sent",
            text: "Emailed to payroll@tidewater-ceramics.example.",
          },
        },
      ],
    },
    {
      s: "R",
      text: "They start mid-month though. Do they pay a part month for December?",
    },
    {
      s: "P",
      text: "I believe it's a full month, but I want to be sure. I'll confirm the first contribution rule for mid-month starters with Compliance.",
    },
    { s: "R", text: "Okay, I'll set up Brindle Hill the same way." },
  ],
  decisions: [
    "If the person who signed the participation agreement is on the authorised signatory list, mark the documents verified; if not, stop and send the agreement back for a proper signature.",
    "If the employer asks for an employer rate below the statutory minimum of 5%, reject it; at 5% or above, use the rate they signed for.",
  ],
  warnings: [
    "Never send the welcome pack before the rates are saved: the schedule template in the pack is built from the rates and would go out blank.",
  ],
  openQuestions: [
    "Whether a mid-month starter pays a full or part first month: Halima will confirm the first-contribution rule with Compliance.",
  ],
};
