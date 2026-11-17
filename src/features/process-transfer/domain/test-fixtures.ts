import type { Process } from "./process";

/*
 * A realistic Process for tests: the month-end contribution reconciliation
 * from the first Sample. Synthetic (Meridian Bank & Trust, Republic of
 * Meridia); every name and number is made up.
 */
export const SAMPLE_PROCESS: Process = {
  title: "Month-end contribution reconciliation",
  purpose:
    "Make sure every employer's remittance matches its contribution schedule before the contributions are posted to members' accounts.",
  scope:
    "Covers employer remittances received for the closing month. Does not cover voluntary contributions or transfers in from other schemes.",
  trigger:
    "The last business day of the month, once the treasury statement for the day is available.",
  frequency: "Monthly",
  owner: "Amara Okafor, Senior Pensions Officer",
  receiver: "Daniel Reyes, Pensions Officer",
  roles: [
    {
      name: "Pensions Officer",
      responsibility: "Runs the reconciliation and posts matched remittances",
    },
    {
      name: "Team Lead",
      responsibility: "Approves variances above the tolerance and write-offs",
    },
    {
      name: "Employer Liaison",
      responsibility: "Chases employers for missing or corrected schedules",
    },
  ],
  systems: [
    { name: "Treasury Portal", usedFor: "Downloading the bank statement" },
    {
      name: "PensionPro",
      usedFor: "Contribution schedules, matching and posting",
    },
    { name: "Case Log", usedFor: "Recording variances and follow-ups" },
  ],
  prerequisites: [
    "Treasury statement for the last business day is published",
    "Contribution schedules for the month are uploaded to PensionPro",
  ],
  steps: [
    {
      id: "s1",
      title: "Download the treasury statement",
      actor: "Pensions Officer",
      system: "Treasury Portal",
      action:
        "Sign in to the Treasury Portal and download the month-end statement for the pensions collection account as CSV.",
      details: [
        "Account: 004-118220 Pensions Collection",
        "Format: CSV, all columns",
      ],
      at: 42,
      warning: null,
      decision: null,
    },
    {
      id: "s2",
      title: "Import the statement into PensionPro",
      actor: "Pensions Officer",
      system: "PensionPro",
      action:
        "Open Reconciliation, choose Import statement and upload the CSV. Confirm the opening balance matches last month's closing balance.",
      details: ["Menu: Reconciliation > Import statement"],
      at: 95,
      warning: null,
      decision: null,
    },
    {
      id: "s3",
      title: "Run automatic matching",
      actor: "Pensions Officer",
      system: "PensionPro",
      action:
        "Press Auto-match. PensionPro pairs each remittance with a schedule by employer number and amount.",
      details: ["Match key: employer number + amount", "Tolerance: exact"],
      at: 151,
      warning: null,
      decision: null,
    },
    {
      id: "s4",
      title: "Review the unmatched remittances",
      actor: "Pensions Officer",
      system: "PensionPro",
      action:
        "Open the Unmatched tab and work through each line. Look up the employer by the reference on the remittance.",
      details: ["Tab: Unmatched", "Sort by amount, largest first"],
      at: 214,
      warning:
        "Employers often put the payroll month in the reference, not the employer number. Search by name before marking a line unknown.",
      decision: null,
    },
    {
      id: "s5",
      title: "Decide how to treat each variance",
      actor: "Pensions Officer",
      system: "PensionPro",
      action:
        "Compare the remittance with the schedule total. Small differences are posted; larger ones go to the Team Lead.",
      details: ["Tolerance: 50 MRD per employer"],
      at: 287,
      warning: null,
      decision: {
        question: "Is the variance above 50 MRD?",
        branches: [
          {
            when: "Variance of 50 MRD or less",
            // biome-ignore lint/suspicious/noThenProperty: "then" names the branch's outcome in the Process, and this object is never awaited.
            then: "Post it and note the difference in the Case Log",
          },
          {
            when: "Variance above 50 MRD",
            // biome-ignore lint/suspicious/noThenProperty: "then" names the branch's outcome in the Process, and this object is never awaited.
            then: "Send it to the Team Lead for approval before posting",
          },
        ],
      },
    },
    {
      id: "s6",
      title: "Log variances in the Case Log",
      actor: "Pensions Officer",
      system: "Case Log",
      action:
        "Create one case per employer with a variance, with the amount, the schedule reference and what was done.",
      details: ["Category: Contribution variance"],
      at: 352,
      warning: null,
      decision: null,
    },
    {
      id: "s7",
      title: "Chase missing schedules",
      actor: "Employer Liaison",
      system: "Case Log",
      action:
        "For every remittance without a schedule, email the employer the standard request and set a follow-up for three business days.",
      details: ["Template: Missing schedule request"],
      at: 410,
      warning: null,
      decision: {
        question: "Has the employer sent the schedule within three days?",
        branches: [
          {
            when: "Schedule received",
            // biome-ignore lint/suspicious/noThenProperty: "then" names the branch's outcome in the Process, and this object is never awaited.
            then: "Upload it and run matching again",
          },
          {
            when: "No schedule after three days",
            // biome-ignore lint/suspicious/noThenProperty: "then" names the branch's outcome in the Process, and this object is never awaited.
            then: "Hold the money in suspense and escalate to the Team Lead",
          },
        ],
      },
    },
    {
      id: "s8",
      title: "Post the matched contributions",
      actor: "Pensions Officer",
      system: "PensionPro",
      action:
        "Select all matched lines and press Post. PensionPro credits each member's account and produces the posting report.",
      details: ["Posting report: save to the month-end folder"],
      at: 468,
      warning: null,
      decision: null,
    },
    {
      id: "s9",
      title: "Send the month-end summary",
      actor: "Pensions Officer",
      system: null,
      action:
        "Email the Team Lead the posting report, the open cases and the balance left in suspense.",
      details: ["Subject: Contributions month-end <month>"],
      at: 523,
      warning: null,
      decision: null,
    },
  ],
  exceptions: [
    {
      situation: "The statement does not open in PensionPro",
      handling:
        "Re-download it as CSV with all columns; if it still fails, raise it with Treasury before 3 pm.",
    },
    {
      situation: "An employer pays twice for the same month",
      handling:
        "Post the first payment, hold the second in suspense and ask the employer whether to refund or carry it forward.",
    },
    {
      situation: "A remittance arrives after the cut-off",
      handling:
        "Leave it for next month's reconciliation and note it in the summary.",
    },
  ],
  controls: [
    "Variances above 50 MRD need the Team Lead's approval",
    "Nobody posts a remittance they also approved",
    "Suspense balance is reviewed every month-end",
  ],
  glossary: [
    { term: "Remittance", meaning: "A payment an employer sends" },
    {
      term: "Contribution schedule",
      meaning: "The employer's list of what each member's payment is",
    },
    { term: "MRD", meaning: "Meridian dollars" },
  ],
  openQuestions: [
    "Who approves variances while the Team Lead is on leave?",
    "Should late remittances be flagged to Compliance?",
  ],
};

/*
 * Processes the pipeline extracted from three Sample Recordings (synthetic,
 * Republic of Meridia): a sanctions alert with four roles, a reconciliation
 * with four systems, and one with twelve steps. Their decks failed before the
 * layout learned to continue onto further slides.
 */
export const REAL_PROCESSES: Process[] = [
  {
    owner: "Nadia Corvell, Financial Crime Analyst",
    roles: [
      {
        name: "Financial Crime Analyst",
        responsibility:
          "Works the alert queue, decides the disposition, and releases or escalates the payment.",
      },
      {
        name: "Screening Analyst",
        responsibility:
          "Works alerts from the queue, taking the next one after observing.",
      },
      {
        name: "MLRO",
        responsibility:
          "Receives alerts that are escalated and cannot be closed as false positives.",
      },
      {
        name: "QA",
        responsibility:
          "Signs off a second false positive before a customer is added to the good-guy list.",
      },
    ],
    scope:
      "Name hits on outgoing payments in the ScreenGuard alert queue, worked by the analyst. Not covered: how escalated cases are handled after handover to the MLRO, and maintenance of the good-guy list.",
    steps: [
      {
        at: 7,
        id: "s1",
        actor: "Financial Crime Analyst",
        title: "Open the highest-scoring open alert",
        action:
          "Work the queue from the highest score down. Open the top alert, here ALT-88214, which opens on the Comparison tab showing the customer against the watchlist entry.",
        system: "ScreenGuard",
        details: [
          "Queue: Outgoing payments, All lists, 14 alerts, due in 4h",
          "Alert ALT-88214, score 87, status Open",
          "Payment PAY-5021907, MS 18,400.00 to Port Selene, held",
        ],
        warning: null,
        decision: null,
      },
      {
        at: 18,
        id: "s2",
        actor: "Financial Crime Analyst",
        title: "Compare the names side by side",
        action:
          "Read the customer name against the watchlist entry. The customer is shown on the left and the watchlist entry on the right.",
        system: "ScreenGuard",
        details: [
          "Customer: Velma Öster-Dunn",
          "Watchlist entry: Velmira Ostrackova-Dunst, alias Velma Dunst",
        ],
        warning: null,
        decision: null,
      },
      {
        at: 23,
        id: "s3",
        actor: "Financial Crime Analyst",
        title: "Set the name result to Partial",
        action:
          "Because the names are close, mark the Full name / Alias row as Partial using the Result dropdown.",
        system: "ScreenGuard",
        details: ["Field: Result, row Full name / Alias", "Value: Partial"],
        warning:
          "A similar name is never a clean no match on its own, because names are spelled differently across alphabets.",
        decision: null,
      },
      {
        at: 41,
        id: "s4",
        actor: "Financial Crime Analyst",
        title: "Compare date of birth, country and gender",
        action:
          "Check the identifying fields. The date of birth and country do the real work. Gender matches but tells very little.",
        system: "ScreenGuard",
        details: [
          "Date of birth: 14 Mar 1979 vs 02 Sep 1961, mark No match",
          "Country: Meridia vs Kestovia, mark No match",
          "Gender: Female vs Female, mark Same",
        ],
        warning: null,
        decision: null,
      },
      {
        at: 52,
        id: "s5",
        actor: "Financial Crime Analyst",
        title: "Verify the date of birth on the passport",
        action:
          "Open the Customer ID tab so the date of birth is checked against an identity document, not only what is typed into the system. Then apply the rule.",
        system: "ScreenGuard",
        details: [
          "Passport: Meridia, M4410982, DOB 14 Mar 1979, Port Selene, expires 2031, Verified",
          "Utility bill: Harrogate Rd, proof of address Aug 2026, Verified",
        ],
        warning: null,
        decision: {
          branches: [
            {
              // biome-ignore lint/suspicious/noThenProperty: "then" names the branch's outcome in the Process, and this object is never awaited.
              then: "False positive: record the disposition in the next step.",
              when: "DOB and country differ, document confirms",
            },
            {
              // biome-ignore lint/suspicious/noThenProperty: "then" names the branch's outcome in the Process, and this object is never awaited.
              then: "Escalate to the MLRO; never release the payment yourself.",
              when: "Any two of name, DOB or country match",
            },
          ],
          question: "Do DOB and country both differ, document confirming?",
        },
      },
      {
        at: 75,
        id: "s6",
        actor: "Financial Crime Analyst",
        title: "Record the false positive disposition",
        action:
          "Click Disposition in the top right to open the Disposition ALT-88214 modal. Select False positive and write a rationale that explains the decision.",
        system: "ScreenGuard",
        details: [
          "Decision dropdown: False positive",
          "Rationale example: DOB 1979 vs 1961 and Meridia vs Kestovia; passport verified.",
        ],
        warning: null,
        decision: null,
      },
      {
        at: 93,
        id: "s7",
        actor: "Financial Crime Analyst",
        title: "Close the alert to release the payment",
        action:
          "Click Close alert. The payment is released from the hold and the alert status changes to green False positive.",
        system: "ScreenGuard",
        details: [
          "Banner: Alert closed · false positive. PAY-5021907 released from hold.",
          "Status: False positive",
        ],
        warning: null,
        decision: null,
      },
      {
        at: 98,
        id: "s8",
        actor: "Financial Crime Analyst",
        title: "Return to the alert queue",
        action:
          "Navigate back to the Alert queue. The closed alert leaves the open list and the next alert moves to the top.",
        system: "ScreenGuard",
        details: [
          "Queue now shows 13 alerts",
          "Next top alert: ALT-88209 Corvane Shipping SA, score 74, 92,150.00 MS, Open",
        ],
        warning: null,
        decision: null,
      },
    ],
    title: "Dispositioning a sanctions payment alert in ScreenGuard",
    purpose:
      "Decide whether a payment screening name hit is a false positive so the held payment can be released, or escalate it to the MLRO.",
    systems: [
      {
        name: "ScreenGuard",
        usedFor: "Alert queue, comparison, disposition and closing alerts",
      },
    ],
    trigger:
      "A payment is held on a name hit in the ScreenGuard Outgoing payments alert queue.",
    controls: [
      "The payment stays held until the analyst records a disposition and closes the alert.",
      "Never release a payment yourself when two of name, date of birth or country match; escalate to the MLRO.",
      "Do not add a customer to the good-guy list after a first false positive; only after QA has signed off a second false positive.",
      "Whitelisting too early can suppress a real match later.",
    ],
    glossary: [
      {
        term: "Partial",
        meaning: "Result for a name that is close but not an exact match.",
      },
      {
        term: "Transliteration",
        meaning: "Spelling the same name differently across alphabets.",
      },
      {
        term: "Good-guy list",
        meaning:
          "Whitelist of customers whose alerts stop alerting once added.",
      },
      {
        term: "Held payment",
        meaning:
          "A payment stopped in ScreenGuard until its alert is dispositioned.",
      },
      {
        term: "MLRO",
        meaning:
          "The escalation point for alerts that cannot be closed as false positives.",
      },
    ],
    receiver: "Arjun Pellegrini, Screening Analyst",
    frequency: null,
    exceptions: [
      {
        handling: "Escalate to the MLRO. Never release the payment yourself.",
        situation: "Any two of name, date of birth or country match",
      },
    ],
    openQuestions: [
      "The escalation turnaround to the MLRO changed last month and is not yet known; Nadia Corvell will confirm it with the MLRO office and send it round.",
    ],
    prerequisites: [
      "An open alert in the ScreenGuard Outgoing payments queue with its payment held",
    ],
  },
  {
    owner: "Corinne Ashdown, Senior Pensions Analyst",
    roles: [
      {
        name: "Senior Pensions Analyst",
        responsibility:
          "Reconciles the unreconciled remittances, decides on variances and leaver lines, raises employer queries, posts contributions and adds the audit note.",
      },
      {
        name: "Pensions Analyst",
        responsibility:
          "Posts the clean remittances that only need posting, as stated by Tomas Reyner on the call.",
      },
    ],
    scope:
      "Covers unreconciled employer remittances for the month end, from filtering the list through to posting and noting the outcome. Does not cover how the two clean remittances are posted, which was not shown, or the exact cut-off time, which is to be confirmed.",
    steps: [
      {
        at: 2,
        id: "s1",
        actor: "Senior Pensions Analyst",
        title: "Open remittances from the dashboard",
        action:
          "Click Remittances in the left sidebar at month end. The dashboard shows 38 remittances received, 35 reconciled, 3 unreconciled and a posting cut-off of 5 Nov.",
        system: "Pensions Desk Dashboard",
        details: [
          "Counters: Remittances received 38, Reconciled 35, Unreconciled 3, Posting cut-off 5 Nov",
        ],
        warning: null,
        decision: null,
      },
      {
        at: 6,
        id: "s2",
        actor: "Senior Pensions Analyst",
        title: "Filter remittances to October unreconciled",
        action:
          "Set the period to October 2026 and the status to Unreconciled, then click Search. The results list shows the remittances still needing reconciliation.",
        system: "Pensions Desk Remittances",
        details: [
          "Period dropdown: change September 2026 to October 2026",
          "Status dropdown: change All to Unreconciled",
          "Click Search",
        ],
        warning: null,
        decision: null,
      },
      {
        at: 14,
        id: "s3",
        actor: "Senior Pensions Analyst",
        title: "Identify the two clean remittances",
        action:
          "Note which results need only posting. Two of the three results are clean and need posting, not reconciliation.",
        system: "Pensions Desk Remittances",
        details: [
          "RM-0421 Quarrybend Foods, status Pending",
          "RM-0428 Solace Bay Clinics, status Pending",
        ],
        warning: null,
        decision: null,
      },
      {
        at: 18,
        id: "s4",
        actor: "Senior Pensions Analyst",
        title: "Open the variance remittance",
        action:
          "Open the remittance flagged as a variance, Harbourline Logistics (RM-0418), and compare the schedule total with the amount received. The detail page then shows the variance.",
        system: "Pensions Desk Remittances",
        details: [
          "RM-0418 Harbourline Logistics, status Variance",
          "Schedule total MS 48,612.40",
          "Received MS 48,112.40",
          "Variance MS -500.00",
          "Lines matched 0 / 42",
        ],
        warning: null,
        decision: null,
      },
      {
        at: 35,
        id: "s5",
        actor: "Senior Pensions Analyst",
        title: "Run Auto-match on the remittance",
        action:
          "Click Auto-match at the top right. It pairs each member line on the schedule with the money received. Check the result, then deal with any unmatched line.",
        system: "Remittance detail",
        details: [
          "Result: Lines matched 41 / 42",
          "Notification: Auto-match complete. 41 of 42 member lines matched. 1 line unmatched.",
          "Unmatched line: Dario Ferreira (MR-77310)",
        ],
        warning: null,
        decision: null,
      },
      {
        at: 41,
        id: "s6",
        actor: "Senior Pensions Analyst",
        title: "Check the variance against tolerance",
        action:
          "Compare the variance with the tolerance of 50 Meridian dollars. A variance of 50 or less is accepted with a note. A variance over 50 must be explained by finding the line that accounts for it.",
        system: "Remittance detail",
        details: [
          "Tolerance: 50 Meridian dollars (M$)",
          "Variance on this remittance: M$ -500.00",
        ],
        warning: null,
        decision: {
          branches: [
            {
              // biome-ignore lint/suspicious/noThenProperty: "then" names the branch's outcome in the Process, and this object is never awaited.
              then: "Accept the variance and write a note.",
              when: "Variance is 50 or less",
            },
            {
              // biome-ignore lint/suspicious/noThenProperty: "then" names the branch's outcome in the Process, and this object is never awaited.
              then: "Find the member line that explains the variance, starting with the unmatched line.",
              when: "Variance is over 50",
            },
          ],
          question: "Is the variance 50 Meridian dollars or less?",
        },
      },
      {
        at: 55,
        id: "s7",
        actor: "Senior Pensions Analyst",
        title: "Check the unmatched member's status",
        action:
          "Open the unmatched line, Dario Ferreira (MR-77310), and read the member record. Check whether the member left before the October payroll and whether the leaver notice has been received.",
        system: "Member record",
        details: [
          "Employment Status: Leaver",
          "Left Employer: 12 Oct 2026",
          "Last Contribution: September 2026",
          "Employer: Harbourline Logistics",
          "Scheduled October: M$ 500.00",
          "Leaver Notice: Received 30 Oct",
          "Warning banner: Member left before the October payroll. A contribution is not due for October.",
        ],
        warning: null,
        decision: {
          branches: [
            {
              // biome-ignore lint/suspicious/noThenProperty: "then" names the branch's outcome in the Process, and this object is never awaited.
              then: "Exclude the line as a leaver in the Member record.",
              when: "Member left before the October payroll (leaver)",
            },
            {
              // biome-ignore lint/suspicious/noThenProperty: "then" names the branch's outcome in the Process, and this object is never awaited.
              then: "Raise an employer query. The remittance stays in query status until the employer pays the difference. Do not post it.",
              when: "Member is still active",
            },
          ],
          question: "Did the member leave before the October payroll?",
        },
      },
      {
        at: 73,
        id: "s8",
        actor: "Senior Pensions Analyst",
        title: "Exclude the leaver line",
        action:
          "Click Exclude line as leaver in the member record. The line is set to zero and the variance clears. The schedule total updates to the amount received.",
        system: "Member record",
        details: [
          "Button: Exclude line as leaver",
          "Dario Ferreira status: Excluded (Sched 0.00, Recv 0.00)",
          "Variance MS: 0.00",
          "Schedule total MS: 48,112.40",
          "Notification: Line excluded. Line MR-77310 excluded. Variance now M$ 0.00.",
        ],
        warning: null,
        decision: null,
      },
      {
        at: 85,
        id: "s9",
        actor: "Senior Pensions Analyst",
        title: "Post contributions to member accounts",
        action:
          "Fix the schedule before posting. Click Post to members, then confirm the posting in the dialog. The period is locked once posted.",
        system: "Remittance detail",
        details: [
          "Button: Post to members",
          "Dialog: Post 41 contributions totaling M$ 48,112.40 to member accounts for October 2026? The period will be locked.",
          "Confirm with button: Post 41 contributions",
          "Result: Status Posted; 41 member accounts credited; M$ 48,112.40",
        ],
        warning:
          "Always fix the schedule before you post. Posting locks the period, and reversing it needs a ticket to treasury and a second approver.",
        decision: null,
      },
      {
        at: 91,
        id: "s10",
        actor: "Senior Pensions Analyst",
        title: "Add the audit note to the remittance",
        action:
          "Type a note in the Notes box explaining the outcome, then click Add note. The note records why the variance was cleared for the audit trail.",
        system: "Remittance detail",
        details: [
          "Note text: MR-77310 excluded: left 12 Oct. Variance cleared.",
          "Button: Add note",
          "Note appears credited to C. Ashdown - 3 Nov 09:41",
        ],
        warning: null,
        decision: null,
      },
    ],
    title: "October contribution reconciliation",
    purpose:
      "Reconcile the month's employer remittances against member schedules so that member contributions can be posted to member accounts for the month.",
    systems: [
      {
        name: "Pensions Desk Dashboard",
        usedFor:
          "Shows the month-end counters and work queues and gives access to Remittances.",
      },
      {
        name: "Pensions Desk Remittances",
        usedFor:
          "Filters remittances by period and status and lists the results.",
      },
      {
        name: "Remittance detail",
        usedFor:
          "Shows schedule and received totals, runs Auto-match, posts contributions and holds the Notes box.",
      },
      {
        name: "Member record",
        usedFor:
          "Shows a member's employment status, last contribution and scheduled amount for October.",
      },
    ],
    trigger: "Month end, when remittances are waiting to be reconciled.",
    controls: [
      "Variance tolerance: a variance of 50 Meridian dollars or less is accepted with a note; anything over 50 must be explained by a member line.",
      "Posting locks the period for the month.",
      "Reversing a posting needs a ticket to treasury and a second approver.",
    ],
    glossary: [
      {
        term: "Remittance",
        meaning:
          "The payment an employer sends with its schedule of member contributions.",
      },
      {
        term: "Schedule total",
        meaning:
          "The total contribution the employer says it will pay on its schedule.",
      },
      {
        term: "Variance",
        meaning:
          "The difference between the schedule total and the amount received.",
      },
      {
        term: "Auto-match",
        meaning:
          "The system function that pairs each member line on the schedule with the money received.",
      },
      {
        term: "Leaver",
        meaning:
          "A member who left the employer before the payroll in question, so no contribution is due.",
      },
      {
        term: "M$",
        meaning:
          "Meridian dollars, the currency used for amounts in this process.",
      },
      {
        term: "Posting cut-off",
        meaning:
          "The date shown on the dashboard by which October contributions must be posted (5 Nov).",
      },
    ],
    receiver: "Tomas Reyner, Pensions Analyst",
    frequency: "Monthly, at month end",
    exceptions: [
      {
        handling:
          "Raise an employer query. The remittance stays in query status until the employer pays the difference. Do not post it.",
        situation: "The unmatched member is still active and not a leaver.",
      },
    ],
    openQuestions: [
      "The exact posting cut-off time for this quarter is not yet known. Corinne Ashdown will confirm the cut-off with treasury and send it to Tomas Reyner.",
      "The dashboard shows a posting cut-off of 5 Nov, while Corinne Ashdown said posting is due on the third working day of the month. Which applies was not confirmed.",
      "How to post the two clean remittances (RM-0421 and RM-0428) was not shown on the call.",
    ],
    prerequisites: [],
  },
  {
    owner: "Corinne Ashdown, Senior Pensions Analyst",
    roles: [
      {
        name: "Senior Pensions Analyst",
        responsibility:
          "Runs the month-end reconciliation, resolves variances, excludes leaver lines, posts contributions and adds the audit note.",
      },
      {
        name: "Pensions Analyst",
        responsibility:
          "Takes over the process and posts the clean remittances.",
      },
    ],
    scope:
      "Covers reconciling the month's unreconciled remittances, handling variances within and above the tolerance, excluding leaver lines, posting to member accounts, and noting the audit trail. Does not cover raising or chasing employer queries beyond raising them, reversing a locked period (Treasury ticket and second approver), or the posting cut-off time, which is still to be confirmed.",
    steps: [
      {
        at: 3,
        id: "s1",
        actor: "Senior Pensions Analyst",
        title: "Open the remittances list",
        action:
          "From the left navigation, open Remittances. The badge shows how many remittances are waiting.",
        system: "Pensions Desk",
        details: [
          "Left navigation: Dashboard, Employers, Remittances (badge 3), Schedules, Member records, Postings, Reports",
        ],
        warning: null,
        decision: null,
      },
      {
        at: 6,
        id: "s2",
        actor: "Senior Pensions Analyst",
        title: "Filter to unreconciled October remittances",
        action:
          "Filter the Remittances screen to the month being closed and to unreconciled items only, then search. The results list shows the remittances still to be matched.",
        system: "Pensions Desk",
        details: [
          "Period: October 2026",
          "Status: Unreconciled",
          "Employer: Any employer",
          "Click Search",
          "Results in the example: RM-2026-10-0418 Harbourline Logistics (Variance), RM-2026-10-0421 Quarrybend Foods (Pending), RM-2026-10-0424 Solace Bay Clinics (Pending)",
        ],
        warning: null,
        decision: null,
      },
      {
        at: 18,
        id: "s3",
        actor: "Senior Pensions Analyst",
        title: "Open the Harbourline Logistics remittance",
        action:
          "Start with the remittance flagged as a variance by clicking its row. This opens the remittance detail view.",
        system: "Pensions Desk",
        details: ["Remittance RM-2026-10-0418, Harbourline Logistics"],
        warning: null,
        decision: null,
      },
      {
        at: 21,
        id: "s4",
        actor: "Senior Pensions Analyst",
        title: "Compare schedule total with amount received",
        action:
          "Read the schedule total against the amount received. The difference is the variance, and the lines matched count shows how many member lines are paired so far.",
        system: "Pensions Desk",
        details: [
          "Schedule total: M$ 48,612.40",
          "Received: M$ 48,112.40",
          "Variance: M$ -500.00",
          "Lines matched: 0 / 42",
        ],
        warning: null,
        decision: null,
      },
      {
        at: 33,
        id: "s5",
        actor: "Senior Pensions Analyst",
        title: "Run auto-match on the remittance",
        action:
          "Click Auto-match. It pairs each member line on the schedule with the money received and reports how many lines remain unmatched.",
        system: "Pensions Desk",
        details: [
          "Toast: Auto-match complete: 41 of 42 member lines matched. 1 line unmatched.",
          "Lines matched updates to 41 / 42",
        ],
        warning: null,
        decision: null,
      },
      {
        at: 41,
        id: "s6",
        actor: "Senior Pensions Analyst",
        title: "Check variance against tolerance",
        action:
          "Compare the variance with the tolerance of 50 Meridian dollars. A variance at or under the tolerance is accepted with a note. A larger variance needs the line that explains it to be found.",
        system: "Pensions Desk",
        details: [
          "Tolerance: M$ 50 or less",
          "Variance in this example: M$ -500.00, above tolerance",
        ],
        warning: null,
        decision: {
          branches: [
            {
              // biome-ignore lint/suspicious/noThenProperty: "then" names the branch's outcome in the Process, and this object is never awaited.
              then: "Accept the variance and write a note on the remittance.",
              when: "Variance is 50 Meridian dollars or less",
            },
            {
              // biome-ignore lint/suspicious/noThenProperty: "then" names the branch's outcome in the Process, and this object is never awaited.
              then: "Find the unmatched member line that explains the variance and check it (see next step).",
              when: "Variance is over 50 Meridian dollars",
            },
          ],
          question: "Is the variance 50 Meridian dollars or less?",
        },
      },
      {
        at: 50,
        id: "s7",
        actor: "Senior Pensions Analyst",
        title: "Open the unmatched member line",
        action:
          "Click the unmatched line to open the member record. The line shows the scheduled amount, the received amount and its unmatched status.",
        system: "Pensions Desk",
        details: [
          "Line: MR-77310 Dario Ferreira",
          "Scheduled: 500.00",
          "Received: 0.00",
          "Status: Unmatched",
        ],
        warning: null,
        decision: null,
      },
      {
        at: 53,
        id: "s8",
        actor: "Senior Pensions Analyst",
        title: "Check the member's employment status",
        action:
          "Read the member record to see whether the member left before the payroll. If the member left, the schedule is wrong, not the remittance. If the member is still active, the employer must be queried.",
        system: "Pensions Desk",
        details: [
          "Member MR-77310 Dario Ferreira",
          "Employment status: Leaver",
          "Left Employer: 12 Oct 2026",
          "Last contribution: September 2026",
          "Scheduled October: M$ 500.00",
          "Leaver notice: Received 30 Oct",
        ],
        warning:
          "Member left before the October payroll. A contribution is not due for October.",
        decision: {
          branches: [
            {
              // biome-ignore lint/suspicious/noThenProperty: "then" names the branch's outcome in the Process, and this object is never awaited.
              then: "Exclude the line as a leaver.",
              when: "Member left before the October payroll (leaver)",
            },
            {
              // biome-ignore lint/suspicious/noThenProperty: "then" names the branch's outcome in the Process, and this object is never awaited.
              then: "Raise an employer query. The remittance stays in query status until the employer pays the difference. Do not post it.",
              when: "Member was still active",
            },
          ],
          question: "Did the member leave before the October payroll?",
        },
      },
      {
        at: 113,
        id: "s9",
        actor: "Senior Pensions Analyst",
        title: "Exclude the leaver line",
        action:
          "In the member modal, click Exclude line as leaver. The line is removed from the variance, so the schedule total and variance update.",
        system: "Pensions Desk",
        details: [
          "Button: Exclude line as leaver",
          "Toast: Line MR-77310 excluded. Variance now M$ 0.00.",
          "Member line status: Excluded",
          "Schedule total updates to 48,112.40",
          "Variance becomes 0.00",
        ],
        warning: null,
        decision: null,
      },
      {
        at: 125,
        id: "s10",
        actor: "Senior Pensions Analyst",
        title: "Post contributions to member accounts",
        action:
          "Make sure the schedule is fixed before posting. Click Post to members, then confirm in the dialog. Posting locks the period.",
        system: "Pensions Desk",
        details: [
          "Button: Post to members",
          "Confirmation: Post 41 contributions totaling M$ 48,112.40 to member accounts for October 2026? The period will be locked.",
          "Click Post 41 contributions",
        ],
        warning:
          "Always fix the schedule before you post. Posting locks the period, and reversing it needs a ticket to Treasury and a second approver.",
        decision: null,
      },
      {
        at: 128,
        id: "s11",
        actor: "Senior Pensions Analyst",
        title: "Confirm the posting result",
        action:
          "Check that the posting has completed. The remittance status changes to Posted.",
        system: "Pensions Desk",
        details: [
          "Toast: Posted: 41 member accounts credited: M$ 48,112.40",
          "Remittance status: Posted",
        ],
        warning: null,
        decision: null,
      },
      {
        at: 130,
        id: "s12",
        actor: "Senior Pensions Analyst",
        title: "Add an audit note to the remittance",
        action:
          "In the Notes section, type a note saying why the variance was cleared, so the audit trail records the reason, then click Add note.",
        system: "Pensions Desk",
        details: [
          "Note box: Add a note... under Notes",
          "Note text: MR-77310 excluded: left 12 Oct. Variance cleared.",
          "Note appears with author and timestamp: C. Ashdown - 3 Nov 01:42",
        ],
        warning: null,
        decision: null,
      },
    ],
    title: "Month-end contribution reconciliation",
    purpose:
      "Match employer contribution remittances to their schedules, resolve variances, and post the contributions to member accounts so that each month's contributions are fully and correctly recorded.",
    systems: [
      {
        name: "Pensions Desk",
        usedFor:
          "Dashboard, remittances list, remittance detail with auto-match, member records, posting to member accounts and remittance notes.",
      },
    ],
    trigger:
      "Month end, when remittances for the month are received and unreconciled.",
    controls: [
      "Variance tolerance: 50 Meridian dollars or less may be accepted with a note; anything over 50 needs the explaining line found.",
      "Posting locks the period for the month.",
      "Reversing a posting needs a ticket to Treasury and a second approver.",
      "Every cleared variance is written up in a note on the remittance for the audit trail.",
    ],
    glossary: [
      {
        term: "Remittance",
        meaning:
          "The payment an employer sends for a month's pension contributions.",
      },
      {
        term: "Schedule",
        meaning:
          "The employer's list of member contributions due for the month.",
      },
      {
        term: "Auto-match",
        meaning:
          "The system step that pairs each schedule member line with the money received.",
      },
      {
        term: "Leaver",
        meaning:
          "A member who left the employer before the payroll, so no contribution is due for that month.",
      },
      {
        term: "Variance",
        meaning:
          "The difference between the schedule total and the amount received.",
      },
      {
        term: "M$",
        meaning: "Meridian dollars, the currency used on the Pensions Desk.",
      },
    ],
    receiver: "Tomas Reyner, Pensions Analyst",
    frequency: "Monthly, at month end",
    exceptions: [
      {
        handling:
          "Raise an employer query. The remittance sits in query status until the employer pays the difference. Do not post it.",
        situation:
          "Unmatched member is still active and the variance is not explained by a leaver",
      },
    ],
    openQuestions: [
      "The exact posting cut-off time this quarter is not known. Corinne will confirm it with Treasury and send it to Tomas.",
      "Quarrybend Foods and Solace Bay Clinics were described as clean and needing posting, but this was not demonstrated in the call.",
    ],
    prerequisites: ["Remittances for the month are in Unreconciled status"],
  },
];

const WORDS =
  "remittance schedule employer variance suspense ledger posting approval treasury statement member account balance reference payroll contribution screening alert analyst queue match override evidence record case report control limit cut-off branch customer mandate signature beneficiary nostro break correspondent".split(
    " ",
  );
const VERBS = [
  "Open",
  "Check",
  "Compare",
  "Post",
  "Record",
  "Send",
  "Confirm",
  "Escalate",
  "Review",
  "Upload",
  "Match",
  "Close",
];
const ROLE_NAMES = [
  "Pensions Officer",
  "Senior Financial Crime Operations Analyst",
  "Team Lead",
  "Employer Liaison",
  "Payments Investigations Specialist",
  "Head of Operations Control",
  "Treasury Desk Analyst",
  "Compliance Reviewer",
];
const SYSTEM_NAMES = [
  "PensionPro",
  "ScreenGuard Case Manager",
  "Treasury Portal",
  "Case Log",
  "CoreBank Ledger",
  "SWIFT Alliance Gateway",
  "Document Vault",
];

/** A seeded generator, so a failing Process can be named by its seed. */
function random(seed: number) {
  // Scrambled, so neighbouring seeds do not start out alike.
  let state = (Math.imul(seed, 2654435761) ^ 0x9e3779b9) >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * A Process at the scale real Recordings give (7 to 9 steps, 3 to 6 roles,
 * 2 to 5 systems, 20-word responsibilities, 35-word warnings, branches of
 * about 20 words) and somewhat beyond it: up to 12 steps, 8 roles, 7
 * systems, 30-word responsibilities, 45-word warnings and 4 branches of up
 * to 42 words.
 */
export function generateProcess(seed: number): Process {
  const next = random(seed);
  const between = (low: number, high: number) =>
    low + Math.floor(next() * (high - low + 1));
  const pick = <T>(items: readonly T[]) =>
    items[Math.floor(next() * items.length)];
  const words = (low: number, high: number) =>
    Array.from({ length: between(low, high) }, () => pick(WORDS)).join(" ");
  const sentence = (low: number, high: number) => {
    const text = words(low, high);
    return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
  };
  const roles = ROLE_NAMES.slice(0, between(3, 8)).map((name) => ({
    name,
    responsibility: sentence(12, 30),
  }));
  const systems = SYSTEM_NAMES.slice(0, between(2, 7)).map((name) => ({
    name,
    usedFor: sentence(4, 16),
  }));
  const stepCount = between(7, 12);
  const decisionAt = new Set(
    Array.from({ length: between(1, 3) }, () => between(2, stepCount)),
  );
  const steps = Array.from({ length: stepCount }, (_, index) => ({
    id: `s${index + 1}`,
    title: `${pick(VERBS)} the ${words(3, 9)}`,
    actor: pick(roles).name,
    system: next() < 0.85 ? pick(systems).name : null,
    action: `${sentence(8, 25)} ${next() < 0.6 ? sentence(6, 20) : ""}`.trim(),
    details: Array.from(
      { length: between(0, 4) },
      () => `${pick(WORDS)}: ${words(1, 6)}`,
    ),
    at: 20 + index * between(25, 70),
    warning: next() < 0.45 ? sentence(10, 45) : null,
    decision: decisionAt.has(index + 1)
      ? {
          question: `Is the ${words(3, 12)} above the limit?`,
          branches: Array.from({ length: between(2, 4) }, () => ({
            when: sentence(4, 12),
            // biome-ignore lint/suspicious/noThenProperty: "then" names the branch's outcome in the Process, and this object is never awaited.
            then: sentence(10, 30),
          })),
        }
      : null,
  }));
  return {
    title: `${pick(VERBS)}ing the ${words(2, 5)}`,
    purpose: sentence(15, 35),
    scope: sentence(10, 30),
    trigger: sentence(10, 25),
    frequency: pick([
      "Monthly",
      "Daily, before the 10:00 cut-off",
      null,
      "Whenever an alert is raised in the queue",
    ]),
    owner: `Amara Okafor, ${roles[0].name}`,
    receiver: `Daniel Reyes, ${pick(roles).name}`,
    roles,
    systems,
    prerequisites: [sentence(5, 12)],
    steps,
    exceptions: Array.from({ length: between(1, 6) }, () => ({
      situation: sentence(6, 14).replace(/\.$/, ""),
      handling: sentence(10, 30),
    })),
    controls: Array.from({ length: between(1, 4) }, () => sentence(6, 16)),
    glossary: [],
    openQuestions: Array.from(
      { length: between(0, 5) },
      () => `${sentence(8, 25).replace(/\.$/, "")}?`,
    ),
  };
}
