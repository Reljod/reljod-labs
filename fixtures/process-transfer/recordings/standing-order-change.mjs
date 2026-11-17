// Amending a standing order under dual approval, handed over on a call.
// Format: fixtures/process-transfer/README.md.

const field = (id, label, value, kind = "readonly") => ({
  id,
  label,
  value,
  kind,
});

export default {
  slug: "standing-order-change",
  title: "Amending a standing order",
  callTitle: "Handover: standing order amendments",
  callSub: "Payments Operations",
  agenda:
    "Agenda: show Grace how standing order amendments and dual approval work.",
  timerOffset: 0,
  system: "PayOps Mandates",
  presenter: {
    name: "Theo Vantongeren",
    role: "Payments Team Lead",
    initials: "TV",
    color: "#c0612b",
    voice: "am_liam",
    speed: 1.05,
  },
  receiver: {
    name: "Grace Imbali-Rowe",
    role: "Payments Officer",
    initials: "GI",
    color: "#3d6fb6",
    voice: "bf_emma",
    speed: 1.05,
  },
  ui: {
    appName: "PayOps Mandates",
    brand: "#134e3a",
    accent: "#7fd1ae",
    accent2: "#7fd1ae",
    soft: "#e3f3ec",
    userName: "T. Vantongeren",
    userInitials: "TV",
    env: "PRODUCTION",
    nav: [
      { section: "Payments" },
      { id: "nav-inbox", label: "Requests", icon: "inbox", count: "6" },
      { id: "nav-so", label: "Standing orders", icon: "clock" },
      { id: "nav-dd", label: "Direct debits", icon: "swap" },
      { id: "nav-approvals", label: "Approvals", icon: "check", count: "3" },
      { section: "Reference" },
      { id: "nav-mandates", label: "Mandates", icon: "file" },
      { id: "nav-reports", label: "Reports", icon: "chart" },
    ],
    page: "inbox",
    pages: {
      inbox: {
        id: "inbox",
        nav: "nav-inbox",
        crumbs: ["PayOps", "Requests inbox"],
        title: "Requests inbox",
        subtitle: "Customer instructions waiting for an officer · 24 Nov 2026",
        blocks: [
          {
            type: "kpis",
            id: "inbox-kpis",
            items: [
              { label: "Open requests", value: "6" },
              { label: "Due today", value: "2", tone: "warn" },
              { label: "Awaiting approval", value: "3" },
              { label: "Completed this week", value: "41", tone: "good" },
            ],
          },
          {
            type: "table",
            id: "inbox-table",
            title: "Open requests",
            columns: [
              { key: "ref", label: "Request", mono: true },
              { key: "cust", label: "Customer" },
              { key: "type", label: "Type" },
              { key: "rec", label: "Received" },
              { key: "st", label: "Status", chip: true },
            ],
            rows: [
              {
                id: "rq-1",
                cells: {
                  ref: "RQ-71840",
                  cust: "Halvard Brennick-Moss",
                  type: "Amend standing order",
                  rec: "24 Nov 08:12",
                  st: "New",
                },
              },
              {
                id: "rq-2",
                cells: {
                  ref: "RQ-71836",
                  cust: "Oriel Tanaka-Byrne",
                  type: "Cancel direct debit",
                  rec: "23 Nov 17:40",
                  st: "Open",
                },
              },
              {
                id: "rq-3",
                cells: {
                  ref: "RQ-71829",
                  cust: "Kestrel Joinery Ltd",
                  type: "New standing order",
                  rec: "23 Nov 14:05",
                  st: "Open",
                },
              },
              {
                id: "rq-4",
                cells: {
                  ref: "RQ-71811",
                  cust: "Bastien Lowry",
                  type: "Amend standing order",
                  rec: "22 Nov 10:31",
                  st: "Awaiting",
                },
              },
              {
                id: "rq-5",
                cells: {
                  ref: "RQ-71802",
                  cust: "Marisol Achterberg",
                  type: "Change payee",
                  rec: "21 Nov 16:22",
                  st: "Due",
                },
              },
            ],
          },
        ],
      },
      so: {
        id: "so",
        nav: "nav-so",
        crumbs: ["PayOps", "Standing orders", "SO-55102"],
        title: "SO-55102 · Rent",
        subtitle: "Halvard Brennick-Moss · acct 0417-228-391",
        chip: "Active",
        actions: [
          { id: "btn-mandate", label: "View mandate", icon: "file" },
          {
            id: "btn-amend",
            label: "Amend",
            kind: "primary",
            icon: "settings",
          },
        ],
        blocks: [
          {
            type: "callout",
            id: "so-threshold",
            tone: "warn",
            hidden: true,
            title: "Dual approval required.",
            text: "New amount M$ 2,600.00 is above the M$ 2,500.00 threshold. A second approver must approve this change.",
          },
          {
            type: "row",
            blocks: [
              {
                type: "form",
                id: "so-form",
                title: "Standing order",
                flex: 1.45,
                cols: 2,
                fields: [
                  field("f-payee", "Payee", "Calderwood Lettings"),
                  field("f-payacct", "Payee account", "0522-910-447"),
                  field("f-amount", "Amount M$", "1,450.00"),
                  field("f-day", "Payment day", "1st of month"),
                  field("f-next", "Next payment", "1 Dec 2026"),
                  field("f-ref", "Reference", "FLAT 4 RENT"),
                ],
              },
              {
                type: "notes",
                id: "so-notes",
                title: "Customer messages",
                flex: 1,
                items: [
                  {
                    who: "H. Brennick-Moss",
                    when: "24 Nov 08:12",
                    text: "Please raise my rent payment to 2,600 and move it to the 5th. Thanks.",
                  },
                ],
                composer: {
                  id: "msg-input",
                  placeholder: "Reply to customer…",
                  kind: "textarea",
                },
                buttons: [
                  {
                    id: "btn-send",
                    label: "Send secure message",
                    icon: "send",
                  },
                ],
              },
            ],
          },
        ],
      },
      approvals: {
        id: "approvals",
        nav: "nav-approvals",
        crumbs: ["PayOps", "Approvals"],
        title: "Approvals",
        subtitle: "Changes waiting for a second approver",
        blocks: [
          {
            type: "table",
            id: "appr-table",
            title: "Submitted by me",
            columns: [
              { key: "ref", label: "Item", mono: true },
              { key: "what", label: "Change" },
              { key: "amt", label: "Amount M$", align: "r" },
              { key: "who", label: "Approver" },
              { key: "st", label: "Status", chip: true },
            ],
            rows: [
              {
                id: "ap-1",
                cells: {
                  ref: "SO-55102",
                  what: "Amount and payment day",
                  amt: "2,600.00",
                  who: "I. Duarte-Vale",
                  st: "Pending",
                },
              },
              {
                id: "ap-2",
                cells: {
                  ref: "SO-54977",
                  what: "New payee",
                  amt: "3,150.00",
                  who: "P. Okwuosa",
                  st: "Approved",
                },
              },
              {
                id: "ap-3",
                cells: {
                  ref: "DD-20114",
                  what: "Cancel mandate",
                  amt: "—",
                  who: "I. Duarte-Vale",
                  st: "Approved",
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
      text: "Right, so standing order changes land in this inbox. This one is from Halvard Brennick-Moss. He wants to change his rent payment, so I open the request.",
      step: "Open the amendment request from the inbox",
      at: 3.4,
      act: [{ point: "rq-1", hold: 0.8 }, { click: "rq-1" }, { nav: "so" }],
    },
    {
      s: "P",
      text: "It's standing order five five one zero two, to Calderwood Lettings. He wants it to go from fourteen hundred and fifty, up to two thousand six hundred, and move from the first of the month to the fifth.",
      at: 1.2,
      act: [
        { point: "f-payee", hold: 2.2 },
        { point: "f-amount", hold: 3.2 },
        { point: "f-day", hold: 1 },
      ],
    },
    { s: "R", text: "So do we just change it straight away?" },
    {
      s: "P",
      text: "Not yet. First you check the mandate, to make sure the person asking is actually allowed to change it.",
      step: "Verify the account mandate and signatory",
      at: 2.4,
      act: [
        { click: "btn-mandate" },
        {
          modal: {
            id: "mandate-modal",
            title: "Mandate · current account 0417-228-391",
            icon: "file",
            width: 560,
            blocks: [
              {
                type: "detail",
                id: "mandate-detail",
                cols: 3,
                items: [
                  { label: "Account type", value: "Sole" },
                  { label: "Signing rule", value: "Any one to sign" },
                  { label: "Signatory", value: "H. Brennick-Moss" },
                  { label: "Instruction channel", value: "Secure message" },
                  {
                    label: "Two-factor sign-in",
                    value: "Verified",
                    chip: true,
                  },
                  { label: "Mandate review", value: "Current", chip: true },
                ],
              },
            ],
            buttons: [
              { id: "btn-mandate-close", label: "Close", kind: "primary" },
            ],
          },
        },
      ],
    },
    {
      s: "P",
      text: "Sole account, sole signatory, and he sent the message after a two factor sign in, so we're fine. If it's a joint account where both have to sign, you need the second holder's consent before you touch anything.",
      at: 0.8,
      act: [
        { point: "mandate-detail", fx: 0.2, fy: 0.25, hold: 2.5 },
        { point: "mandate-detail", fx: 0.5, fy: 0.8 },
      ],
    },
    { s: "R", text: "And if he had phoned it in, instead of a message?" },
    {
      s: "P",
      text: "Then you do a call back on the number we hold. Never the number they called from. Okay, close that, and click amend.",
      step: "Open the amendment form",
      at: 3.6,
      act: [
        { click: "btn-mandate-close" },
        { modal: null },
        { wait: 0.3 },
        { click: "btn-amend" },
        { set: ["f-amount", { kind: "text" }] },
        { set: ["f-day", { kind: "select" }] },
        { set: ["so", { chip: "Draft" }] },
        {
          set: [
            "btn-amend",
            { label: "Submit for approval", icon: "send", disabled: true },
          ],
        },
      ],
    },
    {
      s: "P",
      text: "New amount, two thousand six hundred. And the payment day is now the fifth.",
      step: "Enter the new amount and payment day",
      at: 0.3,
      act: [
        { type: "f-amount", text: "2,600.00" },
        { blur: true },
        {
          select: {
            id: "f-day",
            options: [
              "1st of month",
              "5th of month",
              "15th of month",
              "Last working day",
            ],
            value: "5th of month",
          },
        },
        { set: ["f-next", { value: "5 Dec 2026" }] },
        { set: ["so-threshold", { hidden: false }] },
        { set: ["btn-amend", { disabled: false }] },
      ],
    },
    {
      s: "P",
      text: "See the yellow banner? Anything above two and a half thousand needs a second approver. If it's under that, you just save it, and you're done.",
      at: 0.4,
      act: [{ point: "so-threshold", fx: 0.5, fy: 0.5, hold: 1 }],
    },
    {
      s: "P",
      text: "So I submit it for approval, and pick an approver from the team.",
      step: "Submit the amendment for dual approval",
      at: 0.6,
      act: [
        { click: "btn-amend" },
        {
          modal: {
            id: "approval-modal",
            title: "Submit for approval",
            icon: "send",
            width: 500,
            blocks: [
              {
                type: "form",
                id: "approval-form",
                cols: 1,
                fields: [
                  {
                    id: "f-approver",
                    label: "Second approver",
                    placeholder: "Choose an approver",
                    kind: "select",
                  },
                  {
                    id: "f-summary",
                    label: "Change",
                    value: "Amount 1,450.00 → 2,600.00 · day 1st → 5th",
                    kind: "readonly",
                  },
                ],
              },
            ],
            buttons: [
              { id: "btn-approval-cancel", label: "Cancel" },
              { id: "btn-approval-submit", label: "Submit", kind: "primary" },
            ],
          },
        },
        { wait: 0.3 },
        {
          select: {
            id: "f-approver",
            options: [
              "Ines Duarte-Vale",
              "Paschal Okwuosa",
              "Theo Vantongeren (you)",
            ],
            value: "Ines Duarte-Vale",
          },
        },
        { click: "btn-approval-submit" },
        { modal: null },
        { set: ["so", { chip: "Pending approval" }] },
        { set: ["btn-amend", { label: "Submitted", disabled: true }] },
        {
          toast: {
            tone: "info",
            title: "Sent for approval",
            text: "SO-55102 is waiting for Ines Duarte-Vale.",
          },
        },
      ],
    },
    {
      s: "R",
      text: "Could I approve my own amendments, if nobody else is around?",
    },
    {
      s: "P",
      text: "No, the system blocks it. And watch out for this one. If the next payment is less than two working days away, the payment file is already built, so the change only lands the month after. Tell the customer, or they'll pay the old amount.",
    },
    {
      s: "P",
      text: "Ines said she'd approve it straight away, so let's look at the approvals queue.",
      step: {
        title: "Second approver approves the amendment",
        actor: "Ines Duarte-Vale",
      },
      at: 1.2,
      act: [
        { click: "nav-approvals" },
        { nav: "approvals" },
        { wait: 1.6 },
        {
          set: [
            "ap-1",
            {
              flash: true,
              cells: {
                ref: "SO-55102",
                what: "Amount and payment day",
                amt: "2,600.00",
                who: "I. Duarte-Vale",
                st: "Approved",
              },
            },
          ],
        },
        {
          toast: {
            title: "Approved by I. Duarte-Vale",
            text: "SO-55102 · new amount applies from 5 Dec 2026.",
          },
        },
      ],
    },
    {
      s: "P",
      text: "There it is. Last step, a secure message to the customer, confirming the new amount and the date.",
      step: "Confirm the change to the customer by secure message",
      at: 2.2,
      act: [
        { click: "ap-1" },
        { set: ["so", { chip: "Active" }] },
        { set: ["so-threshold", { hidden: true }] },
        { set: ["f-amount", { kind: "readonly" }] },
        { set: ["f-day", { kind: "readonly" }] },
        {
          set: [
            "btn-amend",
            { label: "Amend", icon: "settings", disabled: false },
          ],
        },
        { nav: "so" },
        { wait: 0.4 },
        {
          type: "msg-input",
          text: "Done: M$ 2,600.00 on the 5th, from 5 Dec.",
          cps: 16,
        },
        { click: "btn-send" },
        { blur: true },
        { set: ["msg-input", { value: "" }] },
        {
          add: [
            "so-notes",
            {
              who: "T. Vantongeren",
              when: "24 Nov 09:20",
              text: "Done: M$ 2,600.00 on the 5th, from 5 Dec.",
            },
          ],
        },
        {
          toast: {
            title: "Secure message sent",
            text: "Request RQ-71840 closed.",
          },
        },
      ],
    },
    {
      s: "R",
      text: "What if they only change the date? Does that need two people as well?",
    },
    {
      s: "P",
      text: "Good question. Honestly, I'm not sure when the amount is under the threshold. I'll confirm that with Operational Risk, and let you know.",
    },
    { s: "R", text: "Perfect. Thanks, Theo." },
  ],
  decisions: [
    "If the account is joint and both holders must sign, get the second holder's consent before amending; a sole signatory can instruct alone.",
    "If the instruction came by phone, call the customer back on the number held on file (never the number they called from) before acting.",
    "If the new amount is above M$2,500, submit the amendment for a second approver; under the threshold, save it directly.",
  ],
  warnings: [
    "You cannot approve your own amendment; the system blocks it.",
    "If the next payment is less than two working days away, the payment file is already built and the change only applies the following month, so tell the customer or they will pay the old amount.",
  ],
  openQuestions: [
    "Whether a payment-date-only change under the threshold needs dual approval: Theo will confirm with Operational Risk.",
  ],
};
