// Recalling an outgoing wire transfer, handed over on a call.
// Format: fixtures/process-transfer/README.md.

export default {
  slug: "wire-recall",
  title: "Recalling an outgoing wire",
  callTitle: "Handover: wire recall requests",
  callSub: "Payments Operations",
  agenda: "Agenda: Rafael shows Priya how to recall a wire sent in error.",
  timerOffset: 0,
  system: "PayOps",
  presenter: {
    name: "Rafael Quintero",
    role: "Senior Payments Officer",
    initials: "RQ",
    color: "#4a6a2f",
    voice: "bm_george",
    speed: 1.05,
  },
  receiver: {
    name: "Priya Castellane",
    role: "Payments Officer",
    initials: "PC",
    color: "#b0457c",
    voice: "af_nova",
    speed: 1.05,
  },
  ui: {
    appName: "PayOps",
    brand: "#2a2950",
    accent: "#7cd1c4",
    accent2: "#7cd1c4",
    soft: "#e9e8f7",
    userName: "R. Quintero",
    userInitials: "RQ",
    env: "PRODUCTION",
    nav: [
      { section: "Payments" },
      { id: "nav-out", label: "Outgoing wires", icon: "send" },
      { id: "nav-in", label: "Incoming wires", icon: "inbox" },
      { id: "nav-repair", label: "Repairs", icon: "settings", count: "4" },
      { section: "Investigations" },
      { id: "nav-cases", label: "Cases", icon: "flag", count: "6" },
      { id: "nav-msgs", label: "Messages", icon: "mail" },
      { id: "nav-limits", label: "Cut-offs", icon: "clock" },
    ],
    page: "out",
    pages: {
      out: {
        nav: "nav-out",
        crumbs: ["PayOps", "Outgoing wires"],
        title: "Outgoing wires",
        subtitle: "Today · 312 released · 4 in repair",
        blocks: [
          {
            type: "filters",
            id: "out-filters",
            fields: [
              {
                id: "f-ref",
                label: "Customer reference",
                placeholder: "Reference or beneficiary",
                kind: "text",
                w: 250,
                icon: "search",
              },
              {
                id: "f-date",
                label: "Value date",
                value: "04 Nov 2026",
                kind: "date",
                w: 160,
              },
              {
                id: "f-status",
                label: "Status",
                value: "Any",
                kind: "select",
                w: 130,
              },
            ],
            buttons: [
              {
                id: "btn-find",
                label: "Find",
                kind: "primary",
                icon: "search",
              },
            ],
          },
          {
            type: "table",
            id: "out-table",
            title: "Released today",
            columns: [
              { key: "id", label: "Payment", mono: true },
              { key: "ben", label: "Beneficiary" },
              { key: "amt", label: "Amount M$", align: "r" },
              { key: "time", label: "Released" },
              { key: "st", label: "Status", chip: true },
            ],
            rows: [
              {
                id: "w1",
                cells: {
                  id: "PAY-0081",
                  ben: "Saltmarsh Timber Co",
                  amt: "12,040.00",
                  time: "09:58",
                  st: "Completed",
                },
              },
              {
                id: "w2",
                cells: {
                  id: "PAY-0084",
                  ben: "Orrin & Daughters",
                  amt: "3,775.20",
                  time: "10:13",
                  st: "Completed",
                },
              },
              {
                id: "w3",
                cells: {
                  id: "PAY-0085",
                  ben: "Kestrel Freightways",
                  amt: "51,300.00",
                  time: "10:20",
                  st: "In progress",
                },
              },
              {
                id: "w4",
                cells: {
                  id: "PAY-0086",
                  ben: "Pellam Clinics",
                  amt: "8,912.65",
                  time: "10:31",
                  st: "Completed",
                },
              },
            ],
          },
        ],
      },
      pay: {
        id: "pay",
        nav: "nav-out",
        crumbs: ["PayOps", "Outgoing wires", "PAY-26-1104-0087"],
        title: "Wire PAY-26-1104-0087",
        subtitle: "Ordered by Nethercott Joinery Ltd",
        chip: "Sent",
        actions: [{ id: "btn-actions", label: "Actions", icon: "chev" }],
        blocks: [
          {
            type: "detail",
            id: "pay-detail",
            cols: 3,
            items: [
              { id: "p-amt", label: "Amount", value: "M$ 84,500.00" },
              {
                id: "p-ben",
                label: "Beneficiary",
                value: "Corvane Marine Supplies",
              },
              {
                id: "p-bank",
                label: "Beneficiary bank",
                value: "Bank of Estuary Isles",
              },
              { id: "p-acct", label: "Account", value: "EI-5530-0912-44" },
              { id: "p-ref", label: "Customer ref", value: "INV-5521" },
              { id: "p-time", label: "Released", value: "04 Nov 10:42" },
            ],
          },
          {
            type: "tabs",
            id: "pay-tabs",
            items: [
              { id: "tab-msg", label: "Message", on: true },
              { id: "tab-track", label: "Tracking" },
              { id: "tab-hist", label: "History" },
            ],
          },
          {
            type: "callout",
            id: "msg-view",
            tone: "info",
            text: "Payment message delivered to correspondent Halden Clearing Bank at 10:43. Charges: shared.",
          },
          {
            type: "table",
            id: "track",
            hidden: true,
            columns: [
              { key: "when", label: "Time" },
              { key: "who", label: "Party" },
              { key: "ev", label: "Event" },
              { key: "st", label: "Status", chip: true },
            ],
            rows: [
              {
                id: "tr1",
                cells: {
                  when: "10:42",
                  who: "Meridian Bank & Trust",
                  ev: "Released",
                  st: "Sent",
                },
              },
              {
                id: "tr2",
                cells: {
                  when: "10:43",
                  who: "Halden Clearing Bank",
                  ev: "Received by intermediary",
                  st: "Completed",
                },
              },
              {
                id: "tr3",
                cells: {
                  when: "10:51",
                  who: "Bank of Estuary Isles",
                  ev: "Awaiting credit to beneficiary",
                  st: "Pending",
                },
              },
            ],
          },
        ],
      },
      cases: {
        id: "cases",
        nav: "nav-cases",
        crumbs: ["PayOps", "Investigations", "Cases"],
        title: "Investigation cases",
        subtitle: "Recalls, traces and enquiries",
        blocks: [
          {
            type: "table",
            id: "case-table",
            title: "Open cases",
            columns: [
              { key: "id", label: "Case", mono: true },
              { key: "pay", label: "Payment", mono: true },
              { key: "type", label: "Type" },
              { key: "due", label: "Chase on" },
              { key: "st", label: "Status", chip: true },
            ],
            rows: [
              {
                id: "c1",
                cells: {
                  id: "INV-2207",
                  pay: "PAY-0032",
                  type: "Trace",
                  due: "05 Nov",
                  st: "Open",
                },
              },
              {
                id: "c2",
                cells: {
                  id: "INV-2211",
                  pay: "PAY-0058",
                  type: "Amendment",
                  due: "06 Nov",
                  st: "Awaiting",
                },
              },
            ],
          },
          {
            type: "form",
            id: "case-form",
            title: "Case details",
            cols: 2,
            fields: [
              {
                id: "cf-chase",
                label: "Chase on",
                placeholder: "dd Mmm",
                kind: "date",
              },
              {
                id: "cf-owner",
                label: "Owner",
                value: "Payments investigations",
                kind: "select",
              },
              {
                id: "cf-note",
                label: "Case note",
                placeholder: "What happened and what we asked for",
                kind: "textarea",
                span: 2,
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
      text: "So, the customer rings in. They've sent a wire to the wrong account, and they give you their reference. I put it in Outgoing wires and hit Find.",
      step: "Find the payment by the customer reference",
      at: 3.2,
      act: [
        { type: "f-ref", text: "INV-5521" },
        { click: "btn-find" },
        { loading: ["out-table", 0.7] },
        { wait: 0.7 },
        { set: ["w1", { hidden: true }] },
        { set: ["w2", { hidden: true }] },
        { set: ["w3", { hidden: true }] },
        { set: ["w4", { hidden: true }] },
        {
          add: [
            "out-table",
            {
              id: "w-hit",
              cells: {
                id: "PAY-0087",
                ben: "Corvane Marine Supplies",
                amt: "84,500.00",
                time: "10:42",
                st: "Sent",
              },
            },
          ],
        },
        { set: ["out-table", { title: "1 result" }] },
      ],
    },
    {
      s: "P",
      text: "There it is. Eighty four thousand five hundred, to Corvane Marine Supplies. I open it and go straight to the Tracking tab, to see where the money is.",
      step: "Open the payment and check its tracking status",
      at: 2.6,
      act: [
        { click: "w-hit" },
        { nav: "pay" },
        { wait: 0.6 },
        { click: "tab-track" },
        { set: ["tab-msg", { on: false }] },
        { set: ["tab-track", { on: true }] },
        { set: ["msg-view", { hidden: true }] },
        { set: ["track", { hidden: false }] },
        { wait: 0.4 },
        { point: "tr3", hold: 0.5 },
      ],
    },
    {
      s: "R",
      text: "How do I know if it's already been credited to the beneficiary?",
    },
    {
      s: "P",
      step: "Decide between cancellation and recall from the tracking status",
      text: "That last line. Here it's still pending at Bank of Estuary Isles. That's the decision point. If it's still pending, you send a cancellation, and it usually comes back. If it's already credited, it's a recall request. The beneficiary has to agree, and there's no guarantee.",
      at: 0.4,
      act: [{ point: "tr3", fx: 0.85, hold: 0.4 }],
    },
    {
      s: "P",
      text: "So, Actions, request recall. Reason is wrong beneficiary account, and I write a short message to the receiving bank.",
      step: "Send the recall message to the receiving bank",
      at: 0.4,
      act: [
        {
          pick: {
            anchor: "btn-actions",
            alignRight: true,
            items: [
              { id: "mi-trace", label: "Request trace" },
              { id: "mi-amend", label: "Request amendment" },
              { id: "mi-recall", label: "Request recall", danger: true },
              { id: "mi-copy", label: "Copy payment" },
            ],
            choose: "mi-recall",
          },
        },
        {
          modal: {
            id: "recall-modal",
            title: "Request recall · PAY-26-1104-0087",
            icon: "send",
            width: 560,
            blocks: [
              {
                type: "form",
                id: "recall-form",
                cols: 2,
                fields: [
                  {
                    id: "rc-reason",
                    label: "Reason",
                    placeholder: "Choose a reason",
                    kind: "select",
                  },
                  {
                    id: "rc-to",
                    label: "Send to",
                    value: "Bank of Estuary Isles",
                    kind: "readonly",
                  },
                  {
                    id: "rc-msg",
                    label: "Message to receiving bank",
                    placeholder: "Free text",
                    kind: "textarea",
                    span: 2,
                  },
                ],
              },
            ],
            buttons: [
              { id: "rc-cancel", label: "Cancel" },
              { id: "rc-send", label: "Send recall", kind: "dangerfill" },
            ],
          },
        },
        {
          select: {
            id: "rc-reason",
            options: [
              "Duplicate payment",
              "Wrong beneficiary account",
              "Fraud suspected",
              "Wrong amount",
            ],
            value: "Wrong beneficiary account",
          },
        },
        {
          type: "rc-msg",
          text: "Please return funds, wrong account. Ref INV-5521.",
        },
        { click: "rc-send" },
        { modal: null },
        { set: ["pay", { chip: "Recall sent" }] },
        {
          add: [
            "track",
            {
              id: "tr4",
              cells: {
                when: "14:06",
                who: "Meridian Bank & Trust",
                ev: "Recall request sent",
                st: "Recall sent",
              },
            },
          ],
        },
        {
          toast: {
            tone: "info",
            title: "Recall sent",
            text: "Recall RCL-26-3318 sent to Bank of Estuary Isles.",
          },
        },
      ],
    },
    {
      s: "P",
      text: "One warning. Do not send the corrected payment until the recall is confirmed. If you do, and the recall fails, the customer has paid twice.",
    },
    {
      s: "P",
      text: "Then I log a case, under Investigations, so it doesn't get lost.",
      step: "Log an investigation case for the recall",
      at: 0.6,
      act: [
        { click: "nav-cases" },
        { nav: "cases" },
        { wait: 0.4 },
        {
          add: [
            "case-table",
            {
              id: "c-new",
              selected: true,
              cells: {
                id: "INV-2219",
                pay: "PAY-0087",
                type: "Recall",
                due: "",
                st: "Recall sent",
              },
            },
            "start",
          ],
        },
        {
          toast: {
            title: "Case INV-2219 created",
            text: "Linked to PAY-26-1104-0087.",
          },
        },
      ],
    },
    {
      s: "P",
      text: "I set a chase date, two working days out, and add a note of what the customer told us.",
      step: "Set a chase date and add the case note",
      at: 0.4,
      act: [
        { type: "cf-chase", text: "06 Nov" },
        {
          set: [
            "c-new",
            {
              cells: {
                id: "INV-2219",
                pay: "PAY-0087",
                type: "Recall",
                due: "06 Nov",
                st: "Recall sent",
              },
            },
          ],
        },
        {
          type: "cf-note",
          text: "Customer called 13:55, wrong account. Recall sent 14:06.",
        },
        { blur: true },
      ],
    },
    { s: "R", text: "And if the customer asks how long it takes?" },
    {
      s: "P",
      text: "Tell them two to five working days, and that it isn't guaranteed. And there may be a fee. I think Estuary Isles charges for recalls, but I'm not sure how much. I'll check with the correspondent banking team.",
    },
    {
      s: "R",
      text: "Okay. Cancel if pending, recall if credited, and never resend early.",
    },
    { s: "P", text: "That's it exactly." },
  ],
  decisions: [
    "If the payment is still pending at the receiving bank, send a cancellation (it usually comes back); if it has already been credited to the beneficiary, send a recall request, which needs the beneficiary's consent and is not guaranteed.",
  ],
  warnings: [
    "Do not send the corrected payment until the recall is confirmed; if the recall fails, the customer will have paid twice.",
  ],
  openQuestions: [
    "Whether Bank of Estuary Isles charges a recall fee, and how much: Rafael will check with the correspondent banking team.",
  ],
};
