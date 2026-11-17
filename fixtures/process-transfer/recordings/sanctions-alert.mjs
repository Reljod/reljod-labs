// Dispositioning a sanctions screening alert, handed over on a call.
// Format: fixtures/process-transfer/README.md. The watchlist entry is invented.

const cmp = (id, label, a, b) => ({ id, label, a, b, result: null });

export default {
  slug: "sanctions-alert",
  title: "Dispositioning a sanctions alert",
  callTitle: "Handover: payment screening alerts",
  callSub: "Financial Crime Compliance",
  agenda:
    "Agenda: Arjun shadows Nadia on the payment screening queue before taking it over.",
  timerOffset: 0,
  system: "ScreenGuard",
  presenter: {
    name: "Nadia Corvell",
    role: "Financial Crime Analyst",
    initials: "NC",
    color: "#b5476b",
    voice: "bf_lily",
    speed: 1.05,
  },
  receiver: {
    name: "Arjun Pellegrini",
    role: "Screening Analyst",
    initials: "AP",
    color: "#4a7f3a",
    voice: "am_fenrir",
    speed: 1.05,
  },
  ui: {
    appName: "ScreenGuard",
    brand: "#3b2a5c",
    accent: "#ff9e6b",
    accent2: "#ff9e6b",
    soft: "#efe9f8",
    userName: "N. Corvell",
    userInitials: "NC",
    env: "PRODUCTION",
    nav: [
      { section: "Screening" },
      { id: "nav-alerts", label: "Alert queue", icon: "bell", count: "14" },
      { id: "nav-cases", label: "Escalations", icon: "flag" },
      { id: "nav-lists", label: "Watchlists", icon: "shield" },
      { id: "nav-good", label: "Good-guy list", icon: "check" },
      { section: "Oversight" },
      { id: "nav-qa", label: "QA sampling", icon: "list" },
      { id: "nav-mi", label: "MI dashboard", icon: "chart" },
    ],
    page: "queue",
    pages: {
      queue: {
        id: "queue",
        nav: "nav-alerts",
        crumbs: ["ScreenGuard", "Alert queue"],
        title: "Payment screening alerts",
        subtitle: "Outgoing payments held for review · oldest first",
        blocks: [
          {
            type: "filters",
            id: "q-filters",
            fields: [
              {
                id: "f-src",
                label: "Source",
                value: "Outgoing payments",
                kind: "select",
                w: 200,
              },
              {
                id: "f-list",
                label: "List",
                value: "All lists",
                kind: "select",
                w: 180,
              },
              {
                id: "f-sla",
                label: "SLA",
                value: "Due in 4h",
                kind: "select",
                w: 150,
              },
            ],
            buttons: [{ id: "btn-refresh", label: "Refresh", icon: "refresh" }],
          },
          {
            type: "table",
            id: "q-table",
            title: "14 alerts",
            columns: [
              { key: "id", label: "Alert", mono: true },
              { key: "party", label: "Screened party" },
              { key: "score", label: "Score", align: "r" },
              { key: "amt", label: "Payment M$", align: "r" },
              { key: "st", label: "Status", chip: true },
            ],
            rows: [
              {
                id: "al-1",
                cells: {
                  id: "ALT-88214",
                  party: "Velma Oster-Dunn",
                  score: "87",
                  amt: "18,400.00",
                  st: "Open",
                },
              },
              {
                id: "al-2",
                cells: {
                  id: "ALT-88209",
                  party: "Corvane Shipping SA",
                  score: "74",
                  amt: "92,150.00",
                  st: "Open",
                },
              },
              {
                id: "al-3",
                cells: {
                  id: "ALT-88197",
                  party: "Idris Pallmore",
                  score: "69",
                  amt: "2,300.00",
                  st: "In review",
                },
              },
              {
                id: "al-4",
                cells: {
                  id: "ALT-88190",
                  party: "Tessaly Fruit Co.",
                  score: "66",
                  amt: "7,815.60",
                  st: "Open",
                },
              },
              {
                id: "al-5",
                cells: {
                  id: "ALT-88186",
                  party: "Brannoch Duvall",
                  score: "61",
                  amt: "640.00",
                  st: "Open",
                },
              },
            ],
          },
        ],
      },
      alert: {
        id: "alert",
        nav: "nav-alerts",
        crumbs: ["ScreenGuard", "Alert queue", "ALT-88214"],
        title: "ALT-88214 · name hit",
        subtitle: "Payment PAY-5521907 · M$ 18,400.00 to Port Selene · held",
        chip: "Open",
        actions: [
          {
            id: "btn-escalate",
            label: "Escalate to MLRO",
            kind: "danger",
            icon: "flag",
          },
          {
            id: "btn-dispose",
            label: "Disposition",
            kind: "primary",
            icon: "check",
          },
        ],
        blocks: [
          {
            type: "tabs",
            id: "tabs",
            items: [
              { id: "tab-compare", label: "Comparison", on: true },
              { id: "tab-docs", label: "Customer ID", on: false },
              { id: "tab-history", label: "History", on: false },
            ],
          },
          {
            type: "compare",
            id: "compare",
            title: "Customer vs watchlist entry",
            left: "Customer CIF 30-118-442",
            right: "MCSL entry 4471-K",
            rows: [
              cmp(
                "c-name",
                "Full name",
                "Velma Oster-Dunn",
                "Velmira OSTRAKOVA-DUNST",
              ),
              cmp("c-alias", "Alias", "—", "Velma Dunst"),
              cmp("c-dob", "Date of birth", "14 Mar 1979", "02 Sep 1961"),
              cmp("c-ctry", "Country", "Meridia", "Kestovia"),
              cmp("c-gender", "Gender", "Female", "Female"),
            ],
          },
          {
            type: "meter",
            id: "score",
            title: "Match score · Meridia Consolidated Sanctions List",
            value: 87,
            label: "87",
            color: "#c0392b",
            text: "Fuzzy name match on the alias.",
          },
          {
            type: "docs",
            id: "id-docs",
            title: "Identity documents on file",
            hidden: true,
            items: [
              {
                id: "doc-pass",
                name: "Meridian passport · M4410982",
                meta: "DOB 14 Mar 1979 · born Port Selene · expires 2031",
                status: "Verified",
              },
              {
                id: "doc-addr",
                name: "Utility bill · Harrowgate Rd",
                meta: "Proof of address · Aug 2026",
                status: "Verified",
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
      text: "So this is ScreenGuard, the payment screening queue. I always take the highest score first. This one is eighty seven, a name hit on an outgoing payment of eighteen thousand four hundred.",
      step: "Open the highest-scoring alert from the queue",
      at: 4.2,
      act: [{ point: "al-1", hold: 1 }, { click: "al-1" }, { nav: "alert" }],
    },
    {
      s: "P",
      text: "The payment is held until we decide. The screen puts our customer on the left, and the watchlist entry on the right.",
      at: 2.6,
      act: [
        { point: "compare", fx: 0.45, fy: 0.12, hold: 1.4 },
        { point: "compare", fx: 0.8, fy: 0.12 },
      ],
    },
    {
      s: "P",
      text: "Start with the name. Velma Oster-Dunn against Velmira Ostrakova-Dunst, with an alias, Velma Dunst. That's close, so I mark it as partial.",
      step: "Compare the names and alias",
      at: 1.2,
      act: [
        { point: "c-name", hold: 2 },
        { click: "c-name", fx: 0.92 },
        { set: ["c-name", { result: "partial" }] },
        { click: "c-alias", fx: 0.92 },
        { set: ["c-alias", { result: "partial" }] },
      ],
    },
    {
      s: "R",
      text: "Why partial and not no match? The spelling is quite different.",
    },
    {
      s: "P",
      text: "Because of transliteration. Names get spelled differently across alphabets, so a similar name is never a clean no match on its own. The date of birth and the country do the real work.",
    },
    {
      s: "P",
      text: "Date of birth, nineteen seventy nine against nineteen sixty one. No match. Country, Meridia against Kestovia. No match. Gender is the same, but that tells us very little.",
      step: "Compare date of birth, country and gender",
      at: 1.2,
      act: [
        { click: "c-dob", fx: 0.92 },
        { set: ["c-dob", { result: "nomatch" }] },
        { wait: 2.2 },
        { click: "c-ctry", fx: 0.92 },
        { set: ["c-ctry", { result: "nomatch" }] },
        { wait: 1.6 },
        { click: "c-gender", fx: 0.92 },
        { set: ["c-gender", { result: "match", resultLabel: "Same" }] },
      ],
    },
    {
      s: "P",
      text: "Then I check her passport on the customer ID tab, so the date of birth isn't just what's typed into the system.",
      step: "Check the date of birth against the passport on file",
      at: 2.4,
      act: [
        { click: "tab-docs" },
        { set: ["tab-compare", { on: false }] },
        { set: ["tab-docs", { on: true }] },
        { set: ["compare", { hidden: true }] },
        { set: ["score", { hidden: true }] },
        { set: ["id-docs", { hidden: false }] },
        { point: "doc-pass", hold: 1.2 },
      ],
    },
    {
      s: "P",
      text: "Here's the rule. If the date of birth and the country both differ, and the document confirms it, it's a false positive. If any two of name, date of birth or country match, you escalate to the MLRO, and you never release the payment yourself.",
    },
    {
      s: "P",
      text: "So this one is a false positive. I choose the disposition, and write the rationale.",
      step: "Record the false positive disposition and rationale",
      at: 1.6,
      act: [
        { click: "btn-dispose" },
        {
          modal: {
            id: "dispo-modal",
            title: "Disposition ALT-88214",
            icon: "shield",
            width: 560,
            blocks: [
              {
                type: "form",
                id: "dispo-form",
                cols: 1,
                fields: [
                  {
                    id: "f-dispo",
                    label: "Decision",
                    placeholder: "Choose a decision",
                    kind: "select",
                  },
                  {
                    id: "f-why",
                    label: "Rationale",
                    placeholder: "Why is this a false positive or a match?",
                    kind: "textarea",
                  },
                ],
              },
            ],
            buttons: [
              { id: "btn-dispo-cancel", label: "Cancel" },
              { id: "btn-dispo-save", label: "Close alert", kind: "primary" },
            ],
          },
        },
        { wait: 0.3 },
        {
          select: {
            id: "f-dispo",
            options: [
              "False positive",
              "True match: escalate",
              "Need more information",
            ],
            value: "False positive",
          },
        },
        {
          type: "f-why",
          text: "DOB 1979 vs 1961 and Meridia vs Kestovia; passport verified.",
          cps: 17,
        },
      ],
    },
    {
      s: "R",
      text: "Do I add her to the good-guy list after that, so it stops alerting?",
    },
    {
      s: "P",
      text: "Not on the first one. Only after QA has signed off a second false positive. If you whitelist too early, you can suppress a real match later.",
    },
    {
      s: "P",
      text: "Now I close the alert, and the payment is released from the hold.",
      step: "Close the alert and release the payment",
      at: 0.4,
      act: [
        { click: "btn-dispo-save" },
        { modal: null },
        { set: ["alert", { chip: "False positive" }] },
        { set: ["btn-dispose", { label: "Closed", disabled: true }] },
        { set: ["btn-escalate", { disabled: true }] },
        {
          toast: {
            title: "Alert closed · false positive",
            text: "PAY-5521907 released from hold.",
          },
        },
      ],
    },
    {
      s: "P",
      text: "And back in the queue, it's gone from the open list, and the next one is waiting.",
      step: "Return to the queue for the next alert",
      at: 1.2,
      act: [
        { click: "nav-alerts" },
        { set: ["al-1", { hidden: true }] },
        { set: ["q-table", { title: "13 alerts" }] },
        { nav: "queue" },
        { point: "al-2", hold: 0.6 },
      ],
    },
    { s: "R", text: "How long do we have, once something goes to the MLRO?" },
    {
      s: "P",
      text: "That changed last month and I don't want to guess. I'll confirm the escalation turnaround with the MLRO's office, and send it round.",
    },
    { s: "R", text: "Okay. I'll take the next one, and you can watch." },
  ],
  decisions: [
    "If the date of birth and the country both differ and the identity document confirms it, disposition the alert as a false positive; if any two of name, date of birth or country match, escalate to the MLRO and do not release the payment.",
    "A similar but differently spelled name is marked partial, never no match, because of transliteration.",
  ],
  warnings: [
    "Do not add a customer to the good-guy list after a first false positive; only after QA signs off a second one, or a real match could be suppressed later.",
    "Never release a held payment yourself once an alert is escalated to the MLRO.",
  ],
  openQuestions: [
    "The current turnaround time for alerts escalated to the MLRO: Nadia will confirm it with the MLRO's office.",
  ],
};
