import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "arch-sandbox",
  section: "architecture",
  title: "Sandbox and Runner",
  summary:
    "How code from the Agent runs on the VPS, what limits it, and the risks that are accepted.",
  body: [
    md`
Earlier decisions made Vercel the only compute. The Harness needs a place for the Agent to write and run code. ADR 0017 makes one exception: a container on a VPS, reached through a Runner, instead of a managed sandbox.

## The path
`,
    { diagram: "sandbox-path" },
    md`
1. The Agent calls a Sandbox tool on the MCP server (§code_write_file§, §code_run§, §code_read_file§, §code_list_files§). It needs the admin Role.
2. The app signs a token for that Session and action, with about a minute to live, using §HARNESS_SANDBOX_SECRET§.
3. It calls §HARNESS_SANDBOX_URL§, which must be https (or http on a loopback host for local development; anything else leaves the Sandbox off). **Caddy** on the VPS ends TLS and proxies to the Runner.
4. The **Runner** listens on §127.0.0.1§ only. It checks the token, the Session and the action, then drives Docker.
5. Each Session has one **container**. The Runner runs the command in it and returns the result. A visitor may hold at most §RUNNER_MAX_PER_OWNER§ (default 2) containers, so one person cannot take every slot.

## What the container has

- No network: only a loopback interface.
- No volumes, no host paths, no Docker socket. The root file system is read-only. Writable space is a small in-memory work directory (§/work§) and a smaller in-memory temp directory, both mounted noexec: a file there cannot be run directly, only read by an interpreter, so a script runs as §python3 file.py§.
- A non-root user, every capability dropped, and no-new-privileges, under Docker's default seccomp and AppArmor profiles.
- Caps on CPU, memory (no swap), processes, open files, file size, command time and output.
- A clean-up after every command that ends every process in the container.
- Removal by the Runner after 15 idle minutes, after 2 hours at the latest, and when the Runner stops. A Session is never deleted in the app, so nothing else ends a container; the app's destroy call exists for when Sessions can be removed.
- A cap on how many containers live at once, and on how many one visitor may hold (§RUNNER_MAX_PER_OWNER§, default 2). With §RUNNER_CGROUP_PARENT§ set, all containers share one capped slice (two CPUs, 2 GB).

The numbers the app shows are in [Sandbox](#doc:sandbox). The Runner holds the same numbers and the rest, in §sandbox-runner/README.md§.

## What stands between a stranger and the Runner

- It listens on the loopback address only. Caddy adds TLS.
- The health check answers only §{ "ok": true }§; the counts are behind a signed status call.
- Every request except the health check needs a signed token naming one Session and one action, valid for at most five minutes.
- Request input never becomes part of a command line. Session ids must be UUIDs, paths are checked and passed as one argument to a fixed script, and a command string is interpreted only by a shell inside the container.

## The runtime, and the risks that remain

This is the honest part. From ADR 0017:

- **The Runner refuses to start without a hardened runtime.** Set §RUNNER_RUNTIME=runsc§ (gVisor, a user-space kernel between the code and the host): the recommended way, and what the install script sets when Docker lists it. Or set §RUNNER_ALLOW_RUNC=1§ to run on plain runc and accept the risk explicitly. The script never sets it, and the owner writes it by hand.
- **Shared kernel on runc.** runc containers share the host's kernel, and the code in them comes from any visitor. A kernel bug that lets code break out would put it on the VPS, as an unprivileged user or as root if the bug grants it, able to read what the machine holds. The limits make this hard to reach and nothing more. Allow runc only on a machine that holds nothing you would mind a stranger reading. gVisor narrows the risk and does not remove it.
- **Docker group.** The Runner's user is in the §docker§ group, which is root on the host in all but name. The service's hardening contains a bug in the Runner process. It does not contain someone who can make the Runner send arbitrary Docker commands. The input checks prevent that.
- **No user-namespace remapping.** It is a daemon-wide Docker setting and would affect other containers on the machine. So the container user's id is the same number on the host. No such user exists there.
- **A token authorises an action, not a body.** Whoever holds a valid §run§ token can run any command in that Session until it expires. Tokens are short-lived and never logged.
- **Any Guest can reach it.** The admin Role does not protect it, because anyone can switch to the admin. So the container limits are the boundary.
- **Capacity.** Several containers at full tilt use several CPU cores and a large share of memory. The cap on containers is adjustable.

## When it is off or down

§HARNESS_SANDBOX_URL§ unset means the Sandbox is off. If the VPS or the Runner is unreachable, or answers a 5xx, the tools say "Sandbox offline". The rest of the Harness works.

## Installing it

Setting up the Runner changes the VPS (a systemd unit, a Caddy site, a DNS record). It is done by §sandbox-runner/install.sh§, run by the owner, not by a deploy. See [Installing the Runner on the VPS](#doc:ops-runner).
`,
  ],
};
