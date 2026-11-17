# The Agent codes in a Sandbox on the VPS, reached through a Runner

ADR 0002 recorded that Vercel is the only compute. The Harness needs a place for the Agent to write and run code, and the decision was to use a container on the VPS rather than a managed sandbox. This ADR makes that one exception.

A Runner (`sandbox-runner/`, a dependency-free Node service) runs on the VPS and listens on localhost. Caddy, already on the VPS, serves it on a subdomain with TLS. The app calls it with a short-lived HMAC token (`HARNESS_SANDBOX_SECRET`) that names the Session, the action and an Owner tag (an HMAC of the Owner, so the Runner never learns who the Owner is); the Runner refuses anything else. `HARNESS_SANDBOX_URL` must be `https:` (or `http:` on a loopback host, for local development), or the app treats the Sandbox as off.

Per Session the Runner starts one Docker container on gVisor (`runsc`, `RUNNER_RUNTIME=runsc`), a user-space kernel between the code and the host's. The container has no network, a read-only root, a small writable workdir and `/tmp`, both in memory and `noexec` (interpreters still read scripts), all capabilities dropped, no new privileges, a non-root user, 1 CPU, 512 MB, a process limit and 60 seconds per command. Caps protect the host: at most 6 live containers, at most 2 per Owner, and all of them under one systemd slice (`harness-sandbox.slice`, 2 CPUs, 2 GB) when `RUNNER_CGROUP_PARENT` is set, which `install.sh` does.

A container ends when the Runner's reaper finds it idle for 15 minutes, or at 2 hours of life, or when the Runner stops. The app has a destroy call, but Sessions are never deleted, so in practice the idle reaper is what ends a container.

The Sandbox tools (`code_write_file`, `code_run`, `code_read_file`) are MCP tools that require an admin Staff member. Any visitor can switch to the admin (ADR 0014), and that was chosen on purpose so every visitor can try it. So "admin only" is not the boundary: every visitor can run code. The container and its runtime are.

## Consequences

- This host holds secrets: other services, a password manager's service-account token and an agent's home directory. On runc, a container shares the host's kernel, and a kernel bug reachable from visitor code would put that code on the VPS, as root if the bug grants it, able to read those secrets and drive the Docker socket. So the Runner refuses to start on any runtime outside an allowlist of sandboxed ones (`runsc`, and names starting with `kata`), which covers `RUNNER_RUNTIME` unset, `runc`, and `crun` or any other runtime that shares the host kernel, unless `RUNNER_ALLOW_RUNC=1` is set. That variable is the owner's explicit, written acceptance of the risk; `install.sh` never sets it. It looks for `runsc` in `docker info`, sets `RUNNER_RUNTIME=runsc` if it is there, and otherwise stops and spells out both choices.
- gVisor narrows a kernel escape to a bug in gVisor plus a bug in the small set of host calls it makes. It does not remove the risk. The limits, no network, no host paths, no Docker socket in the container and the caps still apply on top.
- The per-Owner cap stops one visitor from taking every slot. A seventh visitor still waits when six Owners each hold one.
- When the VPS or the Runner is down, the tools answer "Sandbox offline" and the rest of the Harness works. The Runner's unauthenticated `/health` says only whether it can serve; the counts are behind a signed `/status`.
- Every Sandbox command is written to the Audit trail before it runs ("Asked to run"), and is refused if that write fails; when the call then fails (Runner offline, a cap, a refusal), a `sandbox.command_finished` event with the error follows, best effort. Every file written is recorded, after the write succeeded, with its path and size (ADR 0018).
- Setting up the Runner changes the VPS (gVisor, a systemd unit and slice, a Caddy site, a DNS record). It is done by the owner, with `sandbox-runner/install.sh`, not by a deploy.
- `HARNESS_SANDBOX_URL` unset means the Sandbox is off.
