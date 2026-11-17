import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "ref-env",
  section: "reference",
  title: "Environment variables",
  summary: "What the app and the Runner read from the environment.",
  body: [
    md`
Never put a value in the repository or paste one into a chat. Set them in the Vercel project, or in §/etc/harness-sandbox/runner.env§ for the Runner.

## The app

| Variable | Needed | What it does |
| --- | --- | --- |
| §HARNESS_DATABASE_URL§ | Yes, or the fallback | Postgres connection string for the Supabase project (transaction pooler, port 6543). Falls back to §CLIENT_MANAGER_DATABASE_URL§. |
| §JOD_BANKING_HARNESS_AI_GATEWAY_API_KEY§ | Yes, or the fallback | Key for Vercel AI Gateway. Falls back to §DOCUMENT_COMPLIANCE_AI_GATEWAY_API_KEY§. |
| §HARNESS_MODEL§ | No | The Agent's model. Default §anthropic/claude-sonnet-5.5§. |
| §HARNESS_STEP_MODEL§ | No | Model for Steps that read or draft, and for the Conflict check. Default §anthropic/claude-haiku-5.5§. |
| §HARNESS_EMBEDDING_MODEL§ | No | Embedding model. Default §openai/text-embedding-3-small§, at 768 dimensions. |
| §HARNESS_SANDBOX_URL§ | No | The Runner's address, such as §https://sandbox.example.com§. It must be https, or http on a loopback host for local development; otherwise the Sandbox is treated as off. Unset means off. |
| §HARNESS_SANDBOX_SECRET§ | With the URL | The shared secret that signs Runner tokens. Must equal the Runner's §RUNNER_SECRET§. |
| §SUPABASE_URL§ | Yes | The project's address. |
| §SUPABASE_SERVICE_ROLE_KEY§ | Yes | Server-only key, used for storage. |
| §RATE_LIMIT_SALT§ | Yes | Salt for the visitor hash used by rate limits. Shared with the other demos. Rotating it also revokes every OAuth client and token. |
| §E2E_BYPASS_TOKEN§ | No | A request carrying it passes the Access gate and skips rate limits. For the test suite only. |

The Access gate also needs §SUPABASE_PUBLISHABLE_KEY§ (or the legacy §SUPABASE_ANON_KEY§) and §ACCESS_HOST_EMAILS§. They are set for the whole site. Anonymous sign-ins must be on in Supabase Auth.

Both variables of the Sandbox must be set together. Setting only one leaves the Sandbox off or failing.

## The Runner

| Variable | Default | What it does |
| --- | --- | --- |
| §RUNNER_SECRET§ | none, required | At least 32 characters. The Runner refuses to start without it. |
| §RUNNER_PORT§ | §8787§ | The port on §127.0.0.1§. |
| §RUNNER_MAX_SANDBOXES§ | §6§ | Containers alive at once. |
| §RUNNER_MAX_PER_OWNER§ | §2§ | Containers alive at once for one visitor. A third answers 429. |
| §RUNNER_RUNTIME§ | none | The Docker runtime for Sandboxes. Set §runsc§ for gVisor (recommended). Unset or §runc§, the Runner refuses to start unless §RUNNER_ALLOW_RUNC=1§. |
| §RUNNER_ALLOW_RUNC§ | none | §1§ accepts running on runc, with the shared-kernel risk. The installer never sets it. Any other value means no. |
| §RUNNER_CGROUP_PARENT§ | none | A cgroup (for example a systemd slice) that caps all Sandboxes together. The installer sets it. |
| §RUNNER_IDLE_MINUTES§ | §15§ | An unused Sandbox is removed after this long. |
| §RUNNER_REAP_SECONDS§ | §30§ | How often the reaper looks. |
| §RUNNER_IMAGE§ | §harness-sandbox:1§ | The Sandbox image. Built from the Dockerfile if absent. |
| §RUNNER_INSTANCE§ | §main§ | Labels containers, so a test Runner and the real one can share a host. |
| §RUNNER_DOCKER_BIN§ | §docker§ | The Docker command to run. |

The Runner's own fixed limits are in §sandbox-runner/README.md§.
`,
  ],
};
