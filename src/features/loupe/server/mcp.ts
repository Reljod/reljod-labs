import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler, getPublicOrigin, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { guestPassStatus } from "@/features/access/domain/guest-pass";
import { env as accessEnv } from "@/features/access/server/env";
import { guestPassOf } from "@/features/access/server/repository";
import { isAppError } from "@/platform/errors";
import {
  DOCUMENT_KINDS,
  DRIVERS,
  type Driver,
  METRIC_IDS,
  type MetricId,
  MODEL_IDS,
  type ModelId,
  SKILL_IDS,
  type ToolId,
  WEIGHTS,
} from "../domain/contract";
import { sampleCards } from "../domain/corpus";
import { UPLOAD_TYPES } from "../domain/limits";
import { policySchema } from "../domain/rules";
import { skillIndex } from "../skills";
import { env } from "./env";
import { type LoupeClaims, readLoupeToken } from "./mcp-token";
import type { Caller, Who } from "./ports";
import type { LoupeServices } from "./services";
import type { ToolOutcome } from "./services/tools";
import { MCP_INPUTS, toolDescription } from "./tool-schemas";

/*
 * The Loupe MCP server (ADR 0028): the one way to Loupe's capabilities. The
 * in-app Examiner calls it in process with a token bound to its Examination;
 * an outside client (Claude) with a token minted for its Owner under
 * "Connect a client". Every tool scopes to the token's Owner and calls the
 * same services as the REST routes, so the caps, Rules, Trail and Audit
 * trail hold whoever calls.
 */

type ToolContext = {
  http?: {
    authInfo?: {
      extra?: { caller?: Caller; services?: LoupeServices };
    };
  };
};

/**
 * Who is calling, and the services the token reaches. The in-app
 * Examiner's token is for the Examiner's own tools on its own Examination
 * and nothing else: every other tool refuses it, so a leaked one cannot
 * start, stop, read or re-decide the Owner's Examinations.
 */
function contextOf(ctx: unknown, examinerTool = false) {
  const extra = (ctx as ToolContext).http?.authInfo?.extra;
  if (!extra?.caller || !extra.services) throw new Error("Not authorised");
  if (extra.caller.role.kind === "examiner" && !examinerTool)
    throw new Error("Not authorised: this token is for the Examiner's tools.");
  return { caller: extra.caller, services: extra.services };
}

const whoOf = (caller: Caller): Who => ({
  owner: caller.owner,
  visitor: caller.visitor,
  origin: caller.origin,
  via: "mcp",
});

function result(data: object, text?: string) {
  return {
    content: [{ type: "text" as const, text: text ?? JSON.stringify(data) }],
    structuredContent: data as Record<string, unknown>,
  };
}

function failure(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

/**
 * Runs a tool: a service's refusal (an AppError) is answered with its
 * message for the caller to act on; anything else is logged and answered
 * plainly.
 */
async function guarded<T>(
  id: string,
  work: () => Promise<T>,
): Promise<T | ReturnType<typeof failure>> {
  try {
    return await work();
  } catch (error) {
    if (isAppError(error)) return failure(error.message);
    if (error instanceof Error && error.message.startsWith("Not authorised"))
      return failure(error.message);
    console.error(`[loupe] mcp ${id}`, error);
    return failure(`${id} failed on our side. Try again.`);
  }
}

/**
 * A tool's outcome as an MCP result. The in-app Examiner gets the image's
 * asset key (it loads the bytes itself, so they never travel through the
 * workflow's history); an outside client gets the image inline.
 */
function answer(caller: Caller, outcome: ToolOutcome) {
  const inline = outcome.image && caller.role.kind === "client";
  return {
    content: [
      { type: "text" as const, text: outcome.text },
      ...(inline && outcome.image
        ? [
            {
              type: "image" as const,
              data: outcome.image.bytes.toString("base64"),
              mimeType: outcome.image.mediaType,
            },
          ]
        : []),
    ],
    structuredContent: {
      ok: outcome.ok,
      ...(outcome.image ? { imageKey: outcome.image.key } : {}),
      ...(outcome.finished ? { finished: true } : {}),
      ...(outcome.data ?? {}),
    },
    ...(outcome.ok ? {} : { isError: true }),
  };
}

/** Registers one of the Examiner's tools: the same service for the Examiner and a client. */
function examinerTool<S extends z.ZodObject>(
  server: McpServer,
  id: ToolId,
  schema: S,
  work: (
    services: LoupeServices,
    caller: Caller,
    input: z.infer<S>,
  ) => Promise<ToolOutcome>,
) {
  server.registerTool(
    id,
    {
      title: id,
      description: toolDescription(id),
      inputSchema: schema as z.ZodObject,
    },
    async (args: unknown, ctx: unknown) =>
      guarded(id, async () => {
        const { caller, services } = contextOf(ctx, true);
        return answer(caller, await work(services, caller, args as z.infer<S>));
      }),
  );
}

const metricSchema = z.enum(METRIC_IDS as [MetricId, ...MetricId[]]);

export function registerLoupeTools(server: McpServer) {
  // The Examiner's tools ---------------------------------------------------------
  examinerTool(server, "look", MCP_INPUTS.look, (s, caller, input) =>
    s.tools.look(caller, input),
  );
  examinerTool(server, "run_check", MCP_INPUTS.run_check, (s, caller, input) =>
    s.tools.runCheck(caller, input),
  );
  examinerTool(server, "run_code", MCP_INPUTS.run_code, (s, caller, input) =>
    s.tools.runCode(caller, input),
  );
  examinerTool(
    server,
    "hypothesize",
    MCP_INPUTS.hypothesize,
    (s, caller, input) => s.tools.hypothesize(caller, input),
  );
  examinerTool(server, "conclude", MCP_INPUTS.conclude, (s, caller, input) =>
    s.tools.conclude(caller, input),
  );
  examinerTool(
    server,
    "review_finding",
    MCP_INPUTS.review_finding,
    (s, caller, input) => s.tools.reviewFinding(caller, input),
  );
  examinerTool(server, "finish", MCP_INPUTS.finish, (s, caller, input) =>
    s.tools.finish(caller, input),
  );
  server.registerTool(
    "load_skill",
    {
      title: "load_skill",
      description: `${toolDescription("load_skill")} Skills:\n${skillIndex()}`,
      inputSchema: z.object({
        skill: z.enum(SKILL_IDS),
        examinationId: z.string().uuid().optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async (args, ctx) =>
      guarded("load_skill", async () => {
        const { caller, services } = contextOf(ctx, true);
        return answer(caller, await services.tools.loadSkill(caller, args));
      }),
  );

  // Documents and Examinations ----------------------------------------------------
  server.registerTool(
    "list_samples",
    {
      title: "List the Samples",
      description:
        "The synthetic Documents (fictional Republic of Meridia, SPECIMEN) Loupe can examine: payslips, statements, bills, invoices and identity cards. A card never says whether its Document was tampered with.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async (_args, ctx) =>
      guarded("list_samples", async () => {
        contextOf(ctx);
        return result({
          samples: sampleCards().map(({ pages, file: _file, ...card }) => ({
            ...card,
            pages: pages.length,
          })),
        });
      }),
  );

  server.registerTool(
    "create_upload",
    {
      title: "Open an Upload",
      description: `Opens an Upload for your own Document and returns a signed URL. PUT the file's bytes to signedUrl (header "content-type" as given, then "x-upsert: false"), then call start_examination with the uploadId. PDF, JPEG, PNG or WebP. The file is yours: private, never used as a Sample.`,
      inputSchema: z.object({
        title: z.string().min(1).max(120),
        contentType: z.enum(Object.keys(UPLOAD_TYPES) as [string, ...string[]]),
        bytes: z.number().int().min(1),
        kind: z.enum(DOCUMENT_KINDS).optional(),
      }),
    },
    async (args, ctx) =>
      guarded("create_upload", async () => {
        const { caller, services } = contextOf(ctx);
        return result(await services.uploads.open(whoOf(caller), args));
      }),
  );

  server.registerTool(
    "start_examination",
    {
      title: "Start an Examination",
      description: `Starts an Examination of a Sample (sampleId from list_samples) or of your Upload (uploadId). mode: ${(
        Object.entries(DRIVERS) as [Driver, string][]
      )
        .map(([id, label]) => `"${id}" (${label})`)
        .join(
          ", ",
        )}. "examiner" runs Loupe's own Examiner; "sweep" runs only the model-free Checks; "client" runs the Sweep and then leaves the Examiner's tools (look, run_check, run_code, hypothesize, conclude, review_finding, finish) to you. Returns an examinationId at once; poll get_examination.`,
      inputSchema: z.object({
        sampleId: z.string().max(60).optional(),
        uploadId: z.string().uuid().optional(),
        mode: z.enum(Object.keys(DRIVERS) as [Driver, ...Driver[]]).optional(),
        model: z.enum(MODEL_IDS as [ModelId, ...ModelId[]]).optional(),
      }),
    },
    async (args, ctx) =>
      guarded("start_examination", async () => {
        if (Boolean(args.sampleId) === Boolean(args.uploadId))
          return failure("Give exactly one of sampleId or uploadId.");
        const { caller, services } = contextOf(ctx);
        const started = await services.examinations.start(whoOf(caller), {
          source: args.sampleId
            ? { kind: "sample", sampleId: args.sampleId }
            : { kind: "upload", uploadId: args.uploadId as string },
          driver: args.mode,
          model: args.model,
        });
        return result(
          { examinationId: started.examinationId, status: "running" },
          `Started Examination ${started.examinationId}. Poll get_examination.`,
        );
      }),
  );

  server.registerTool(
    "stop_examination",
    {
      title: "Stop an Examination",
      description: "Stops one of your Examinations that is still going.",
      inputSchema: z.object({ examinationId: z.string().uuid() }),
    },
    async (args, ctx) =>
      guarded("stop_examination", async () => {
        const { caller, services } = contextOf(ctx);
        return result(
          await services.examinations.stop(whoOf(caller), args.examinationId),
        );
      }),
  );

  server.registerTool(
    "list_examinations",
    {
      title: "List Examinations",
      description: "Your Examinations, newest first, with status and Verdict.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async (_args, ctx) =>
      guarded("list_examinations", async () => {
        const { caller, services } = contextOf(ctx);
        return result({
          examinations: await services.examinations.list(caller.owner),
        });
      }),
  );

  server.registerTool(
    "get_examination",
    {
      title: "Get an Examination",
      description:
        "An Examination's status, cost, Verdict with its reasons, Findings (place, measured value against the Rule's threshold, Weight, the code run that produced it), Hypotheses, the Done gate and the Score when the truth is known. Evidence layers are named by `layer`; fetch one with get_evidence.",
      inputSchema: z.object({ examinationId: z.string().uuid() }),
      annotations: { readOnlyHint: true },
    },
    async (args, ctx) =>
      guarded("get_examination", async () => {
        const { caller, services } = contextOf(ctx);
        const {
          events: _events,
          measurements,
          ...rest
        } = await services.examinations.detail(
          caller.owner,
          args.examinationId,
        );
        return result({ ...rest, measurements: measurements.length });
      }),
  );

  server.registerTool(
    "get_evidence",
    {
      title: "Get an Evidence image",
      description:
        "An image of an Examination: a page (`page`), or the Evidence layer of a Finding (`findingId`), which code drew over the page. Returns the image.",
      inputSchema: z.object({
        examinationId: z.string().uuid(),
        page: z.number().int().min(1).max(200).optional(),
        findingId: z.string().max(12).optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async (args, ctx) =>
      guarded("get_evidence", async () => {
        const { caller, services } = contextOf(ctx);
        const evidence = await services.examinations.evidence(caller, args);
        if (evidence.kind === "url")
          return result(
            { url: evidence.url },
            `A Sample's static file: ${evidence.url}`,
          );
        return {
          content: [
            { type: "text" as const, text: evidence.ref },
            {
              type: "image" as const,
              data: evidence.bytes.toString("base64"),
              mimeType: evidence.mediaType,
            },
          ],
        };
      }),
  );

  server.registerTool(
    "read_trail",
    {
      title: "Read the Trail",
      description:
        "With an examinationId: that Examination's Trail (every model call with cost, tool call, code run with its output, Measurement and Rulebook version), in order, after `after`. Without one: your Audit trail (Rulebooks saved, Uploads, tokens, Re-evaluates).",
      inputSchema: z.object({
        examinationId: z.string().uuid().optional(),
        after: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async (args, ctx) =>
      guarded("read_trail", async () => {
        const { caller, services } = contextOf(ctx);
        if (!args.examinationId)
          return result({
            audit: await services.examinations.audit(caller.owner),
          });
        return result(
          await services.examinations.trailPage(
            caller.owner,
            args.examinationId,
            args.after ?? 0,
            args.limit ?? 60,
          ),
        );
      }),
  );

  // Rules -------------------------------------------------------------------------
  server.registerTool(
    "list_rules",
    {
      title: "List the Rules",
      description:
        "Your current Rulebook: each Rule's sentence, threshold, Weight (decisive, supporting, context), the Document kinds it applies to, and the Policy that turns Findings into a Verdict.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async (_args, ctx) =>
      guarded("list_rules", async () => {
        const { caller, services } = contextOf(ctx);
        return result(await services.rulebooks.rules(caller.owner));
      }),
  );

  server.registerTool(
    "edit_rule",
    {
      title: "Edit a Rule",
      description:
        "Changes one Rule (threshold, Weight, on or off, Document kinds) or the Policy, and saves your Rulebook as a new version. Finished Examinations keep their Verdict until you reevaluate them.",
      inputSchema: z.object({
        rule: metricSchema.optional(),
        threshold: z.number().finite().min(0).optional(),
        weight: z.enum(WEIGHTS).optional(),
        enabled: z.boolean().optional(),
        kinds: z.array(z.enum(DOCUMENT_KINDS)).optional(),
        policy: policySchema.partial().optional(),
        note: z.string().max(500).optional(),
      }),
    },
    async (args, ctx) =>
      guarded("edit_rule", async () => {
        const { caller, services } = contextOf(ctx);
        return result(await services.rulebooks.edit(whoOf(caller), args));
      }),
  );

  server.registerTool(
    "reevaluate",
    {
      title: "Re-evaluate an Examination",
      description:
        "Decides a completed Examination again under your current Rulebook, from its stored Measurements. No model call and no Sandbox. Returns the Verdict before and after.",
      inputSchema: z.object({ examinationId: z.string().uuid() }),
    },
    async (args, ctx) =>
      guarded("reevaluate", async () => {
        const { caller, services } = contextOf(ctx);
        return result(
          await services.examinations.reevaluate(
            whoOf(caller),
            args.examinationId,
          ),
        );
      }),
  );

  server.registerTool(
    "get_calibration",
    {
      title: "Get the Calibration",
      description:
        "How the model-free Sweep under your current Rulebook does on the Corpus: detection rate and false-positive rate per split (train, validation, test), per Tamper type, and which Documents it misses or flags wrongly. Evidence for a human reviewer, with its measured error rates.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async (_args, ctx) =>
      guarded("get_calibration", async () => {
        const { caller, services } = contextOf(ctx);
        return result(await services.rulebooks.calibration(caller.owner));
      }),
  );
}

/** Whether a signed token's holder still has Access: a live Guest pass, a Host still on the list. */
async function stillAllowed(claims: LoupeClaims) {
  switch (claims.kind) {
    case "examiner":
      // Minted by the workflow for one Examination, minutes long; the
      // Examination itself is checked against the Owner on every call.
      return true;
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
 * The Loupe MCP server on the services a token reaches. The only bearers
 * are tokens this server signed: an Owner's (from "Connect a client"),
 * checked against the Owner's Access on every call, or the in-app
 * Examiner's, bound to one Examination. Only the e2e suite's tokens and the
 * Examiner's tokens of an Examination it started reach the stubbed
 * services; the stub flag is part of the signed claims.
 */
export function createLoupeMcpHandler(
  servicesFor: (stub: boolean) => LoupeServices,
) {
  const handler = createMcpHandler(registerLoupeTools, {
    serverInfo: { name: "loupe", version: "1.0.0" },
  });
  return withMcpAuth(
    handler,
    async (request, bearer) => {
      if (!bearer) return undefined;
      const claims = readLoupeToken(bearer, env.rateLimitSalt());
      if (!claims || !(await stillAllowed(claims))) return undefined;
      const stub =
        claims.stub === true &&
        (claims.kind === "e2e" || claims.kind === "examiner");
      const caller: Caller = {
        owner: claims.owner,
        visitor: {
          hash: claims.visitor,
          trusted: claims.kind === "e2e" || claims.trusted === true,
        },
        role:
          claims.kind === "examiner" && claims.examinationId
            ? { kind: "examiner", examinationId: claims.examinationId }
            : { kind: "client" },
        origin:
          claims.kind === "examiner"
            ? (claims.origin ?? "")
            : getPublicOrigin(request),
      };
      return {
        token: bearer,
        clientId: `loupe-${claims.kind}`,
        scopes: ["loupe"],
        extra: { caller, services: servicesFor(stub) },
      };
    },
    { required: true },
  );
}
