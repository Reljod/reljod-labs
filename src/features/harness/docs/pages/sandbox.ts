import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "sandbox",
  section: "concepts",
  title: "Sandbox",
  summary:
    "A container on the VPS where the Agent can write and run code for one Session.",
  body: [
    md`
A **Sandbox** is a container on a VPS where the Agent can write and run code for one Session. It has no network, capped CPU, memory and time, and the Runner removes it after 15 idle minutes (2 hours at the latest). A visitor may hold at most two Sandboxes at a time (§RUNNER_MAX_PER_OWNER§). Only an admin Staff member's Session may use it.

The **Runner** is the small service on the VPS that starts and drives Sandboxes for the Harness.

## What the Agent can do in it

Four MCP tools, all needing the admin Role: write a file, read a file, list files and run a command. Python 3 and Node are in the image. There is no network, so no package can be installed. The work directory cannot run programs directly (it is mounted noexec), so a script runs through its interpreter: §python3 file.py§, §node file.js§, §sh run.sh§.

## Limits the app enforces

`,
    { live: "sandbox-limits" },
    md`
The Runner holds the same numbers and enforces them inside the container. A visitor may also run only so many commands an hour. See [Limits](#doc:ref-limits).

## When it is off or down

If §HARNESS_SANDBOX_URL§ is not set, or is not https (http is allowed only on a loopback host), the Sandbox is off. If the VPS or the Runner is down, the tools answer "Sandbox offline". The rest of the Harness works either way.

## The honest part

Any visitor can switch to the admin, so the Role does not protect the Sandbox. The container's limits do. The Runner refuses to start without a hardened runtime: gVisor (§RUNNER_RUNTIME=runsc§) is the recommended one, and plain runc, which shares the host's kernel, runs only when the owner writes §RUNNER_ALLOW_RUNC=1§ to accept that risk. The risk that remains is written out in [Sandbox and Runner](#doc:arch-sandbox).
`,
  ],
};
