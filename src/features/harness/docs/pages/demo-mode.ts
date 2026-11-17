import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "demo-mode",
  section: "get-started",
  title: "Demo mode",
  summary:
    "A guided way through the real app: pick a Scenario, press Next, and each press does the next thing for you.",
  body: [
    md`
Demo mode is a guided path through the real app. It is not a recording and not a simulation.

## Opening it

It opens only when you press the **Demo mode** button in the top bar (**Demo** on a phone), never by itself. A dialog lists the six Scenarios. Press **Start** on one. If you left a Scenario part way, the dialog also offers **Continue where you left off**, and a small hint with the same offer appears after a reload; you can dismiss it. Closing the dialog changes nothing: the app does not depend on Demo mode, and you can carry on by hand at any time.

## The Scenarios

| Scenario | Beats | You are |
| --- | --- | --- |
| A member asks to move their pension overseas | 9 | Pensions Officer, then Operations Manager |
| A request that fails the rules, and changing a rule | 11 | Operations Manager |
| Monthly contributions with mistakes | 7 | Pensions Officer |
| Who is late this month | 7 | Pensions Officer, then Operations Manager |
| New guidance contradicts the handbook | 6 | Pensions Officer, then Operations Manager |
| Ask a question, run code, connect Claude | 6 | Pensions Officer, then Operations Manager |

A Scenario is made of **Beats**. Each press of **Next** is one Beat: a line that says what is about to happen and why, and the action that does it. A Beat might attach a sample, send a message to the Agent, open the Pipeline view, change Staff, edit a Rule or add a Source.

## The guide bar

While a Scenario runs, a bar is docked at the bottom of the app (**Move up** puts it at the top). It shows the Beat's line and one row of controls (**Next**, **Back to scenarios**, **Exit**); the log of what has been done is folded away until you open it. **Hide guide** folds the bar to a thin strip that still has **Next** (it opens again by itself if a Beat gets stuck). The part of the app a Beat acts on gets a ring. The bar sits beside the app, not over it: the app gives up exactly the bar's height and each tab scrolls within what is left, so the bar never covers the message box or an Approval, and the message box keeps room for at least two lines. Enter or the right arrow does Next, and Escape exits. Exit leaves your Workspace as it is and clears the saved place.

## The model is live

The chat is the real Agent, so it may answer differently each time. A Beat that expects the Agent to start a Run waits for it. If the Agent asks a question instead, or answers without running the Pipeline, the guide shows a calm notice that says what will happen and offers, as its main button:

- **Start it for me**, which starts the Run itself through the same call the app uses to start one, on the paper attached in this Scenario. The Agent does not start it, and the Run says it was started by Demo mode. The Scenario then goes on.

and, as secondary choices, **Retry** the Beat, **Ask again** (a firmer message to the Agent) or **Skip** the Beat.

While a Beat waits, **Skip waiting** appears after a few seconds.

## Refusals are part of the show

Two Beats make an attempt that the server refuses, and show you the refusal: a user trying to approve a high-risk Approval for a Run they started, and a user trying to settle a Conflict. Only an admin can do either.

## The Sandbox Beat

The last Scenario asks the Agent to run code in the Sandbox. If no Runner is set up, or it is unreachable, the guide shows "Sandbox offline" and moves on. The rest of the Scenario does not need it.

## Things to know

- A Beat that starts a Run counts against the same hourly limits as any Run. See [Limits](#doc:ref-limits).
- The Conflict Scenario can be run once per Workspace. After its Conflict is settled, adding the Circular again finds nothing to disagree with, so its Conflict Beats drift; skip them. An admin can remove the earlier copy in the Knowledge tab to run it again.
- Demo mode adds data to your Workspace (Sessions, Runs, Sources, an edited Rule) and does not undo it. The Rule Scenario puts the Rule back to its Default at the end. Your Workspace is private, so nobody else sees it.
- Everything Demo mode does is audited like anything else you do.
- Under the hood each tab registers a small controller when it opens, and a Beat calls it, so Demo mode never reaches into the pages.
`,
  ],
};
