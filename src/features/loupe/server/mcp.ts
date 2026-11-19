import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler, getPublicOrigin, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { guestPassStatus } from "@/features/access/domain/guest-pass";
import { env as accessEnv } from "@/features/access/server/env";
import { guestPassOf } from "@/features/access/server/repository";
import {
  DOCUMENT_KINDS,
  DRIVERS,
  type Driver,
  METRIC_IDS,
  METRICS,
  type MetricId,
  MODEL_IDS,
  type ModelId,
  SKILL_IDS,
  type ToolId,
  WEIGHTS,
} from "../domain/contract";
import { MANIFEST, RECORDED, sampleCards } from "../domain/corpus";
import { UPLOAD_TYPES } from "../domain/limits";
import { policySchema, ruleSentence, withRule } from "../domain/rules";
import { calibrate, overall } from "../domain/score";
import { skillIndex } from "../skills";
import { endExamination } from "./ending";
import { env } from "./env";
import {
  reevaluate,
  startExamination,
  stopExamination,
  type Who,
} from "./examinations";
import { type LoupeClaims, readLoupeToken } from "./mcp-token";
import { examinationDetail } from "./reads";
import {
  currentRulebook,
  eventsAfter,
  listAudit,
  listExaminations,
  ownedExamination,
} from "./repository";
import { saveRulebookFor } from "./rulebooks";
import { assetPath, download, isAssetKey } from "./storage";
import { MCP_INPUTS, toolDescription } from "./tool-schemas";
import {
  type Caller,
  conclude,
  finish,
  hypothesize,
  loadSkill,
  look,
  reviewFinding,
  runCheck,
  runCode,
  type ToolOutcome,
} from "./tools";
import { openUpload } from "./uploads";

/*
 * The Loupe MCP server (ADR 0028): the one way to Loupe's capabilities. The
 * in-app Examiner calls it in process with a token bound to its Examination;
 * an outside client (Claude) with a token minted for its Owner under
 * "Connect a client". Every tool scopes to the token's Owner and goes through
 * the same server functions, caps, Rules and Trail as the app.
 */

type ToolContext = {
  http?: { authInfo?: { extra?: Record<string, unknown> } };
};

/**
 * Who is calling. The in-app Examiner's token is for the Examiner's own tools
 * on its own Examination and nothing else: every other tool refuses it, so a
 * leaked one cannot start, stop, read or re-decide the Owner's Examinations.
 */
function callerOf(ctx: unknown, examinerTool = false): Caller {
  const caller = (ctx as ToolContext).http?.authInfo?.extra?.caller as
    | Caller
    | undefined;
  if (!caller) throw new Error("Not authorised");
  if (caller.role.kind === "examiner" && !examinerTool)
    throw new Error("Not authorised: this token is for the Examiner's tools.");
  return caller;
}

const whoOf = (caller: Caller): Who => ({
  owner: caller.owner,
  visitor: caller.visitor,
  origin: caller.origin,
  via: "mcp",
});

function result(data: Record<string, unknown>, text?: string) {
  return {
    content: [{ type: "text" as const, text: text ?? JSON.stringify(data) }],
    structuredContent: data,
  };
}

function failure(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

/**
 * A tool's outcome as an MCP result. The in-app Examiner gets the image's
 * asset key (it loads the bytes itself, so they never travel through the
 * workflow's history); an outside client gets the image inline.
 */
function answer(caller: Caller, outcome: ToolOutcome & { finished?: boolean }) {
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

/** Registers one of the Examiner's tools: the same function for the Examiner and a client. */
function examinerTool<S extends z.ZodObject>(
  server: McpServer,
  id: ToolId,
  schema: S,
  work: (
    caller: Caller,
    input: z.infer<S>,
  ) => Promise<ToolOutcome & { finished?: boolean }>,
) {
  server.registerTool(
    id,
    {
      title: id,
      description: toolDescription(id),
      inputSchema: schema as z.ZodObject,
    },
    async (args: unknown, ctx: unknown) => {
      try {
        const caller = callerOf(ctx, true);
        return answer(caller, await work(caller, args as z.infer<S>));
      } catch (error) {
        console.error(`[loupe] mcp ${id}`, error);
        return failure(`${id} failed on our side. Try again.`);
      }
    },
  );
}

const metricSchema = z.enum(METRIC_IDS as [MetricId, ...MetricId[]]);

export function registerLoupeTools(server: McpServer) {
  // The Examiner's tools ---------------------------------------------------------
  examinerTool(server, "look", MCP_INPUTS.look, (caller, input) =>
    look(caller, input),
  );
  examinerTool(server, "run_check", MCP_INPUTS.run_check, (caller, input) =>
    runCheck(caller, input),
  );
  examinerTool(server, "run_code", MCP_INPUTS.run_code, (caller, input) =>
    runCode(caller, input),
  );
  examinerTool(server, "hypothesize", MCP_INPUTS.hypothesize, (caller, input) =>
    hypothesize(caller, input),
  );
  examinerTool(server, "conclude", MCP_INPUTS.conclude, (caller, input) =>
    conclude(caller, input),
  );
  examinerTool(
    server,
    "review_finding",
    MCP_INPUTS.review_finding,
    (caller, input) => reviewFinding(caller, input),
  );
  examinerTool(server, "finish", MCP_INPUTS.finish, async (caller, input) => {
    const outcome = await finish(caller, input);
    // A client's own Examination has no workflow waiting to end it.
    if (outcome.finished && caller.role.kind === "client")
      await endExamination(input.examinationId, {
        status: "completed",
        summary: input.summary,
      });
    return outcome;
  });
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
    async (args, ctx) => {
      const caller = callerOf(ctx, true);
      return answer(caller, await loadSkill(caller, args));
    },
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
    async (_args, ctx) => {
      callerOf(ctx);
      return result({
        samples: sampleCards().map(({ pages, file: _file, ...card }) => ({
          ...card,
          pages: pages.length,
        })),
      });
    },
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
    async (args, ctx) => {
      const opened = await openUpload(whoOf(callerOf(ctx)), args);
      return "error" in opened ? failure(opened.error) : result(opened);
    },
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
    async (args, ctx) => {
      if (Boolean(args.sampleId) === Boolean(args.uploadId))
        return failure("Give exactly one of sampleId or uploadId.");
      const started = await startExamination(whoOf(callerOf(ctx)), {
        source: args.sampleId
          ? { kind: "sample", sampleId: args.sampleId }
          : { kind: "upload", uploadId: args.uploadId as string },
        driver: args.mode,
        model: args.model,
      });
      if ("error" in started) return failure(started.error);
      return result(
        { examinationId: started.examinationId, status: "running" },
        `Started Examination ${started.examinationId}. Poll get_examination.`,
      );
    },
  );

  server.registerTool(
    "stop_examination",
    {
      title: "Stop an Examination",
      description: "Stops one of your Examinations that is still going.",
      inputSchema: z.object({ examinationId: z.string().uuid() }),
    },
    async (args, ctx) => {
      const stopped = await stopExamination(
        whoOf(callerOf(ctx)),
        args.examinationId,
      );
      return "error" in stopped
        ? failure(stopped.error ?? "It could not be stopped.")
        : result(stopped);
    },
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
      result({ examinations: await listExaminations(callerOf(ctx).owner) }),
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
    async (args, ctx) => {
      const detail = await examinationDetail(
        callerOf(ctx).owner,
        args.examinationId,
      );
      if (!detail) return failure("No such Examination.");
      const { events: _events, measurements, ...rest } = detail;
      return result({ ...rest, measurements: measurements.length });
    },
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
    async (args, ctx) => {
      const caller = callerOf(ctx);
      const row = await ownedExamination(caller.owner, args.examinationId);
      if (!row) return failure("No such Examination.");
      const ref = args.findingId
        ? row.state.measurements.find((item) => item.id === args.findingId)
            ?.layer
        : row.pages[(args.page ?? 1) - 1]?.image;
      if (!ref)
        return failure(
          args.findingId
            ? "That Finding has no Evidence layer."
            : "No such page.",
        );
      if (ref.startsWith("/"))
        return result(
          { url: `${caller.origin}${ref}` },
          `A Sample's static file: ${caller.origin}${ref}`,
        );
      if (!isAssetKey(ref)) return failure("No such image.");
      const bytes = await download(assetPath(row.owner, row.id, ref));
      if (!bytes) return failure("The image is gone.");
      return {
        content: [
          { type: "text" as const, text: ref },
          {
            type: "image" as const,
            data: bytes.toString("base64"),
            mimeType: ref.endsWith(".png") ? "image/png" : "image/jpeg",
          },
        ],
      };
    },
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
    async (args, ctx) => {
      const caller = callerOf(ctx);
      if (!args.examinationId)
        return result({ audit: await listAudit(caller.owner) });
      const row = await ownedExamination(caller.owner, args.examinationId);
      if (!row) return failure("No such Examination.");
      const events = await eventsAfter(
        row.id,
        args.after ?? 0,
        args.limit ?? 60,
      );
      return result({
        events,
        next: events.at(-1)?.seq ?? args.after ?? 0,
      });
    },
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
    async (_args, ctx) => {
      const current = await currentRulebook(callerOf(ctx).owner);
      return result({
        version: current.version,
        rules: METRIC_IDS.map((id) => ({
          id,
          label: METRICS[id].label,
          sentence: ruleSentence(id, current.rulebook.rules[id].threshold),
          ...current.rulebook.rules[id],
        })),
        policy: current.rulebook.policy,
      });
    },
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
    async (args, ctx) => {
      const who = whoOf(callerOf(ctx));
      const current = await currentRulebook(who.owner);
      let next = current.rulebook;
      if (args.rule) {
        next = withRule(next, args.rule, {
          ...(args.threshold !== undefined
            ? { threshold: args.threshold }
            : {}),
          ...(args.weight ? { weight: args.weight } : {}),
          ...(args.enabled !== undefined ? { enabled: args.enabled } : {}),
          ...(args.kinds ? { kinds: args.kinds } : {}),
        });
      }
      if (args.policy)
        next = { ...next, policy: { ...next.policy, ...args.policy } };
      const saved = await saveRulebookFor(who, {
        rulebook: next,
        note: args.note,
      });
      return "error" in saved ? failure(saved.error) : result(saved);
    },
  );

  server.registerTool(
    "reevaluate",
    {
      title: "Re-evaluate an Examination",
      description:
        "Decides a completed Examination again under your current Rulebook, from its stored Measurements. No model call and no Sandbox. Returns the Verdict before and after.",
      inputSchema: z.object({ examinationId: z.string().uuid() }),
    },
    async (args, ctx) => {
      const done = await reevaluate(whoOf(callerOf(ctx)), args.examinationId);
      return "error" in done ? failure(done.error) : result(done);
    },
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
    async (_args, ctx) => {
      const current = await currentRulebook(callerOf(ctx).owner);
      const calibration = calibrate(MANIFEST, RECORDED, current.rulebook);
      return result({
        rulebookVersion: current.version,
        overall: overall(calibration),
        ...calibration,
      });
    },
  );
}

const handler = createMcpHandler(registerLoupeTools, {
  serverInfo: { name: "loupe", version: "1.0.0" },
});

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
 * The Loupe MCP server. The only bearers are tokens this server signed: an
 * Owner's (from "Connect a client"), checked against the Owner's Access on
 * every call, or the in-app Examiner's, bound to one Examination.
 */
export const mcpHandler = withMcpAuth(
  handler,
  async (request, bearer) => {
    if (!bearer) return undefined;
    const claims = readLoupeToken(bearer, env.rateLimitSalt());
    if (!claims || !(await stillAllowed(claims))) return undefined;
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
      extra: { caller },
    };
  },
  { required: true },
);
