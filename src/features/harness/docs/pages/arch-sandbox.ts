import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "arch-sandbox",
  section: "architecture",
  title: "Sandbox design",
  summary:
    "How code from the Agent and from Pipeline Steps runs on Vercel Sandbox, what limits it, and the risks that are accepted.",
  body: [
    md`
The Harness needs a place for the Agent to write and run code. ADR 0022 puts it on Vercel Sandbox, the way Sieve does it, so Vercel stays the only compute. It supersedes ADR 0017, which ran containers on a VPS.

## The path
`,
    { diagram: "sandbox-path" },
    md`
1. The Agent calls a Sandbox tool on the MCP server (§code_write_file§, §code_run§, §code_read_file§, §code_list_files§). Any Role may.
2. The server function checks that the Session belongs to the Owner, takes one of the visitor's hourly Sandbox commands, and for a command writes §sandbox.command§ to the Audit trail first.
3. It finds the Session's Sandbox by name (§harness-session-<session id>§) or makes it, with the network set to deny all. Auth is the deployment's OIDC token. Any function instance finds the same Sandbox by its name.
4. The command runs under §sh -c§ in the work directory, with a §timeout§, and its output is cut inside the Sandbox before it is read back.
5. §sandbox.command_finished§ records the exit code and the time taken.

A model Step that codes takes the same path with its own Sandbox, named §harness-step-<uuid>§. It is made on the Step's first §run_code§ with the papers written in, keeps nothing when it stops, and is removed when the model call ends.

## What a Sandbox has

- Its own microVM, so code from one Session never shares a kernel with another's, or with the app.
- No network. The policy is set to deny all when the Sandbox is made, and again each time it is opened.
- Node.js and Python, in the work directory §/vercel/sandbox§.
- Caps on command time, file size and output, and a lifetime: 10 minutes, extended by each command. A Session's Sandbox keeps its files 24 hours after it stops; a Step's keeps nothing.

The numbers are in [Sandbox](#doc:sandbox) and come from §SANDBOX_LIMITS§ in §domain/sandbox.ts§.

## What stands between a visitor and the code

- The Access gate and the Owner: a Sandbox tool works only on a Session of the caller's own Workspace.
- The hourly cap on Sandbox commands per visitor (§LIMITS.sandboxCommandsPerHour§), taken in the server function at every entry point.
- The Audit trail: a command whose §sandbox.command§ event cannot be written does not run.
- Paths are kept inside the work directory, and a command string is interpreted only by a shell inside the Sandbox.

## The risks that remain

This is the honest part. From ADR 0022:

- **Any visitor can run code.** The Sandbox is open to every Role, so to any Host or Guest. The Role is not the boundary. The microVM, the missing network, the caps and the Audit trail are.
- **Cost.** Each Sandbox and each command uses Vercel Sandbox time, paid by the project. The hourly cap per visitor and the short lifetime bound it.
- **The model decides when to code.** The Agent and the reading Steps code on their own judgement. A Step's code is a reading aid; only the Pipeline's checks return a Finding (ADR 0015).

## When it is not set up

On a Vercel deployment it needs no setup. Locally it needs §VERCEL_OIDC_TOKEN§ (from §vercel env pull§) or §VERCEL_TOKEN§. Without one, §env.sandboxConfigured()§ is false and the tools answer "Sandbox unavailable: it is not set up here". If a Sandbox cannot be started, they answer "Sandbox unavailable" with a short reason. The rest of the Harness works.
`,
  ],
};
