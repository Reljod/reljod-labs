import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "ops-add-pipeline",
  section: "operations",
  title: "Add a Pipeline",
  summary:
    "Declare Steps, write the checks as pure functions, add a Skill. The MCP tool appears by itself.",
  body: [
    md`
A Pipeline is code plus a Skill. Read [Pipelines, Steps, Runs and Findings](#doc:pipelines-runs) first.

## 1. Name it

Add its id to the list of Pipeline ids in §domain/pipeline.ts§. The id is lower case with underscores, such as §member_request§. It is also the name of its MCP tool, with a §pipeline_§ prefix. The run records, and the database's check on §pipeline_id§, name the ids too, so the migration needs a new value in that check.

## 2. Declare it

In §domain/pipelines/§, add a §PipelineSpec§ and put it in §PIPELINES§ in §index.ts§:

- §id§, §title§ and §summary§;
- §inputSchema§: each field has a name, a type, whether it is required and a description, so both the tool's schema and a form can be built from it;
- §steps§: each has an id, a title, a kind (§code§, §model§ or §approval§), the Steps it waits for (§after§) and a one-line summary. An Approval Step also has a §risk§;
- §skillId§ and §rulebookSkillId§.

The definition is checked: a duplicate id, a Step that waits for itself or for one that does not exist, or a loop is refused.

## 3. Write the checks

Each check is a pure function in the same folder. It takes the case facts and a Rule's Parameters and returns a Finding. Do arithmetic in code and put the inputs in the Finding. A model Step may read a document or write a Draft. It must never return a Finding.

## 4. Write its Rules

Add the Rules it uses. See [Add a Rule](#doc:ops-add-rule).

## 5. Write its Skills

Add a Skill that tells the Agent when and how to use it, and a Rulebook. See [Add a Skill](#doc:ops-add-skill).

## 6. Test it

Write tests for the checks with the same case facts, and assert the Findings. The same input and Rule Versions must give the same Findings.

## What you get for free

The Pipeline becomes a tool on the MCP server and appears in §list_pipelines§. It shows in the Pipelines tab, the Audit trail, and these Docs (this site reads the registry). It takes the Role for starting a Run and counts against the Run limits.
`,
  ],
};
