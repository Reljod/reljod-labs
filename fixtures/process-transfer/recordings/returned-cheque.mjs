// Processing a returned cheque, handed over on a call.
// Format: fixtures/process-transfer/README.md.

const ret = (id, chq, cust, amt, code) => ({
  id,
  cells: { chq, cust, amt, code, st: "New" },
});

export default {
  slug: "returned-cheque",
  title: "Processing a returned cheque",
  callTitle: "Handover: inward cheque returns",
  callSub: "Clearing",
  agenda: "Agenda: Margot walks Samira through today's returned cheques.",
  timerOffset: 0,
  system: "Clearing Desk",
  presenter: {
    name: "Margot Pellew",
    role: "Clearing Supervisor",
    initials: "MP",
    color: "#2f7a8c",
    voice: "af_nicole",
    speed: 1.2,
  },
  receiver: {
    name: "Samira Achterberg",
    role: "Clearing Clerk",
    initials: "SA",
    color: "#a0507a",
    voice: "bf_emma",
    speed: 1.05,
  },
  ui: {
    appName: "Clearing Desk",
    brand: "#7a2331",
    accent: "#f0b37e",
    accent2: "#f0b37e",
    soft: "#f8e9ea",
    userName: "M. Pellew",
    userInitials: "MP",
    env: "PRODUCTION",
    nav: [
      { section: "Cheques" },
      { id: "nav-in", label: "Inward clearing", icon: "inbox" },
      { id: "nav-ret", label: "Returns", icon: "refresh", count: "4" },
      { id: "nav-out", label: "Outward returns", icon: "send" },
      { id: "nav-stop", label: "Stop payments", icon: "x" },
      { section: "Customers" },
      { id: "nav-fees", label: "Fees & waivers", icon: "card" },
      { id: "nav-letters", label: "Letters", icon: "mail" },
    ],
    page: "inbox",
    pages: {
      inbox: {
        nav: "nav-ret",
        crumbs: ["Clearing Desk", "Inward returns"],
        title: "Inward returns",
        subtitle: "Returns file from Meridia Interbank Clearing · 14 Nov 2026",
        actions: [
          {
            id: "btn-loadfile",
            label: "Load returns file",
            kind: "primary",
            icon: "upload",
          },
        ],
        blocks: [
          {
            type: "kpis",
            id: "in-kpis",
            items: [
              { id: "k-files", label: "Files today", value: "0" },
              { id: "k-items", label: "Returned items", value: "0" },
              { id: "k-value", label: "Value M$", value: "0.00" },
              { label: "Cut-off", value: "15:00" },
            ],
          },
          {
            type: "table",
            id: "returns",
            title: "Returned cheques",
            empty: "No returns file loaded yet today.",
            columns: [
              { key: "chq", label: "Cheque", mono: true },
              { key: "cust", label: "Paid in by" },
              { key: "amt", label: "Amount M$", align: "r" },
              { key: "code", label: "Reason" },
              { key: "st", label: "Status", chip: true },
            ],
            rows: [],
          },
        ],
      },
      item: {
        id: "item",
        nav: "nav-ret",
        crumbs: ["Clearing Desk", "Inward returns", "Cheque 004417"],
        title: "Cheque 004417",
        subtitle: "Brightwater Bakery · 0021-558-904",
        chip: "New",
        actions: [
          { id: "btn-reverse", label: "Reverse credit", icon: "swap" },
          { id: "btn-fee", label: "Charge fee", icon: "card" },
          { id: "btn-notify", label: "Notify", icon: "mail" },
          {
            id: "btn-complete",
            label: "Complete",
            kind: "primary",
            disabled: true,
          },
        ],
        blocks: [
          {
            type: "detail",
            id: "chq",
            cols: 4,
            items: [
              { id: "d-amt", label: "Amount", value: "M$ 3,860.00" },
              { id: "d-dep", label: "Paid in", value: "10 Nov 2026" },
              {
                id: "d-drawer",
                label: "Drawn on",
                value: "Harrowgate Savings",
              },
              { id: "d-prev", label: "Returns, 12 mo.", value: "1 (June)" },
            ],
          },
          {
            type: "callout",
            id: "reason",
            tone: "bad",
            title: "Reason R01:",
            text: "Refer to drawer · insufficient funds",
          },
          {
            type: "row",
            blocks: [
              {
                type: "table",
                id: "post",
                title: "Account postings",
                flex: 1.7,
                columns: [
                  { key: "d", label: "Date" },
                  { key: "x", label: "Description" },
                  { key: "a", label: "Amount", align: "r" },
                  { key: "b", label: "Balance", align: "r" },
                ],
                rows: [
                  {
                    id: "p1",
                    cells: {
                      d: "10 Nov",
                      x: "Cheque deposit 004417",
                      a: "+3,860.00",
                      b: "5,212.95",
                    },
                  },
                  {
                    id: "p2",
                    cells: {
                      d: "11 Nov",
                      x: "Flour supplier",
                      a: "−2,140.00",
                      b: "3,072.95",
                    },
                  },
                  {
                    id: "p3",
                    cells: {
                      d: "13 Nov",
                      x: "Card takings",
                      a: "+967.60",
                      b: "4,040.55",
                    },
                  },
                ],
              },
              {
                type: "checklist",
                id: "steps",
                title: "Return checklist",
                flex: 1,
                items: [
                  { id: "ck-rev", label: "Credit reversed", checked: false },
                  { id: "ck-fee", label: "Fee charged", checked: false },
                  {
                    id: "ck-notify",
                    label: "Customer notified",
                    checked: false,
                  },
                  { id: "ck-img", label: "Cheque image saved", checked: false },
                ],
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
      text: "Okay. This is the Clearing Desk. Returned cheques come in on the clearing house returns file, around eleven. I load that first.",
      step: "Load the inward returns file",
      at: 3.2,
      act: [
        { click: "btn-loadfile" },
        { loading: ["returns", 1.0] },
        { wait: 1.0 },
        {
          add: [
            "returns",
            ret(
              "r1",
              "004417",
              "Brightwater Bakery",
              "3,860.00",
              "R01 Insufficient funds",
            ),
          ],
        },
        {
          add: [
            "returns",
            ret(
              "r2",
              "118802",
              "Lumen Tile Works",
              "1,275.00",
              "R08 Stale date",
            ),
          ],
        },
        {
          add: [
            "returns",
            ret("r3", "560031", "Petra Vandersloot", "420.00", "R03 Stopped"),
          ],
        },
        {
          add: [
            "returns",
            ret(
              "r4",
              "009146",
              "Coastline Motors",
              "12,600.00",
              "R05 No endorsement",
            ),
          ],
        },
        { set: ["k-files", { value: "1" }] },
        { set: ["k-items", { value: "4", tone: "warn" }] },
        { set: ["k-value", { value: "18,155.00" }] },
        {
          toast: {
            tone: "info",
            title: "Returns file loaded",
            text: "4 items · M$ 18,155.00",
          },
        },
      ],
    },
    {
      s: "P",
      text: "Four today. I'll take the first one, Brightwater Bakery.",
      step: "Open the first returned cheque",
      at: 0.9,
      act: [{ click: "r1" }, { nav: "item" }],
    },
    {
      s: "P",
      text: "Cheque four four one seven. Three thousand, eight hundred and sixty, paid in on the tenth. It came back with reason R zero one, refer to drawer. Insufficient funds.",
      step: "Check the amount and the return reason",
      at: 0.5,
      act: [
        { point: "d-amt", hold: 2.4 },
        { point: "d-dep", hold: 1.6 },
        { point: "reason", fx: 0.3, hold: 1.0 },
      ],
    },
    { s: "R", text: "Is it always reverse and charge?" },
    {
      s: "P",
      text: "No. A technical return, like a missing endorsement or a stale date, you re-present once, with no fee. Insufficient funds, or a stopped cheque, like this one, you reverse the credit and charge the fee.",
    },
    {
      s: "P",
      text: "So. Reverse credit. It takes the full three thousand, eight hundred and sixty back off the account.",
      step: "Reverse the full credit from the customer's account",
      at: 0.4,
      act: [
        { click: "btn-reverse" },
        {
          modal: {
            id: "rev-modal",
            title: "Reverse cheque credit",
            icon: "swap",
            width: 500,
            blocks: [
              {
                type: "detail",
                id: "rev-detail",
                cols: 2,
                items: [
                  { label: "Reverse", value: "M$ 3,860.00" },
                  { label: "Account", value: "0021-558-904" },
                  { label: "Balance now", value: "M$ 4,040.55" },
                  { label: "Balance after", value: "M$ 180.55" },
                ],
              },
            ],
            buttons: [
              { id: "btn-rev-cancel", label: "Cancel" },
              {
                id: "btn-rev-ok",
                label: "Reverse M$ 3,860.00",
                kind: "primary",
              },
            ],
          },
        },
        { wait: 0.5 },
        { click: "btn-rev-ok" },
        { modal: null },
        {
          add: [
            "post",
            {
              id: "p4",
              flash: true,
              cells: {
                d: "14 Nov",
                x: "Returned cheque 004417",
                a: "−3,860.00",
                b: "180.55",
              },
            },
          ],
        },
        { set: ["ck-rev", { checked: true }] },
        { set: ["item", { chip: "In progress" }] },
        {
          toast: {
            title: "Credit reversed",
            text: "M$ 3,860.00 debited from 0021-558-904",
          },
        },
      ],
    },
    {
      s: "P",
      text: "A warning here. Always reverse the full amount, even if it takes them overdrawn. Never part reverse, or you leave a break for Treasury.",
    },
    {
      s: "P",
      text: "Next, the returned cheque fee. Fee code R C F, twenty five dollars.",
      step: "Charge the returned-cheque fee",
      at: 0.4,
      act: [
        { click: "btn-fee" },
        {
          modal: {
            id: "fee-modal",
            title: "Charge fee",
            icon: "card",
            width: 480,
            blocks: [
              {
                type: "form",
                id: "fee-form",
                cols: 2,
                fields: [
                  {
                    id: "fee-code",
                    label: "Fee code",
                    kind: "select",
                    placeholder: "Choose a fee",
                  },
                  {
                    id: "fee-amt",
                    label: "Amount",
                    kind: "readonly",
                    placeholder: "—",
                  },
                  {
                    id: "fee-waive",
                    label: "Request fee waiver",
                    kind: "check",
                    checked: false,
                    span: 2,
                  },
                ],
              },
            ],
            buttons: [
              { id: "btn-fee-cancel", label: "Cancel" },
              { id: "btn-fee-ok", label: "Charge fee", kind: "primary" },
            ],
          },
        },
        {
          select: {
            id: "fee-code",
            options: [
              "RCF · Returned cheque",
              "SPF · Stop payment",
              "CCF · Cheque copy",
            ],
            value: "RCF · Returned cheque",
          },
        },
        { set: ["fee-amt", { value: "M$ 25.00" }] },
        { wait: 0.4 },
        { click: "btn-fee-ok" },
        { modal: null },
        { set: ["p4", { flash: false }] },
        {
          add: [
            "post",
            {
              id: "p5",
              flash: true,
              cells: {
                d: "14 Nov",
                x: "Returned cheque fee RCF",
                a: "−25.00",
                b: "155.55",
              },
            },
          ],
        },
        { set: ["ck-fee", { checked: true }] },
        { toast: { title: "Fee charged", text: "RCF · M$ 25.00" } },
      ],
    },
    { s: "R", text: "Do we ever waive the fee?" },
    {
      s: "P",
      text: "Only with my approval, and only for a first return in twelve months. They had one in June, so, no.",
      at: 2.8,
      act: [{ point: "d-prev", hold: 0.8 }],
    },
    {
      s: "P",
      text: "Then we tell the customer. Returned cheque, insufficient funds. Secure message, and letter.",
      step: "Notify the customer",
      at: 0.4,
      act: [
        { click: "btn-notify" },
        {
          modal: {
            id: "n-modal",
            title: "Notify customer",
            icon: "mail",
            width: 540,
            blocks: [
              {
                type: "form",
                id: "n-form",
                cols: 2,
                fields: [
                  {
                    id: "n-tpl",
                    label: "Template",
                    kind: "select",
                    placeholder: "Choose a template",
                  },
                  {
                    id: "n-ch",
                    label: "Channel",
                    kind: "select",
                    placeholder: "Choose",
                  },
                ],
              },
              {
                type: "callout",
                id: "n-prev",
                tone: "info",
                text: "Preview: cheque 004417 for M$ 3,860.00 was returned unpaid (insufficient funds). A fee of M$ 25.00 has been charged.",
              },
            ],
            buttons: [
              { id: "btn-n-cancel", label: "Cancel" },
              {
                id: "btn-n-send",
                label: "Send",
                kind: "primary",
                icon: "send",
              },
            ],
          },
        },
        {
          select: {
            id: "n-tpl",
            options: [
              "Returned cheque · technical",
              "Returned cheque · insufficient funds",
              "Stop payment confirmed",
            ],
            value: "Returned cheque · insufficient funds",
          },
        },
        {
          select: {
            id: "n-ch",
            options: [
              "Secure message",
              "Secure message + letter",
              "Letter only",
            ],
            value: "Secure message + letter",
          },
        },
        { click: "btn-n-send" },
        { modal: null },
        { set: ["ck-notify", { checked: true }] },
        {
          toast: {
            tone: "info",
            title: "Customer notified",
            text: "Secure message sent · letter queued for 15 Nov",
          },
        },
      ],
    },
    {
      s: "P",
      text: "Finally, tick the last box, and complete. The original cheque goes in the returns tray.",
      step: "Tick off the checklist and complete the return",
      at: 1.0,
      act: [
        { check: "ck-img" },
        { set: ["btn-complete", { disabled: false }] },
        { click: "btn-complete" },
        { set: ["item", { chip: "Completed" }] },
        { set: ["btn-complete", { disabled: true, label: "Completed" }] },
        {
          toast: {
            title: "Return completed",
            text: "Cheque 004417 · 1 of 4 done",
          },
        },
      ],
    },
    {
      s: "P",
      text: "One thing I still need to check. Do returns after the three o'clock cut-off go in today's batch, or tomorrow's? I'll confirm that with our clearing house liaison.",
    },
    { s: "R", text: "Thanks. I'll do the other three." },
  ],
  decisions: [
    "If the return is technical (e.g. missing endorsement or stale date), re-present the cheque once with no fee; if it is insufficient funds or a stopped cheque, reverse the credit and charge the returned-cheque fee.",
    "Waive the fee only with the supervisor's approval and only for a first return in twelve months; this customer had a return in June, so no waiver.",
  ],
  warnings: [
    "Always reverse the full amount, even if it takes the customer overdrawn; never part-reverse, because a partial reversal leaves a break for Treasury.",
  ],
  openQuestions: [
    "Whether returns arriving after the 15:00 cut-off go into today's or tomorrow's batch: Margot will confirm with the clearing house liaison.",
  ],
};
