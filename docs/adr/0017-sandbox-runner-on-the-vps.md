# The Agent codes in a Sandbox on the VPS, reached through a Runner

ADR 0002 recorded that Vercel is the only compute. The Harness needs a place for the Agent to write and run code, and the decision was to use a container on the VPS rather than a managed sandbox. This ADR makes that one exception.

A Runner (`sandbox-runner/`, a dependency-free Node service) runs on the VPS and listens on localhost. Caddy, already on the VPS, serves it on a subdomain with TLS. The app calls it with a short-lived HMAC token (`HARNESS_SANDBOX_SECRET`) that names the Session; the Runner refuses anything else. Per Session it starts one Docker container: no network, read-only root with a small writable workdir, all capabilities dropped, no new privileges, non-root user, 1 CPU, 512 MB, a process limit, 60 seconds per command, and removal when the Session ends or after an idle period. A cap on live containers protects the host.

The Sandbox tools (`code_write_file`, `code_run`, `code_read_file`) are MCP tools that require an admin Staff member. Any visitor can switch to the admin (ADR 0014), and that was chosen on purpose so every visitor can try it. So the container limits, not the Role, are the security boundary.

## Consequences

- Untrusted code from any Guest runs on the VPS behind container isolation only (runc, no gVisor). The mitigations are the limits above, no network, no mounted host paths, no Docker socket in the container, and the cap on containers. A kernel escape would reach the host; that risk is accepted for the demo and revisited before anything else of value shares the machine.
- When the VPS or the Runner is down, the tools answer "Sandbox offline" and the rest of the Harness works.
- Setting up the Runner changes the VPS (a systemd unit, a Caddy site, a DNS record). It is done by `sandbox-runner/install.sh`, run by the owner, not by a deploy.
- `HARNESS_SANDBOX_URL` unset means the Sandbox is off.
