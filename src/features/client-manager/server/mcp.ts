import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { MAX_PROPOSED_FACTS } from "../domain/chat";
import type { McpClaims } from "../domain/mcp-token";
import { MCP_SERVER_NAME, researchPrompt } from "../domain/research";
import {
  type Book,
  bookOf,
  browseCategory,
  clientProfile,
  connect,
  expand,
  findClient,
  listClients,
  listSources,
  type Outcome,
  readFacts,
  readSource,
  researchBrief,
  search,
  ToolError,
} from "./graph-tools";
import { verifyBearer, visitorOf } from "./mcp-auth";
import { getClient, latestBuild, listCatalog } from "./repository";
import { addFacts, LimitError } from "./service";

/**
 * The Client Manager MCP server: everything the app knows about a client
 * (profile, graph walks, facts with their quotes and confidence, documents)
 * and the way to add to it. The app's chat reaches the graphs only through
 * here; outside clients such as Claude Code connect with their own token.
 */

type ToolContext = {
  http?: { authInfo?: { extra?: Record<string, unknown> } };
};

function claimsOf(ctx: unknown): McpClaims {
  const claims = (ctx as ToolContext).http?.authInfo?.extra?.claims;
  if (!claims) throw new ToolError("Not authorised");
  return claims as McpClaims;
}

async function bookFor(
  ctx: unknown,
): Promise<{ book: Book; claims: McpClaims }> {
  const claims = claimsOf(ctx);
  const rows = await listCatalog(claims.session);
  return { book: bookOf(rows, claims.visitor, claims.client), claims };
}

function answer(outcome: Outcome) {
  return {
    content: [{ type: "text" as const, text: outcome.text }],
    structuredContent: {
      ...(outcome.data ?? {}),
      traces: outcome.traces ?? [],
    } as Record<string, unknown>,
  };
}

function failure(error: unknown) {
  if (!(error instanceof ToolError || error instanceof LimitError)) {
    console.error("client-manager mcp", error);
  }
  return {
    content: [
      {
        type: "text" as const,
        text:
          error instanceof ToolError || error instanceof LimitError
            ? error.message
            : "That failed on the server. Try again, or another tool.",
      },
    ],
    isError: true,
  };
}

/** Runs a tool against the token's book, turning known failures into answers. */
function run<I>(
  work: (book: Book, input: I, claims: McpClaims) => Promise<Outcome>,
) {
  return async (input: I, ctx: unknown) => {
    try {
      const { book, claims } = await bookFor(ctx);
      return answer(await work(book, input, claims));
    } catch (error) {
      return failure(error);
    }
  };
}

const clientArg = z
  .string()
  .describe("The client: an id, a handle (8 characters) or a name");
const keysArg = z
  .array(z.string())
  .min(1)
  .max(10)
  .describe("Node Keys such as person:ivy-marsh (the part after the handle/)");

/** A Key as the model may pass it: bare, or still carrying its `handle/`. */
const bareKey = (key: string) =>
  key.replace(/^\[\[|\]\]$/g, "").replace(/^[0-9a-f]{8}\//, "");

export function registerClientManagerTools(server: McpServer) {
  server.registerTool(
    "list_clients",
    {
      title: "List clients",
      description:
        "Every client you can see, with id, handle, whether it is yours or a read-only sample, how many facts it has and its persona. Filter by words in the name or persona.",
      inputSchema: z.object({ query: z.string().max(80).optional() }),
      annotations: { readOnlyHint: true },
    },
    run(async (book, input: { query?: string }) =>
      listClients(book, input.query),
    ),
  );

  server.registerTool(
    "client_profile",
    {
      title: "Client profile",
      description:
        "Start here for a client: persona, how many facts each Category holds, and the client's direct relations (family, advisors, companies, accounts).",
      inputSchema: z.object({ client: clientArg }),
      annotations: { readOnlyHint: true },
    },
    run(async (book, input: { client: string }) =>
      clientProfile(findClient(book, input.client)),
    ),
  );

  server.registerTool(
    "search",
    {
      title: "Search the knowledge graph",
      description:
        "Finds the facts most related to some words, by meaning (pgvector) and exact terms (full text). Without a client it searches every client you can see. Returns refs to cite and to expand from.",
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .max(200)
          .describe("A few words: names, things, topics"),
        client: clientArg.optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    run(async (book, input: { query: string; client?: string }) =>
      search(book, input.query, input.client),
    ),
  );

  server.registerTool(
    "expand",
    {
      title: "Walk outward",
      description:
        "Walks one client's graph outward from some facts, both ways along relations, 1 to 3 hops (pgRouting pgr_drivingDistance). Returns every fact reached and the relations among them, with confidence.",
      inputSchema: z.object({
        client: clientArg,
        keys: keysArg,
        hops: z.number().int().min(1).max(3),
      }),
      annotations: { readOnlyHint: true },
    },
    run(async (book, input: { client: string; keys: string[]; hops: number }) =>
      expand(
        findClient(book, input.client),
        input.keys.map(bareKey),
        input.hops,
      ),
    ),
  );

  server.registerTool(
    "connect",
    {
      title: "How two facts connect",
      description:
        "The best-supported path between two facts of one client (pgRouting pgr_dijkstra; relations read with more confidence cost less).",
      inputSchema: z.object({
        client: clientArg,
        from: z.string(),
        to: z.string(),
      }),
      annotations: { readOnlyHint: true },
    },
    run(async (book, input: { client: string; from: string; to: string }) =>
      connect(
        findClient(book, input.client),
        bareKey(input.from),
        bareKey(input.to),
      ),
    ),
  );

  server.registerTool(
    "browse_category",
    {
      title: "Browse a Category",
      description:
        "Lists one client's facts in a Category: a branch (profile, network, career, wealth, goals, persona, risk, timeline) or a leaf such as wealth.accounts.",
      inputSchema: z.object({
        client: clientArg,
        category: z.string().max(40),
      }),
      annotations: { readOnlyHint: true },
    },
    run(async (book, input: { client: string; category: string }) =>
      browseCategory(findClient(book, input.client), input.category),
    ),
  );

  server.registerTool(
    "read_facts",
    {
      title: "Read facts with their sources",
      description:
        "Reads facts in full: attributes, confidence, and the exact quotes from the documents they stand on (with document ids for read_document).",
      inputSchema: z.object({ client: clientArg, keys: keysArg }),
      annotations: { readOnlyHint: true },
    },
    run(async (book, input: { client: string; keys: string[] }) =>
      readFacts(findClient(book, input.client), input.keys.map(bareKey)),
    ),
  );

  server.registerTool(
    "list_documents",
    {
      title: "List documents",
      description:
        "The documents (notes, PDFs, sheets, images, web research) a client's facts were read from, with how many facts each backs.",
      inputSchema: z.object({ client: clientArg }),
      annotations: { readOnlyHint: true },
    },
    run(async (book, input: { client: string }) =>
      listSources(findClient(book, input.client)),
    ),
  );

  server.registerTool(
    "read_document",
    {
      title: "Read a document",
      description:
        "A document's text as it was read, and every fact that quotes it.",
      inputSchema: z.object({ client: clientArg, documentId: z.string() }),
      annotations: { readOnlyHint: true },
    },
    run(async (book, input: { client: string; documentId: string }) =>
      readSource(findClient(book, input.client), input.documentId),
    ),
  );

  server.registerTool(
    "research_brief",
    {
      title: "Research brief",
      description:
        "Before researching a client on the web: what the graph already knows, which Categories are empty, and what is fair to look for.",
      inputSchema: z.object({ client: clientArg }),
      annotations: { readOnlyHint: true },
    },
    run(async (book, input: { client: string }) =>
      researchBrief(findClient(book, input.client)),
    ),
  );

  server.registerTool(
    "add_facts",
    {
      title: "Add facts to the knowledge graph",
      description: `Adds facts about one of your own clients (not a sample): what the person told you, or research findings they chose to keep. Each fact is one plain sentence, with the URL it came from when it came from the web. Up to ${MAX_PROPOSED_FACTS}. They go through the same pipeline as an Intake (extract, check, critique, repair) and land in a minute or two. Ask the person which facts to add before calling this.`,
      inputSchema: z.object({
        client: clientArg,
        facts: z
          .array(
            z.object({
              text: z.string().min(3).max(500),
              sourceUrl: z.string().max(500).optional(),
              sourceTitle: z.string().max(200).optional(),
            }),
          )
          .min(1)
          .max(MAX_PROPOSED_FACTS),
      }),
    },
    run(
      async (
        book,
        input: {
          client: string;
          facts: { text: string; sourceUrl?: string; sourceTitle?: string }[];
        },
        claims,
      ) => {
        const target = findClient(book, input.client);
        const client = await getClient(target.id);
        if (!client) throw new ToolError("No such client.");
        const who = visitorOf(claims);
        const owns =
          client.session_id === claims.session ||
          (client.is_sample && who.trusted);
        if (!owns)
          throw new ToolError(
            "That client is a read-only sample. Facts can be added to your own clients only.",
          );
        const { buildId } = await addFacts(
          client,
          { facts: input.facts },
          who,
          input.facts.some((fact) => fact.sourceUrl) ? "research" : "chat",
        );
        return {
          text: `Adding ${input.facts.length} fact${input.facts.length === 1 ? "" : "s"} to ${client.name}. Build ${buildId} is running: the facts are checked against their sources and land in a minute or two.`,
          data: { buildId, clientId: client.id },
        };
      },
    ),
  );

  server.registerTool(
    "build_status",
    {
      title: "Build status",
      description:
        "Whether a client's latest Build (an Intake or an addition) is running, done or failed, with its counts.",
      inputSchema: z.object({ client: clientArg }),
      annotations: { readOnlyHint: true },
    },
    run(async (book, input: { client: string }) => {
      const client = findClient(book, input.client);
      const build = await latestBuild(client.id);
      if (!build) return { text: "No builds yet." };
      return {
        text: `Latest build ${build.id}: ${build.status}${build.stats ? `, ${build.stats.nodes} facts, ${build.stats.edges} relations, ${build.stats.repairs} self-corrections` : ""}${build.error ? `. ${build.error}` : ""}.`,
        data: { buildId: build.id, status: build.status },
      };
    }),
  );

  server.registerPrompt(
    "research_client",
    {
      title: "Research a client",
      description:
        "Researches one client on the web, then asks which findings to add to their knowledge graph.",
      argsSchema: z.object({
        client: z.string().describe("The client's name"),
      }),
    },
    ({ client }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: researchPrompt(client),
          },
        },
      ],
    }),
  );
}

const handler = createMcpHandler(registerClientManagerTools, {
  serverInfo: { name: MCP_SERVER_NAME, version: "1.0.0" },
});

/** Every request carries a Client Manager token; Guests' tokens die with their pass. */
export const mcpHandler = withMcpAuth(
  handler,
  async (_request, bearer) => {
    if (!bearer) return undefined;
    const claims = await verifyBearer(bearer);
    if (!claims) return undefined;
    return {
      token: bearer,
      clientId: `client-manager-${claims.kind}`,
      scopes: ["client-manager"],
      extra: { claims },
    };
  },
  { required: true },
);
