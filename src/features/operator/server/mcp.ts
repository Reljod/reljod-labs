import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { guestPassStatus } from "@/features/access/domain/guest-pass";
import type { Owner } from "@/features/access/domain/owner";
import { env as accessEnv } from "@/features/access/server/env";
import { guestPassOf } from "@/features/access/server/repository";
import { ACTION_KEYS, ACTION_LIMITS } from "../domain/actions";
import { MODEL_IDS } from "../domain/contract";
import { LIMITS } from "../domain/limits";
import { MCP_TOOLS } from "../domain/mcp-tools";
import { rulebookSchema } from "../domain/rules";
import { taskCards } from "../domain/task-cards";
import { GEOMETRY } from "../legacy/types";
import { SKILLS, skillById } from "../skills";
import { CODE_LIMITS } from "./code-sandbox";
import { env } from "./env";
import { type OperatorClaims, readOperatorToken } from "./mcp-token";
import { runDetail, runsFor } from "./reads";
import {
  currentRulebook,
  insertRulebook,
  ownedRun,
  rulebookVersions,
} from "./repository";
import { clientCall, decideApproval, startRun, stopRun } from "./runs";
import { getFrame } from "./storage";
import type { Visitor } from "./visitor";

/*
 * The Operator MCP server: the one way in for an outside client (ADR 0025).
 * Every tool calls the same server functions as the page's actions and the
 * workflow's steps, so the Access check, the caps, the Guard and the Trail
 * are the same. The `screen_*` tools here are the tools the in-app Operator
 * itself has, on a Run started with `driver: "client"`.
 */

type Caller = { owner: Owner; visitor: Visitor };

type ToolContext = {
  http?: { authInfo?: { extra?: Record<string, unknown> } };
};

function callerOf(ctx: unknown): Caller {
  const caller = (ctx as ToolContext).http?.authInfo?.extra?.caller as
    | Caller
    | undefined;
  if (!caller) throw new Error("Not authorised");
  return caller;
}

type Content =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

function result(data: unknown, text?: string) {
  return {
    content: [{ type: "text" as const, text: text ?? JSON.stringify(data) }],
    structuredContent: data as Record<string, unknown>,
  };
}

function failure(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

const info = (name: string) => {
  const tool = MCP_TOOLS.find((item) => item.name === name);
  if (!tool) throw new Error(`MCP tool ${name} is not in MCP_TOOLS`);
  return tool;
};

const runId = z.string().uuid().describe("The Run's id");

/** A screen tool's answer: what the harness says, and the picture of the Screen. */
async function screenAnswer(
  caller: Caller,
  run: string,
  toolName: string,
  input: unknown,
) {
  const done = await clientCall(caller.owner, run, toolName, input);
  if ("error" in done) return failure(done.error);
  const content: Content[] = [{ type: "text", text: done.text }];
  if (done.frame !== null) {
    const png = await getFrame(run, done.frame);
    if (png)
      content.push({
        type: "image",
        data: png.toString("base64"),
        mimeType: "image/png",
      });
  }
  return { content };
}

export function registerOperatorTools(server: McpServer) {
  const register = server.registerTool.bind(server) as unknown as (
    name: string,
    config: Record<string, unknown>,
    handler: (args: never, ctx: unknown) => Promise<unknown>,
  ) => void;
  const tool = <S extends z.ZodType>(
    name: string,
    description: string,
    inputSchema: S,
    handler: (args: z.infer<S>, caller: Caller) => Promise<unknown>,
    readOnly = false,
  ) =>
    register(
      name,
      {
        title: info(name).title,
        description,
        inputSchema,
        ...(readOnly ? { annotations: { readOnlyHint: true } } : {}),
      },
      async (args, ctx) => handler(args as z.infer<S>, callerOf(ctx)),
    );

  // Runs ---------------------------------------------------------------------------------
  tool(
    "list_tasks",
    "The sample Tasks for HARBOURMASTER (the manifest and berth system of the fictional Port Authority of Meridia): their briefs, traps and Manifests.",
    z.object({}),
    async () => result({ tasks: taskCards() }),
    true,
  );

  tool(
    "start_run",
    `Starts a Run of a Task in HARBOURMASTER, in a sandbox with no network. Give taskId (from list_tasks) or brief (your own words, at most ${LIMITS.taskChars} characters). driver "operator" (default): the in-app Operator keys it; poll get_run. driver "client": you key it yourself with the screen_ tools, through the same Guard; the answer includes the sign-on Screen. Returns the runId.`,
    z.object({
      taskId: z.string().max(60).optional(),
      brief: z.string().max(4000).optional(),
      driver: z.enum(["operator", "client"]).optional(),
      model: z.enum(MODEL_IDS).optional(),
    }),
    async (args, caller) => {
      if (Boolean(args.taskId) === Boolean(args.brief))
        return failure("Give exactly one of taskId or brief.");
      const driver = args.driver ?? "operator";
      const started = await startRun({
        owner: caller.owner,
        visitor: caller.visitor,
        task: args.taskId
          ? { kind: "sample", taskId: args.taskId }
          : { kind: "own", brief: args.brief as string },
        model: args.model,
        driver,
      });
      if ("error" in started) return failure(started.error);
      if (driver === "operator")
        return result(
          { runId: started.runId, status: "running" },
          `Started Run ${started.runId}. The Operator is keying it; poll get_run.`,
        );
      const png = await getFrame(started.runId, 0);
      const content: Content[] = [
        {
          type: "text",
          text: `Started Run ${started.runId}. You are at the keyboard: the Screen (${GEOMETRY.width} by ${GEOMETRY.height} pixels) shows the sign-on. Use the screen_ tools with this runId, load_skill "desk-manual" for the field formats, and finish_run when done.`,
        },
      ];
      if (png)
        content.push({
          type: "image",
          data: png.toString("base64"),
          mimeType: "image/png",
        });
      return { content, structuredContent: { runId: started.runId } };
    },
  );

  tool(
    "get_run",
    "A Run's status, Verdict, Findings, cost, metrics and, while it is paused, the pending Approval.",
    z.object({ runId }),
    async (args, caller) => {
      const detail = await runDetail(caller.owner, args.runId);
      if (!detail) return failure("No such Run.");
      const { events: _events, rulebook: _rulebook, ...rest } = detail;
      return result(rest);
    },
    true,
  );

  tool(
    "list_runs",
    "The Owner's Runs, newest first.",
    z.object({}),
    async (_args, caller) => result({ runs: await runsFor(caller.owner) }),
    true,
  );

  tool(
    "get_trail",
    `A Run's Trail in order: every Turn, Action, Frame, Rule that fired, pause, decision and Finding. At most ${LIMITS.trailEvents} events a call; pass after (a seq) for more.`,
    z.object({
      runId,
      after: z.number().int().min(0).optional(),
    }),
    async (args, caller) => {
      const detail = await runDetail(caller.owner, args.runId);
      if (!detail) return failure("No such Run.");
      const events = detail.events
        .filter((event) => event.seq > (args.after ?? 0))
        .slice(0, LIMITS.trailEvents);
      return result({ events, more: events.length === LIMITS.trailEvents });
    },
    true,
  );

  tool(
    "get_frame",
    "The picture of the Screen after one Action of a Run (Frame 0 is the sign-on Screen), as a PNG.",
    z.object({ runId, n: z.number().int().min(0).max(2000) }),
    async (args, caller) => {
      const run = await ownedRun(caller.owner, args.runId);
      if (!run) return failure("No such Run.");
      const png = await getFrame(run.id, args.n);
      if (!png) return failure("No such Frame.");
      return {
        content: [
          { type: "text", text: `Frame ${args.n} of Run ${run.id}.` },
          {
            type: "image",
            data: png.toString("base64"),
            mimeType: "image/png",
          },
        ] satisfies Content[],
      };
    },
    true,
  );

  tool(
    "stop_run",
    "Stops a Run and removes its sandboxes. What was already keyed stays in the Trail.",
    z.object({ runId }),
    async (args, caller) => {
      const stopped = await stopRun(caller.owner, args.runId);
      return "error" in stopped && stopped.error
        ? failure(stopped.error)
        : result(stopped);
    },
  );

  tool(
    "decide_approval",
    'Approves or refuses the pending guarded Action of a Run the in-app Operator drives. Refused for a Run you drive yourself (driver "client"): nobody approves their own key, a person does it in the app.',
    z.object({
      runId,
      approvalId: z.string().uuid(),
      decision: z.enum(["approved", "refused"]),
    }),
    async (args, caller) => {
      const decided = await decideApproval({
        owner: caller.owner,
        ...args,
        by: "client",
      });
      return "error" in decided ? failure(decided.error) : result(decided);
    },
  );

  // The Screen: the same tools the in-app Operator has -------------------------------------
  const screen = <S extends z.ZodType>(
    name: string,
    description: string,
    schema: S,
  ) =>
    tool(
      name,
      `${description} Only on a Run you started with driver "client". Every input passes the Guard first: a Rule may refuse it, or pause the Run for a person. Returns the Screen as a picture.`,
      schema,
      async (args, caller) => {
        const { runId: run, ...input } = args as { runId: string };
        return screenAnswer(caller, run, name, input);
      },
    );

  screen(
    "screen_capture",
    "Looks at the Screen. Changes nothing.",
    z.object({ runId }),
  );
  screen(
    "screen_click",
    "Clicks a pixel of the Screen: a field, a key in the bottom row, a button in a box.",
    z.object({
      runId,
      x: z
        .number()
        .int()
        .min(0)
        .max(GEOMETRY.width - 1),
      y: z
        .number()
        .int()
        .min(0)
        .max(GEOMETRY.height - 1),
    }),
  );
  screen(
    "screen_type",
    "Types text at the cursor. It does not press Enter or Tab.",
    z.object({ runId, text: z.string().min(1).max(ACTION_LIMITS.typeChars) }),
  );
  screen(
    "screen_key",
    "Presses one or more keys in order.",
    z.object({
      runId,
      keys: z
        .array(z.enum(ACTION_KEYS))
        .min(1)
        .max(ACTION_LIMITS.keysPerAction),
    }),
  );
  screen(
    "screen_scroll",
    "Pages a list forward (down) or back (up).",
    z.object({ runId, direction: z.enum(["down", "up"]) }),
  );
  screen(
    "screen_wait",
    "Waits, then looks again.",
    z.object({
      runId,
      ms: z.number().int().min(100).max(ACTION_LIMITS.waitMs),
    }),
  );

  tool(
    "finish_run",
    "Says the Task of a Run you drive is done. The harness then reads HARBOURMASTER's Books and checks them against the Task and the Rules; your summary decides nothing.",
    z.object({ runId, summary: z.string().max(1500) }),
    async (args, caller) => {
      const done = await clientCall(caller.owner, args.runId, "finish_run", {
        summary: args.summary,
      });
      return "error" in done
        ? failure(done.error)
        : result({ finished: true }, done.text);
    },
  );

  // Work -----------------------------------------------------------------------------------
  tool(
    "run_code",
    `Runs Node.js (ESM) in a sandbox with no network, on a Run you drive: task.txt, manifest.txt (if attached), keyed.json (what the Run changed in the Books so far) and iso6346.mjs are on disk. At most ${LIMITS.codeRunsPerRun} runs a Run. It cannot reach the Screen.`,
    z.object({ runId, code: z.string().min(1).max(CODE_LIMITS.codeChars) }),
    async (args, caller) => {
      const done = await clientCall(caller.owner, args.runId, "run_code", {
        code: args.code,
      });
      return "error" in done ? failure(done.error) : result({}, done.text);
    },
  );

  tool(
    "list_skills",
    "The Skills: playbooks for working HARBOURMASTER.",
    z.object({}),
    async () =>
      result({
        skills: SKILLS.map(({ id, title, description }) => ({
          id,
          title,
          description,
        })),
      }),
    true,
  );

  tool(
    "load_skill",
    "The full text of one Skill. With a runId of a Run you drive it is also noted on that Run's Trail.",
    z.object({ id: z.string().max(60), runId: runId.optional() }),
    async (args, caller) => {
      const skill = skillById(args.id);
      if (!skill) return failure("No such Skill.");
      if (args.runId) {
        const done = await clientCall(caller.owner, args.runId, "load_skill", {
          id: args.id,
        });
        return "error" in done ? failure(done.error) : result({}, done.text);
      }
      const { rulebook } = await currentRulebook(caller.owner);
      return result({ id: skill.id }, skill.body(rulebook));
    },
    true,
  );

  tool(
    "update_plan",
    "Sets your checklist for a Run you drive; the person watching sees it. Send the whole list each time.",
    z.object({
      runId,
      items: z
        .array(z.object({ text: z.string().max(140), done: z.boolean() }))
        .max(20),
    }),
    async (args, caller) => {
      const done = await clientCall(caller.owner, args.runId, "update_plan", {
        items: args.items,
      });
      return "error" in done ? failure(done.error) : result({}, done.text);
    },
  );

  // Rules ----------------------------------------------------------------------------------
  tool(
    "get_rulebook",
    "The current Rulebook (what the Operator may do in HARBOURMASTER) and its version.",
    z.object({}),
    async (_args, caller) => result(await currentRulebook(caller.owner)),
    true,
  );

  tool(
    "save_rulebook",
    "Saves an edited Rulebook as the next version. It applies to the next Run; a Run keeps the version it started under.",
    z.object({
      rulebook: rulebookSchema,
      note: z.string().max(500).optional(),
    }),
    async (args, caller) => {
      const saved = await insertRulebook(
        caller.owner,
        args.rulebook,
        args.note?.trim() || null,
        caller.visitor.trusted ? null : LIMITS.rulebooksPerOwnerPerDay,
      );
      return "refusal" in saved ? failure(saved.refusal) : result(saved);
    },
  );

  tool(
    "list_rulebook_versions",
    "Every version of the Rulebook, newest first, then the Default.",
    z.object({}),
    async (_args, caller) =>
      result({ versions: await rulebookVersions(caller.owner) }),
    true,
  );
}

const handler = createMcpHandler(registerOperatorTools, {
  serverInfo: { name: "operator", version: "1.0.0" },
});

/** Whether a signed token's holder still has Access: a live Guest pass, a Host still on the list. */
async function stillAllowed(claims: OperatorClaims) {
  switch (claims.kind) {
    case "e2e":
      return Boolean(env.e2eBypassToken());
    case "host":
      return Boolean(
        claims.email && accessEnv.hostEmails().includes(claims.email),
      );
    case "guest": {
      if (!claims.user || !claims.pass) return false;
      const pass = await guestPassOf(claims.user);
      if (!pass || pass.id !== claims.pass) return false;
      return (
        guestPassStatus({
          expiresAt: pass.expires_at,
          revokedAt: pass.revoked_at,
          deletedAt: pass.deleted_at,
        }) === "live"
      );
    }
  }
}

/**
 * The Operator MCP server. The only bearer is a token minted for an Owner
 * (`mintMcpToken`, from "Connect a client" on the page), checked against the
 * Owner's Access on every call, so a client acts for that Owner alone and
 * under their limits.
 */
export const mcpHandler = withMcpAuth(
  handler,
  async (_request, bearer) => {
    if (!bearer) return undefined;
    const claims = readOperatorToken(bearer, env.rateLimitSalt());
    if (!claims || !(await stillAllowed(claims))) return undefined;
    return {
      token: bearer,
      clientId: `operator-${claims.kind}`,
      scopes: ["operator"],
      extra: {
        caller: {
          owner: claims.owner,
          visitor: { hash: claims.visitor, trusted: claims.kind === "e2e" },
        } satisfies Caller,
      },
    };
  },
  { required: true },
);
