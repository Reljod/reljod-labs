// Handling a card chargeback dispute, handed over on a call.
// Format: fixtures/process-transfer/README.md.

export default {
  slug: "chargeback-dispute",
  title: "Handling a chargeback dispute",
  callTitle: "Handover: card disputes desk",
  callSub: "Cards Operations",
  agenda:
    "Agenda: Marcus hands the disputes queue to Ana Lucia for the next two weeks.",
  timerOffset: 0,
  system: "CardCase",
  presenter: {
    name: "Marcus Bellweather",
    role: "Disputes Team Lead",
    initials: "MB",
    color: "#2e6fa3",
    voice: "am_puck",
    speed: 1.05,
  },
  receiver: {
    name: "Ana Lucia Ferro",
    role: "Disputes Analyst",
    initials: "AF",
    color: "#b5532f",
    voice: "bf_isabella",
    speed: 1.05,
  },
  ui: {
    appName: "CardCase",
    brand: "#7a1f2b",
    accent: "#f4b860",
    accent2: "#f4b860",
    soft: "#f8e7e9",
    userName: "M. Bellweather",
    userInitials: "MB",
    env: "PRODUCTION",
    nav: [
      { section: "Disputes" },
      { id: "nav-inbox", label: "New claims", icon: "inbox", count: "5" },
      { id: "nav-cases", label: "My cases", icon: "flag" },
      { id: "nav-deadlines", label: "Deadlines", icon: "clock" },
      { section: "Cards" },
      { id: "nav-cards", label: "Card lookup", icon: "card" },
      { id: "nav-merchants", label: "Merchants", icon: "bank" },
      { id: "nav-reports", label: "Reports", icon: "chart" },
    ],
    page: "inbox",
    pages: {
      inbox: {
        nav: "nav-inbox",
        crumbs: ["CardCase", "New claims"],
        title: "New claims",
        subtitle: "Cardholder disputes received from branches, app and phone",
        blocks: [
          {
            type: "kpis",
            id: "in-kpis",
            items: [
              { label: "New today", value: "5" },
              { label: "Open cases", value: "38" },
              { label: "Deadline in 5 days", value: "4", tone: "bad" },
            ],
          },
          {
            type: "table",
            id: "claims",
            title: "Unassigned",
            columns: [
              { key: "id", label: "Claim", mono: true },
              { key: "card", label: "Card" },
              { key: "mer", label: "Merchant" },
              { key: "amt", label: "Amount M$", align: "r" },
              { key: "st", label: "Status", chip: true },
            ],
            rows: [
              {
                id: "cl1",
                cells: {
                  id: "CLM-6610",
                  card: "•• 4471",
                  mer: "Lumen Grove Electronics",
                  amt: "1,249.00",
                  st: "New",
                },
              },
              {
                id: "cl2",
                cells: {
                  id: "CLM-6611",
                  card: "•• 9023",
                  mer: "Saltpan Air",
                  amt: "386.40",
                  st: "New",
                },
              },
              {
                id: "cl3",
                cells: {
                  id: "CLM-6614",
                  card: "•• 1187",
                  mer: "Fernhollow Hotel",
                  amt: "2,910.00",
                  st: "New",
                },
              },
              {
                id: "cl4",
                cells: {
                  id: "CLM-6615",
                  card: "•• 5562",
                  mer: "Quayside Fitness",
                  amt: "45.00",
                  st: "New",
                },
              },
            ],
          },
        ],
      },
      case: {
        id: "case",
        nav: "nav-cases",
        crumbs: ["CardCase", "Claims", "CLM-6610"],
        title: "Claim CLM-6610",
        subtitle: "Ilse Marchetti-Dunn · card ending 4471",
        chip: "New",
        actions: [
          { id: "btn-open", label: "Open case", kind: "primary" },
          { id: "btn-credit", label: "Provisional credit", disabled: true },
          { id: "btn-send", label: "Send chargeback", disabled: true },
        ],
        blocks: [
          {
            type: "detail",
            id: "txn",
            title: "Disputed transaction",
            cols: 4,
            items: [
              { id: "t-mer", label: "Merchant", value: "Lumen Grove Elec." },
              { id: "t-amt", label: "Amount", value: "M$ 1,249.00" },
              { id: "t-date", label: "Purchased", value: "19 Oct 2026" },
              { id: "t-claim", label: "Claim", value: "Not delivered" },
            ],
          },
          {
            type: "row",
            blocks: [
              {
                type: "form",
                id: "case-form",
                title: "Case",
                flex: 1.1,
                cols: 2,
                fields: [
                  {
                    id: "c-reason",
                    label: "Reason code",
                    placeholder: "Choose a reason code",
                    kind: "select",
                    span: 2,
                  },
                  {
                    id: "c-contact",
                    label: "Contacted merchant?",
                    value: "Yes · 28 Oct, no reply",
                    kind: "readonly",
                    span: 2,
                  },
                  {
                    id: "c-case",
                    label: "Case number",
                    value: "Not opened",
                    kind: "readonly",
                  },
                  {
                    id: "c-credit",
                    label: "Provisional credit",
                    value: "None",
                    kind: "readonly",
                  },
                ],
              },
              {
                type: "meter",
                id: "deadline",
                title: "Evidence deadline",
                flex: 1,
                value: 0,
                label: "Not started",
                color: "#7a8497",
                text: "The clock starts when the chargeback is sent to the merchant's bank.",
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
      text: "Okay, so new claims land here in CardCase. Today's first one is a customer who never got a laptop from Lumen Grove Electronics. I'll open it.",
      step: "Pick up the new claim from the queue",
      at: 4.6,
      act: [{ point: "cl1", hold: 0.6 }, { click: "cl1" }, { nav: "case" }],
    },
    {
      s: "P",
      text: "First, check the transaction matches the claim. Twelve hundred and forty nine dollars, the nineteenth of October, and the customer says it never arrived.",
      step: "Check the disputed transaction against the claim",
      at: 1.2,
      act: [
        { point: "t-amt", hold: 2.0 },
        { point: "t-date", hold: 1.6 },
        { point: "t-claim", hold: 0.6 },
      ],
    },
    {
      s: "P",
      text: "Then, Open case. That gives it a case number, and starts our side of the clock.",
      step: "Open a dispute case",
      at: 0.4,
      act: [
        { click: "btn-open" },
        { set: ["case", { chip: "Open" }] },
        { set: ["c-case", { value: "DSP-26-04471" }] },
        { set: ["btn-open", { label: "Case open", kind: "", disabled: true }] },
        {
          toast: {
            tone: "info",
            title: "Case DSP-26-04471 opened",
            text: "Assigned to M. Bellweather.",
          },
        },
      ],
    },
    {
      s: "P",
      text: "Now the reason code. She contacted the merchant on the twenty eighth and got no reply, so it's goods not received.",
      step: "Choose the reason code",
      at: 0.6,
      act: [
        { point: "c-contact", hold: 1.6 },
        {
          select: {
            id: "c-reason",
            options: [
              "GNR-01 Goods or services not received",
              "NAD-02 Not as described",
              "DUP-03 Duplicate charge",
              "FRD-04 Not authorised",
            ],
            value: "GNR-01 Goods or services not received",
          },
        },
        { set: ["btn-credit", { disabled: false, kind: "primary" }] },
      ],
    },
    { s: "R", text: "And if she hadn't contacted the merchant yet?" },
    {
      s: "P",
      text: "Then you don't raise a chargeback. You ask her to contact the merchant first, and park the case as on hold for ten days. Only if they ignore her do you come back and pick the code.",
    },
    {
      s: "P",
      text: "Next, provisional credit. Under fifteen hundred dollars, we credit her straight away. Above that, I have to sign it off as team lead.",
      step: "Give the cardholder provisional credit",
      at: 4.4,
      act: [
        { click: "btn-credit" },
        {
          modal: {
            id: "credit-modal",
            title: "Provisional credit",
            icon: "card",
            width: 500,
            blocks: [
              {
                type: "detail",
                id: "cr-detail",
                cols: 2,
                items: [
                  { label: "Amount", value: "M$ 1,249.00" },
                  { label: "Authority", value: "Analyst (under M$ 1,500)" },
                ],
              },
              {
                type: "callout",
                id: "cr-call",
                tone: "warn",
                text: "Reversed from the cardholder if the dispute is lost.",
              },
            ],
            buttons: [
              { id: "cr-cancel", label: "Cancel" },
              { id: "cr-post", label: "Credit M$ 1,249.00", kind: "primary" },
            ],
          },
        },
        { wait: 0.5 },
        { click: "cr-post" },
        { modal: null },
        { set: ["c-credit", { value: "M$ 1,249.00 · 3 Nov" }] },
        { set: ["case", { chip: "Provisional" }] },
        {
          set: ["btn-credit", { disabled: true, kind: "", label: "Credited" }],
        },
        { set: ["btn-send", { disabled: false, kind: "primary" }] },
        {
          toast: {
            title: "Provisional credit posted",
            text: "M$ 1,249.00 credited to card ending 4471.",
          },
        },
      ],
    },
    {
      s: "P",
      text: "Then, send chargeback to the merchant's bank. And look, the evidence deadline starts. Thirty days, so the third of December.",
      step: "Send the chargeback and start the evidence deadline",
      at: 0.4,
      act: [
        { click: "btn-send" },
        { loading: ["deadline", 0.6] },
        { wait: 0.6 },
        {
          set: [
            "deadline",
            {
              value: 100,
              label: "30 days",
              color: "#1d7a46",
              text: "Merchant's bank must answer by 3 Dec 2026. Then we review their evidence.",
            },
          ],
        },
        { set: ["case", { chip: "Chargeback sent" }] },
        { set: ["btn-send", { label: "Sent", kind: "", disabled: true }] },
        {
          toast: {
            title: "Chargeback sent",
            text: "To Lumen Grove's bank. Evidence due 3 Dec 2026.",
          },
        },
        { wait: 0.6 },
        { point: "deadline", hold: 0.6 },
      ],
    },
    {
      s: "P",
      text: "Watch this deadline. If the merchant sends evidence and we miss our reply window, the scheme sides with the merchant, and the provisional credit is taken back from the customer. That's a horrible call to make.",
    },
    { s: "R", text: "Is that thirty calendar days, or working days?" },
    {
      s: "P",
      text: "Calendar, I think, but the scheme rules changed this year. I'll confirm with the scheme liaison team and update the deadline setting if it's wrong.",
    },
    {
      s: "P",
      text: "Last thing, a reminder five days before the deadline, under Deadlines.",
      step: "Set a reminder before the evidence deadline",
      at: 0.4,
      act: [
        { click: "deadline" },
        {
          set: [
            "deadline",
            {
              text: "Merchant's bank must answer by 3 Dec 2026. Reminder set for 28 Nov.",
            },
          ],
        },
        {
          toast: {
            tone: "info",
            title: "Reminder set",
            text: "28 Nov 2026, 5 days before the deadline.",
          },
        },
      ],
    },
    { s: "R", text: "Got it. I'll take the Saltpan Air one next." },
  ],
  decisions: [
    "If the cardholder has already contacted the merchant, choose the reason code (goods not received) and raise the chargeback; if not, ask them to contact the merchant first and put the case on hold for ten days.",
    "If the disputed amount is under M$1,500, give provisional credit straight away; above that, the team lead must sign it off.",
  ],
  warnings: [
    "Watch the evidence deadline: if the reply window is missed, the scheme sides with the merchant and the provisional credit is reversed from the customer.",
  ],
  openQuestions: [
    "Whether the 30-day evidence deadline is calendar or working days under this year's scheme rules: Marcus will confirm with the scheme liaison team.",
  ],
};
