import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "sandbox",
  section: "concepts",
  title: "Sandbox",
  summary:
    "A Vercel Sandbox, a small virtual machine with no network, where the Agent writes and runs code.",
  body: [
    md`
A **Sandbox** is a Vercel Sandbox: a small virtual machine (a microVM) with no network, where the Agent can write and run code. Each Session has its own, made on its first file or command. It stops 10 minutes after it was made or last extended, and each command extends it. A stopped Sandbox keeps its files for 24 hours, then starts empty.

Every Staff member's Session may use it, whatever the Role. Nobody has to ask for it: the Agent codes on its own judgement when a question needs counting, totalling, comparing or parsing data, instead of working a number out in its head. The §sandbox-analysis§ Skill tells it how.

## What the Agent can do in it

Four MCP tools: write a file (§code_write_file§), run a command (§code_run§), read a file (§code_read_file§) and list files (§code_list_files§). Node.js and Python are installed. There is no network, so no package can be installed. If a tool says a new Sandbox was started, the files written earlier are gone and the Agent writes them again.

## Pipeline Steps code too

In the Member request Pipeline, the model Steps that read papers (§classify§ and §read_documents§) have a §run_code§ tool. It runs a Node.js script in a Sandbox of the Step's own, with the papers written to §papers/1.txt§, §papers/2.txt§ and so on, and their titles in §papers/index.json§. A Step may run code at most 3 times, then gives its answer with no tools. Its Sandbox keeps nothing and is removed when the Step's model call ends. What the code prints helps the model read. It never returns a Finding: only the Pipeline's checks do. Drafting Steps do not code.

## Limits the app enforces

`,
    { live: "sandbox-limits" },
    md`
A visitor may also run only so many Sandbox commands an hour (§sandboxCommandsPerHour§). See [Limits](#doc:ref-limits).

Every command is an Audit event. §sandbox.command§ is written before the command runs, and if it cannot be written the command does not run. §sandbox.command_finished§ follows with the exit code and the time taken. A Step's code is recorded the same way, with the Agent as actor and the Run's id.

## When it is not set up

On a Vercel deployment the app reaches Vercel Sandbox with the deployment's own OIDC token, with nothing to set. Locally it needs §VERCEL_OIDC_TOKEN§ from §vercel env pull§, or a §VERCEL_TOKEN§. Without any of them the code tools answer "Sandbox unavailable: it is not set up here", and a Step answers without code. The rest of the Harness works either way.

## The honest part

Any visitor, Host or Guest, can run code here, and the code is whatever the Agent writes from what the visitor asks. The Role does not hold it in. What does: each Sandbox is its own microVM with no network, commands and files have time and size caps, a visitor has an hourly cap on commands, and every command is in the Audit trail. See [Sandbox design](#doc:arch-sandbox).
`,
  ],
};
