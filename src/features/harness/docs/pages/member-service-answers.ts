import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "member-service-answers",
  section: "desk",
  title: "Member service answers",
  summary:
    "Answering a Member's question is a Skill, not a Pipeline: the Agent searches, cites and says what it could not find.",
  body: [
    md`
Answering a Member's question has no fixed Steps and makes no Finding, so it is a **Skill** and not a Pipeline. There is no tool for it. The Agent loads the Skill and uses tools that already exist.

## What the Skill tells the Agent to do

The Skill is §member-service-answer§. For questions that ask for information and not for a change, such as "which form do I need to transfer", it tells the Agent to:

- Find the Member with the records tools first, when the question is about one Member's balance or request, and use only that Member's records.
- Search the Knowledge base with §search_knowledge§ before answering a "how do I" or "what is the rule" question, and search again with other words when the results are thin.
- Answer in a few short sentences, then **cite** every Passage by its Source title and, where it has one, its section or page.
- Say so when it could not find the answer in the Knowledge base.
- Quote figures and dates exactly as the record or Passage gives them.
- Say when a **Conflict** is open on the point, give both Passages with their dates, and say that an admin settles Conflicts. It must not pick one silently.

## Its boundaries

- A question that is really a request ("please transfer my balance") is a Member request. The Agent hands it to the Member request Pipeline and does not answer it as information.
- It does not say what a Member should do with their money. It explains the options and the rules.
- It gives no legal opinion. It says the Knowledge base is a guide.
- It never reveals one Member's details to someone asking about another.

## Why it is not a Pipeline

A Pipeline is fixed, deterministic work with Findings. A question has no fixed shape. Putting it in a Pipeline would hide a model's judgment behind a Run. As a Skill, the answer stays a chat answer with citations that a person reads.

## Where to read the Skill

The Skill is in the [Skills tab](#tab:skills), with the others. An admin can edit it. The list of Skills in this build is on the [Skills](#doc:skills) page.
`,
  ],
};
