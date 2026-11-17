import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "pipelines-runs",
  section: "concepts",
  title: "Pipelines, Steps, Runs and Findings",
  summary:
    "Fixed, deterministic desk work made of Steps, and what one execution of it leaves behind.",
  body: [
    md`
## Pipeline

A **Pipeline** is a fixed, deterministic piece of desk work made of Steps, such as handling a member request. The same input and the same Rule Versions give the same Findings. Each Pipeline is one tool on the Harness MCP server and is described to the Agent by a Skill.

The Pipelines are §member_request§, §contribution_processing§ and §delinquency_report§. Answering a Member's questions is a Skill only, not a Pipeline. See [Member service answers](#doc:member-service-answers).

## Step

A **Step** is one unit of a Pipeline with declared inputs. Steps that do not depend on each other run at the same time. A Step is one of three kinds:

- **Code**: a Rule check, a calculation or a lookup. Only code decides.
- **Model**: a model call that reads a document or drafts text.
- **Approval**: the Run waits here for a person.

Steps are grouped into **levels**. A level holds the Steps whose dependencies are all in earlier levels, so everything on a level runs at the same time.

## Run

A **Run** is one execution of a Pipeline in a Session. It starts from the chat, the app, Demo mode or an MCP client. It moves through its Steps, may stop at an Approval and ends in one of these states:

`,
    { live: "run-statuses" },
    { diagram: "run-life" },
    md`
## Finding

A **Finding** is what one Rule concluded in one Run: met or not met, the values it compared, and the Rule Version. A Finding bites only when the Rule is not met, and then its Outcome decides what happens.

## Draft

A **Draft** is the text a Run prepares for a person to approve: a letter, a payment instruction, an employer query or a regulator report.

## What a Run keeps

- every Step's status, output and, for a model Step, the model, tokens and cost;
- every Finding with its Rule Version;
- every Draft and Approval, and who decided;
- the Versions of every Rule it used.

You can watch all of it live in the [Pipelines tab](#tab:pipelines), and read it later in the Audit trail.

## The Pipelines in this build

`,
    { live: "pipelines" },
  ],
};
