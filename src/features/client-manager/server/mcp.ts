import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { ZodError, z } from "zod";
import { isAppError, UnauthorizedError } from "@/platform/errors";
import { MAX_PROPOSED_FACTS } from "../domain/chat";
import { guestTokenProblem, type McpClaims } from "../domain/mcp-token";
import {
  GUEST_TOKEN_HEADER,
  PROTECTED_RESOURCE_PATH,
} from "../domain/oauth-paths";
import { MCP_SERVER_NAME, researchPrompt } from "../domain/research";
import type { Book } from "./book";
import { env } from "./env";
import { verifyBearer, visitorOfClaims } from "./mcp-auth";
import type { GraphTools, Outcome } from "./services/graph";

/**
 * The Client Manager MCP server over the same services as the REST routes:
 * everything the app knows about a client (profile, graph walks, facts with
 * their quotes and confidence, documents) and the way to add to it. The
 * Desk reaches the graphs only through here (in process); outside clients
 * such as Claude Code connect with their own token. It checks its own
 * bearer, so it is not on the REST stack.
 */

type ToolContext = {
  http?: { authInfo?: { extra?: Record<string, unknown> } };
};

function claimsOf(ctx: unknown): McpClaims {
  const claims = (ctx as ToolContext).http?.authInfo?.extra?.claims;
  if (!claims) throw new UnauthorizedError("Not authorised");
  return claims as McpClaims;
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

/** A refusal a service threw on purpose is the tool's answer; anything else is logged. */
function failure(error: unknown) {
  const known = isAppError(error) || error instanceof ZodError;
  if (!known) console.error("[client-manager] mcp", error);
  return {
    content: [
      {
        type: "text" as const,
        text: isAppError(error)
          ? error.message
          : error instanceof ZodError
            ? (error.issues[0]?.message ?? "That input doesn't look right.")
            : "That failed on the server. Try again, or another tool.",
      },
    ],
    isError: true,
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

export type McpHandler = (request: Request) => Promise<Response>;

export function createClientManagerMcp(graph: GraphTools): McpHandler {
  /** Runs a tool against the token's Book, turning refusals into answers. */
  function run<I>(
    work: (
      book: Book,
      input: I,
      claims: McpClaims,
    ) => Outcome | Promise<Outcome>,
  ) {
    return async (input: I, ctx: unknown) => {
      try {
        const claims = claimsOf(ctx);
        const book = await graph.book(
          claims.owner,
          claims.visitor,
          claims.client,
        );
        return answer(await work(book, input, claims));
      } catch (error) {
        return failure(error);
      }
    };
  }

  function register(server: McpServer) {
    server.registerTool(
      "list_clients",
      {
        title: "List clients",
        description:
          "Every client you can see, with id, handle, whether it is yours or a read-only sample, how many facts it has and its persona. Filter by words in the name or persona.",
        inputSchema: z.object({ query: z.string().max(80).optional() }),
        annotations: { readOnlyHint: true },
      },
      run((book, input: { query?: string }) =>
        graph.listClients(book, input.query),
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
      run((book, input: { client: string }) =>
        graph.clientProfile(book, input.client),
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
      run((book, input: { query: string; client?: string }) =>
        graph.search(book, input.query, input.client),
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
      run((book, input: { client: string; keys: string[]; hops: number }) =>
        graph.expand(book, input.client, input.keys.map(bareKey), input.hops),
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
      run((book, input: { client: string; from: string; to: string }) =>
        graph.connect(
          book,
          input.client,
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
      run((book, input: { client: string; category: string }) =>
        graph.browseCategory(book, input.client, input.category),
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
      run((book, input: { client: string; keys: string[] }) =>
        graph.readFacts(book, input.client, input.keys.map(bareKey)),
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
      run((book, input: { client: string }) =>
        graph.listSources(book, input.client),
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
      run((book, input: { client: string; documentId: string }) =>
        graph.readSource(book, input.client, input.documentId),
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
      run((book, input: { client: string }) =>
        graph.researchBrief(book, input.client),
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
        (
          book,
          input: {
            client: string;
            facts: {
              text: string;
              sourceUrl?: string;
              sourceTitle?: string;
            }[];
          },
          claims,
        ) =>
          graph.addFacts(
            { owner: claims.owner, visitor: visitorOfClaims(claims) },
            book,
            input.client,
            input.facts,
          ),
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
      run((book, input: { client: string }) =>
        graph.buildStatus(book, input.client),
      ),
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

  const handler = createMcpHandler(register, {
    serverInfo: { name: MCP_SERVER_NAME, version: "1.0.0" },
  });

  /** Each request's bearer is checked once, by the guest check and by the auth wrapper. */
  const verified = new WeakMap<Request, Promise<McpClaims | null>>();
  function verifiedClaims(request: Request, bearer: string) {
    let claims = verified.get(request);
    if (!claims) {
      claims = verifyBearer(bearer);
      verified.set(request, claims);
    }
    return claims;
  }

  /**
   * Every request carries a Client Manager token, from OAuth or pasted;
   * Guests' tokens die with their pass.
   */
  const authenticated = withMcpAuth(
    handler,
    async (request, bearer) => {
      if (!bearer) return undefined;
      const claims = await verifiedClaims(request, bearer);
      if (!claims) return undefined;
      return {
        token: bearer,
        clientId: `client-manager-${claims.kind}`,
        scopes: ["client-manager"],
        extra: { claims },
      };
    },
    // The 401 names the metadata that leads an MCP client to sign in by OAuth.
    { required: true, resourceMetadataPath: PROTECTED_RESOURCE_PATH },
  );

  /**
   * A Guest signed in with OAuth must also send their guest token. Refused
   * with a 403 that says so, not a 401, which would only send the client to
   * sign in again.
   */
  return async function mcpHandler(request: Request) {
    const bearer = bearerOf(request);
    const claims = bearer ? await verifiedClaims(request, bearer) : null;
    const problem = claims
      ? guestTokenProblem(
          claims,
          request.headers.get(GUEST_TOKEN_HEADER),
          env.rateLimitSalt(),
        )
      : null;
    if (problem) {
      return Response.json(
        { jsonrpc: "2.0", error: { code: -32001, message: problem }, id: null },
        { status: 403, headers: { "cache-control": "no-store" } },
      );
    }
    return authenticated(request);
  };
}

function bearerOf(request: Request) {
  const [type, token] = request.headers.get("authorization")?.split(" ") ?? [];
  return type?.toLowerCase() === "bearer" && token ? token : null;
}
