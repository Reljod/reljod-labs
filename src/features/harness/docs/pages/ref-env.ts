import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "ref-env",
  section: "reference",
  title: "Environment variables",
  summary: "What the app reads from the environment.",
  body: [
    md`
Never put a value in the repository or paste one into a chat. Set them in the Vercel project.

## The app

| Variable | Needed | What it does |
| --- | --- | --- |
| §HARNESS_DATABASE_URL§ | Yes, or the fallback | Postgres connection string for the Supabase project (transaction pooler, port 6543). Falls back to §CLIENT_MANAGER_DATABASE_URL§. |
| §JOD_BANKING_HARNESS_AI_GATEWAY_API_KEY§ | Yes, or the fallback | Key for Vercel AI Gateway. Falls back to §DOCUMENT_COMPLIANCE_AI_GATEWAY_API_KEY§. |
| §HARNESS_MODEL§ | No | The Agent's model. Default §anthropic/claude-sonnet-5.5§. |
| §HARNESS_STEP_MODEL§ | No | Model for Steps that read or draft, and for the Conflict check. Default §anthropic/claude-haiku-5.5§. |
| §HARNESS_EMBEDDING_MODEL§ | No | Embedding model. Default §openai/text-embedding-3-small§, at 768 dimensions. |
| §VERCEL_OIDC_TOKEN§ | Locally, for the Sandbox | Lets the app reach Vercel Sandbox. On a Vercel deployment it is there by itself. Locally, get it with §vercel env pull§, or set a §VERCEL_TOKEN§ instead. Without either, the Sandbox is off. |
| §SUPABASE_URL§ | Yes | The project's address. |
| §SUPABASE_SERVICE_ROLE_KEY§ | Yes | Server-only key, used for storage. |
| §RATE_LIMIT_SALT§ | Yes | Salt for the visitor hash used by rate limits. Shared with the other demos. Rotating it also revokes every OAuth client and token. |
| §E2E_BYPASS_TOKEN§ | No | A request carrying it passes the Access gate and skips rate limits. For the test suite only. |

The Access gate also needs §SUPABASE_PUBLISHABLE_KEY§ (or the legacy §SUPABASE_ANON_KEY§) and §ACCESS_HOST_EMAILS§. They are set for the whole site. Anonymous sign-ins must be on in Supabase Auth.

The Sandbox has no variables of its own. It runs on Vercel Sandbox with the deployment's credentials. See [Sandbox design](#doc:arch-sandbox).
`,
  ],
};
