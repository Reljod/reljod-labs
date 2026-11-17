import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "ops-runner",
  section: "operations",
  title: "Installing the Runner on the VPS",
  summary:
    "A systemd unit, a Caddy site and a DNS record. The script does the first and tells you the rest.",
  body: [
    md`
The Runner is the small Node service that drives Sandboxes. Its full reference is §sandbox-runner/README.md§ in the repository, and it is the source of truth for commands and options. This page is the shape of it. See [Sandbox and Runner](#doc:arch-sandbox) first for what you are accepting.

## What you need

- A VPS with Docker and Caddy, and Node on it.
- A DNS name for the Runner, for example §sandbox.example.com§.
- Root on the VPS.

## What the install does

The owner runs §install.sh§ once, as root, with the DNS name. It:

1. creates a system user for the Runner;
2. copies the Runner to §/opt/harness-sandbox§;
3. builds the Sandbox image;
4. writes §/etc/harness-sandbox/runner.env§ with a generated secret. The secret is never printed;
5. installs and starts a systemd unit;
6. prints the Caddy site to add, and the two Vercel variables to set.

It changes neither Caddy nor DNS. It is safe to run again. The exact steps and flags are in §sandbox-runner/README.md§ and §sandbox-runner/install.sh§. See those, not this page, for the commands.

## Then you

1. **Add the Caddy site** it printed to your Caddyfile (there is a snippet in §sandbox-runner/Caddyfile.snippet§) and reload Caddy. It proxies the name to §127.0.0.1:8787§ with TLS.
2. **Add a DNS record** for the name, pointing at the VPS.
3. **Read the secret** from the Runner's environment file with your own tools, and set it in Vercel as §HARNESS_SANDBOX_SECRET§. Set §HARNESS_SANDBOX_URL§ to §https://<your-runner-name>§. Do not paste the secret into a chat or a ticket.
4. **Redeploy** so the app sees the variables.

## Check it

§§§bash
curl -s https://<your-runner-name>/health
§§§

You should see §{"ok":true,"docker":true,...}§. If §docker§ is false, the Docker daemon is not answering. In the app, sign in as the admin and ask the Agent to run a small script in the Sandbox.

## Keeping it healthy

- Logs are one JSON line per request. Tokens, bodies, commands and file contents are never logged.
- Lower §RUNNER_MAX_SANDBOXES§ if the VPS has other work to do.
- Revisit this setup before anything else of value shares the machine.

## Turning it off

Unset §HARNESS_SANDBOX_URL§ and redeploy. The Sandbox tools then say it is off. Stop the unit with systemd to stop the Runner.
`,
  ],
};
