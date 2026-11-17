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
The Runner is the small Node service that drives Sandboxes. Its full reference is §sandbox-runner/README.md§ in the repository: the threat model, every setting, the token format and the API. This page is the install. See [Sandbox and Runner](#doc:arch-sandbox) first for what you are accepting.

## What you need

- **A hardened runtime.** The Runner refuses to start (exit status 78) unless §RUNNER_RUNTIME§ names one. Install gVisor (§runsc§) first: it is the recommended choice, and the install script sets §RUNNER_RUNTIME=runsc§ when Docker lists it. The only alternative is to accept the risk of plain runc by writing §RUNNER_ALLOW_RUNC=1§ into the environment file by hand. The script never does.

- A VPS with Docker and Caddy, and §openssl§ and systemd.
- A system-wide Node 22 or newer. The service cannot read home directories, so a Node under §/home§ or §/root§ is refused. Pass §NODE_BIN=/usr/bin/node§ if §node§ is not on root's path.
- A DNS name for the Runner, for example §sandbox.example.com§.
- Root on the VPS, and the §sandbox-runner/§ folder from the repository.

## What the install does

The owner runs the script once, as root, with the DNS name (the name is only used in the Caddy site it prints):

§§§bash
sudo ./sandbox-runner/install.sh sandbox.example.com
§§§

It:

1. creates the system user §harness-runner§ and adds it to the §docker§ group (which is root-equivalent on the host: see [Sandbox and Runner](#doc:arch-sandbox));
2. copies the Runner to §/opt/harness-sandbox§, root-owned and read-only to the service;
3. builds the Sandbox image §harness-sandbox:1§;
4. checks that Docker lists §runsc§, and stops with the two choices above if it does not;
5. writes §/etc/harness-sandbox/runner.env§ (0600, root) with a generated §RUNNER_SECRET§, §RUNNER_RUNTIME=runsc§ and §RUNNER_CGROUP_PARENT=harness-sandbox.slice§ (a slice that holds all Sandboxes to two CPUs and 2 GB). The secret is never printed;
6. installs, enables and restarts the systemd unit §harness-sandbox§;
7. checks §/health§ on §127.0.0.1§ and prints what is left.

It changes neither Caddy, DNS nor the firewall. It is safe to run again: it updates the files, the image and the unit and keeps the existing secret. §RUNNER_PORT§ (default §8787§) is only read when the environment file is first written.

## Then you

The script prints these three, with your name filled in:

1. **DNS.** Point an A or AAAA record for the name at the VPS. Caddy cannot get a certificate before this.
2. **Caddy.** Add the site it printed to your Caddyfile (the same block is in §sandbox-runner/Caddyfile.snippet§) and run §sudo systemctl reload caddy§. It proxies the name to §127.0.0.1:8787§ with TLS and allows a command 90 seconds to answer.
3. **Vercel.** Give the app the address and the same secret, without printing the secret:

§§§bash
vercel env add HARNESS_SANDBOX_URL production      # value: https://sandbox.example.com
sudo sed -n 's/^RUNNER_SECRET=//p' /etc/harness-sandbox/runner.env | tr -d '\n' | vercel env add HARNESS_SANDBOX_SECRET production
§§§

Then redeploy so the app sees the variables. To rotate the secret, delete the §RUNNER_SECRET§ line from the environment file, run the script again, and repeat step 3.

## Check it

§§§bash
curl -s https://sandbox.example.com/health
§§§

You should see §{"ok":true}§ and nothing else: §/health§ is open to anyone, so it says only whether the Runner can serve. §ok§ is false when Docker is down or the Runner is shutting down. The counts and the runtime are behind the signed §/status§. In the app, sign in as the Operations Manager and ask the Agent to run a small script in the Sandbox.

To try the Runner on your own machine first, without systemd: §RUNNER_SECRET=<at least 32 characters> RUNNER_RUNTIME=runsc node sandbox-runner/runner.mjs§, (or §RUNNER_ALLOW_RUNC=1§ on a machine with nothing to protect), then set §HARNESS_SANDBOX_URL§ to §http://127.0.0.1:8787§ and §HARNESS_SANDBOX_SECRET§ to the same value for the app.

## Keeping it healthy

- §journalctl -u harness-sandbox -f§ shows the logs: one JSON line per request. Tokens, bodies, commands and file contents are never logged.
- §docker ps --filter label=harness.sandbox=1§ lists the live Sandboxes. The Runner removes one after 15 idle minutes, after 2 hours at the latest, and when it stops. The app does not delete Sessions, so nothing else ends a Sandbox.
- At most §RUNNER_MAX_PER_OWNER§ (default 2) Sandboxes live for one visitor, and §RUNNER_MAX_SANDBOXES§ (default 6) in all. Lower the second if the VPS has other work to do.
- Revisit this setup before anything else of value shares the machine.

## Turning it off

Unset §HARNESS_SANDBOX_URL§ and redeploy. The Sandbox tools then say it is off. To remove the Runner: §systemctl disable --now harness-sandbox && rm /etc/systemd/system/harness-sandbox.service && systemctl daemon-reload§.
`,
  ],
};
