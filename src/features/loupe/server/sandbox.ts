import "server-only";
import { Sandbox } from "@vercel/sandbox";
import { z } from "zod";
import {
  type Box,
  type CheckId,
  DOCUMENT_KINDS,
  type DocumentFormat,
  type DocumentKind,
  type RawMeasurement,
  rawMeasurementSchema,
} from "../domain/contract";
import { LIMITS } from "../domain/limits";
import { env } from "./env";
import {
  examinationStatus,
  forgetSnapshot,
  isOver,
  saveSnapshot,
  snapshotFor,
} from "./repository";
import toolkit from "./toolkit.generated.json";

/**
 * One Vercel Sandbox per Examination, named after it, with no network
 * (ADR 0022, ADR 0027). It starts from a snapshot that holds the Toolkit's
 * Python packages; the Toolkit's own source and the Document are written
 * when it is made. The Sweep, every Check and every piece of the Examiner's
 * code run here. Auth is the deployment's OIDC token (VERCEL_OIDC_TOKEN
 * locally).
 */
export const SANDBOX_LIMITS = {
  /** Wall time of one command (a Check, the Sweep, the Examiner's code). */
  commandMs: 60_000,
  /** The Sandbox's own lifetime when made; each command extends it when little is left. */
  sandboxMs: 10 * 60_000,
  extendBelowMs: 2 * 60_000,
  extendByMs: 5 * 60_000,
  outputChars: 6_000,
  /** Bytes of stdout and of stderr read back; the rest is cut in the Sandbox. */
  outputBytes: 24_000,
  /** The most either stream may write to disk before the command is killed (SIGXFSZ). */
  outputFileBlocks: 20_000,
  /** Evidence layers taken from one run, and the size of each. */
  layersPerRun: 8,
  layerBytes: 1_500_000,
  /** Measurements taken from one run. */
  measurementsPerRun: 60,
  /**
   * How long the snapshot with the Python packages is kept. Storage is
   * billed while it exists, so it expires and the next Examination after
   * that rebuilds it (`open` forgets a snapshot that is gone). Never 0,
   * which means never expire.
   */
  snapshotMs: 24 * 60 * 60_000,
} as const;

const IMAGE = "vercel/sandbox/python:3.14";
/** Everything of an Examination lives under here in its Sandbox. */
export const WORK = "/tmp/loupe";
const TOOLKIT_DIR = `${WORK}/toolkit`;

const bundle = toolkit as {
  requirements: string;
  requirementsHash: string;
  hash: string;
  readme: string;
  files: Record<string, string>;
};

export const TOOLKIT_README = bundle.readme;
export const TOOLKIT_HASH = bundle.hash;

export function sandboxName(examinationId: string) {
  return `loupe-${examinationId}`;
}

export class SandboxUnavailable extends Error {
  constructor(message = "Sandbox unavailable: it is not set up here.") {
    super(message);
    this.name = "SandboxUnavailable";
  }
}

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

// The snapshot with the Python packages ----------------------------------------------

let building: Promise<string> | undefined;

/**
 * Builds the snapshot: a Sandbox with the network open only to install the
 * pinned requirements, then snapshotted and stopped. No Document and no code
 * of the Examiner's ever runs in it.
 */
async function buildSnapshot(): Promise<string> {
  const builder = await Sandbox.create({
    image: IMAGE,
    timeout: 10 * 60_000,
    persistent: false,
  });
  try {
    await builder.writeFiles([
      { path: "/tmp/requirements.txt", content: bundle.requirements },
    ]);
    const install = await builder.runCommand({
      cmd: "python3",
      args: [
        "-m",
        "pip",
        "install",
        "--quiet",
        "--no-cache-dir",
        "--disable-pip-version-check",
        "-r",
        "/tmp/requirements.txt",
      ],
      timeoutMs: 8 * 60_000,
    });
    if (install.exitCode !== 0) {
      console.error("[loupe] snapshot install failed", await install.stderr());
      throw new SandboxUnavailable(
        "Sandbox unavailable: the Toolkit could not be installed.",
      );
    }
    const snapshot = await builder.snapshot({
      expiration: SANDBOX_LIMITS.snapshotMs,
    });
    await saveSnapshot(bundle.requirementsHash, snapshot.snapshotId);
    return snapshot.snapshotId;
  } catch (error) {
    try {
      await builder.stop();
    } catch {
      // Already stopped by the snapshot, or never started.
    }
    throw error;
  }
}

/** The snapshot for the current requirements, built on first use. */
export async function ensureSnapshot(): Promise<string> {
  if (!env.sandboxConfigured()) throw new SandboxUnavailable();
  const known = await snapshotFor(bundle.requirementsHash);
  if (known) return known;
  building ??= buildSnapshot().finally(() => {
    building = undefined;
  });
  return building;
}

// One Sandbox per Examination ----------------------------------------------------------

export type DocumentFile = { bytes: Buffer; fileName: string };

function toolkitFiles() {
  return Object.entries(bundle.files).map(([path, content]) => ({
    path: `${TOOLKIT_DIR}/${path}`,
    content,
  }));
}

/** `input.<ext>` from a file name whose extension is one we know; never the name itself. */
function inputName(fileName: string) {
  const ext = /\.(pdf|jpg|jpeg|png|webp)$/i.exec(fileName)?.[1]?.toLowerCase();
  return `input.${ext === "jpeg" ? "jpg" : (ext ?? "bin")}`;
}

async function seed(sandbox: Sandbox, document: () => Promise<DocumentFile>) {
  const file = await document();
  const name = inputName(file.fileName);
  await sandbox.runCommand("mkdir", [
    "-p",
    `${WORK}/doc`,
    `${WORK}/out`,
    `${WORK}/code`,
    `${TOOLKIT_DIR}/loupe/checks`,
  ]);
  await sandbox.writeFiles([
    ...toolkitFiles(),
    {
      path: `${WORK}/doc/${name}`,
      content: file.bytes,
    },
    { path: `${WORK}/doc/name.txt`, content: name },
  ]);
}

async function create(
  examinationId: string,
  snapshotId: string,
  document: () => Promise<DocumentFile>,
) {
  return Sandbox.getOrCreate({
    name: sandboxName(examinationId),
    source: { type: "snapshot", snapshotId },
    networkPolicy: "deny-all",
    timeout: SANDBOX_LIMITS.sandboxMs,
    persistent: false,
    onCreate: async (created) => {
      try {
        await seed(created, document);
      } catch (error) {
        // Never leave a half-made named Sandbox behind for a retry to pick up.
        await created.stop().catch(() => {});
        await created.delete({ deleteOrphanSnapshots: true }).catch(() => {});
        throw error;
      }
    },
    onResume: async (resumed) => {
      await seed(resumed, document);
    },
  });
}

const DOCUMENT_ERROR = /^(The Sample|No such Sample|The Upload|The Document)/;

/**
 * The Examination's Sandbox, made on first use. A snapshot that is gone
 * (expired, deleted) is rebuilt once.
 */
async function open(
  examinationId: string,
  document: () => Promise<DocumentFile>,
): Promise<Sandbox> {
  if (!env.sandboxConfigured()) throw new SandboxUnavailable();
  let sandbox: Sandbox;
  try {
    sandbox = await create(examinationId, await ensureSnapshot(), document);
  } catch (error) {
    if (error instanceof SandboxUnavailable) throw error;
    if (DOCUMENT_ERROR.test(message(error))) throw error;
    if (!/snapshot/i.test(message(error))) {
      console.error("[loupe] sandbox create failed", error);
      throw new SandboxUnavailable(
        "Sandbox unavailable: it could not be started.",
      );
    }
    await forgetSnapshot(bundle.requirementsHash);
    try {
      sandbox = await create(examinationId, await ensureSnapshot(), document);
    } catch (again) {
      if (again instanceof SandboxUnavailable) throw again;
      if (DOCUMENT_ERROR.test(message(again))) throw again;
      console.error("[loupe] sandbox create failed after rebuild", again);
      throw new SandboxUnavailable(
        "Sandbox unavailable: it could not be started.",
      );
    }
  }
  // getOrCreate may hand back a Sandbox made with another policy: enforce it.
  // The same for persistence: a persistent Sandbox snapshots its whole disk
  // on every stop, and nothing here ever resumes one.
  await sandbox.update({ networkPolicy: "deny-all", persistent: false });
  const expires = sandbox.expiresAt?.getTime();
  if (
    expires !== undefined &&
    expires - Date.now() < SANDBOX_LIMITS.extendBelowMs
  ) {
    try {
      await sandbox.extendTimeout(SANDBOX_LIMITS.extendByMs);
    } catch {
      // At the plan's limit: the command has whatever time is left.
    }
  }
  return sandbox;
}

/** Stops and deletes the Examination's Sandbox, if it has one. Best effort. */
export async function disposeSandbox(examinationId: string) {
  if (!env.sandboxConfigured()) return;
  try {
    const sandbox = await Sandbox.get({ name: sandboxName(examinationId) });
    try {
      await sandbox.stop();
    } catch {
      // Already stopped.
    }
    // `delete` keeps a Sandbox's snapshots unless asked.
    await sandbox.delete({ deleteOrphanSnapshots: true });
  } catch {
    // No Sandbox was made for this Examination, or it is already gone.
  }
}

// Running a command -----------------------------------------------------------------------

const COMMAND_SECONDS = Math.floor(SANDBOX_LIMITS.commandMs / 1000) - 2;

/**
 * Runs "$@" with stdout and stderr to files (each capped on disk by
 * `ulimit -f`), then prints at most `outputBytes` of each and exits with the
 * command's own exit code. Output is cut in the Sandbox, so reading it back
 * never loads more than a few KB, however much the code printed.
 */
export const RUNNER_SCRIPT = [
  `ulimit -f ${SANDBOX_LIMITS.outputFileBlocks} 2>/dev/null`,
  'log="$1"; shift',
  `mkdir -p "${WORK}/out" && cd "${WORK}"`,
  // A Sandbox resumed on a fresh disk has its files again (onResume) but not
  // the rendered pages: render them once before any other Toolkit command.
  `[ "$4" = "prepare" ] || [ -f "${WORK}/doc.json" ] || timeout -k 2 ${COMMAND_SECONDS} python3 -m loupe prepare --doc "${WORK}/doc/$(cat "${WORK}/doc/name.txt" 2>/dev/null || echo input.bin)" --work "${WORK}" >/dev/null 2>&1`,
  'out="$log.out"; err="$log.err"',
  // `timeout` kills the process itself; the Sandbox's own timeout would kill only sh.
  `timeout -k 2 ${COMMAND_SECONDS} "$@" >"$out" 2>"$err"`,
  "code=$?",
  `cap() { size=$(wc -c <"$1"); head -c ${SANDBOX_LIMITS.outputBytes} "$1"; if [ "$size" -gt ${SANDBOX_LIMITS.outputBytes} ]; then printf '\\n… [%s more bytes cut]' $((size - ${SANDBOX_LIMITS.outputBytes})); fi; }`,
  'cap "$out"; cap "$err" >&2',
  `[ "$code" = 124 ] && printf '\\nTimed out after ${COMMAND_SECONDS} s.' >&2`,
  `[ "$code" = 153 ] && printf '\\nKilled: the output passed the size limit.' >&2`,
  'rm -f "$out" "$err"',
  'exit "$code"',
].join("\n");

export type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  ms: number;
};

function capOutput(text: string) {
  return text.length > SANDBOX_LIMITS.outputChars
    ? `${text.slice(0, SANDBOX_LIMITS.outputChars)}\n… [${text.length - SANDBOX_LIMITS.outputChars} more characters cut]`
    : text;
}

const safeId = (id: string) => id.replace(/[^\w-]/g, "_").slice(0, 80);

async function run(
  sandbox: Sandbox,
  logName: string,
  command: string[],
  outDir: string,
): Promise<CommandResult> {
  const started = Date.now();
  try {
    const result = await sandbox.runCommand({
      cmd: "sh",
      args: [
        "-c",
        RUNNER_SCRIPT,
        "loupe",
        `${WORK}/out/${logName}`,
        ...command,
      ],
      env: {
        PYTHONPATH: TOOLKIT_DIR,
        LOUPE_WORK: WORK,
        LOUPE_OUT: outDir,
        PYTHONDONTWRITEBYTECODE: "1",
        MPLBACKEND: "Agg",
      },
      // A little over the command's own limit, so `timeout` fires first.
      timeoutMs: SANDBOX_LIMITS.commandMs + 5_000,
    });
    const [stdout, stderr] = await Promise.all([
      result.stdout(),
      result.stderr(),
    ]);
    return {
      stdout: capOutput(stdout),
      stderr: capOutput(stderr),
      exitCode: result.exitCode,
      ms: Date.now() - started,
    };
  } catch (error) {
    const ms = Date.now() - started;
    const timedOut = ms >= SANDBOX_LIMITS.commandMs;
    console.error("[loupe] sandbox command failed", error);
    return {
      stdout: "",
      stderr: timedOut
        ? `Timed out after ${SANDBOX_LIMITS.commandMs / 1000} s.`
        : "The Sandbox could not run the command.",
      exitCode: timedOut ? 124 : 1,
      ms,
    };
  }
}

/** The last line of stdout as JSON: how every Toolkit command answers. */
function lastJson(stdout: string): unknown {
  const lines = stdout.trim().split("\n");
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index].trim();
    if (!line.startsWith("{")) continue;
    try {
      return JSON.parse(line);
    } catch {
      // Not the JSON line.
    }
  }
  return null;
}

// What a run leaves behind ------------------------------------------------------------------

export type Layer = { name: string; bytes: Buffer };

export type RunOutput = CommandResult & {
  measurements: RawMeasurement[];
  layers: Layer[];
  /** Measurements the code wrote that were refused, with why. */
  rejected: string[];
};

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/**
 * Reads what a run wrote into its out directory: Measurements (parsed and
 * checked one by one, because the code may be the Examiner's) and the
 * Evidence layers they name (PNG only, size-capped).
 */
const LAYER_NAME = /^[A-Za-z0-9][\w-]{0,58}\.png$/;

async function collect(
  sandbox: Sandbox,
  outDir: string,
  source: "measurements.json" | "reports.jsonl",
): Promise<Pick<RunOutput, "measurements" | "layers" | "rejected">> {
  const raw = await sandbox.readFileToBuffer({ path: `${outDir}/${source}` });
  if (!raw) return { measurements: [], layers: [], rejected: [] };
  let items: unknown[] = [];
  const text = raw.toString("utf8");
  try {
    if (source === "measurements.json") {
      const parsed = JSON.parse(text) as { measurements?: unknown };
      items = Array.isArray(parsed.measurements) ? parsed.measurements : [];
    } else {
      items = text
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
    }
  } catch {
    return {
      measurements: [],
      layers: [],
      rejected: [`${source} is not valid JSON.`],
    };
  }
  const measurements: RawMeasurement[] = [];
  const rejected: string[] = [];
  for (const item of items.slice(0, SANDBOX_LIMITS.measurementsPerRun * 2)) {
    const parsed = rawMeasurementSchema.safeParse(item);
    if (parsed.success) {
      if (measurements.length < SANDBOX_LIMITS.measurementsPerRun)
        measurements.push(parsed.data);
    } else if (rejected.length < 5) {
      const issue = parsed.error.issues[0];
      rejected.push(
        `${issue?.path.join(".") || "measurement"}: ${issue?.message}`,
      );
    }
  }
  if (items.length > SANDBOX_LIMITS.measurementsPerRun)
    rejected.push(
      `Only the first ${SANDBOX_LIMITS.measurementsPerRun} Measurements of a run are kept.`,
    );
  const names = [
    ...new Set(
      measurements.flatMap((item) => (item.layer ? [item.layer] : [])),
    ),
  ]
    .filter((name) => {
      // A name that would not make a servable asset key is dropped here, not
      // thrown on later, so the run keeps its Measurements.
      if (LAYER_NAME.test(name)) return true;
      if (rejected.length < 6)
        rejected.push(
          "A layer's file name must be letters, digits, _ or - and end in .png (64 characters at most); that layer was dropped.",
        );
      return false;
    })
    .slice(0, SANDBOX_LIMITS.layersPerRun);
  const layers: Layer[] = [];
  await Promise.all(
    names.map(async (name) => {
      const bytes = await sandbox
        .readFileToBuffer({ path: `${outDir}/${name}` })
        .catch(() => null);
      if (
        bytes &&
        bytes.length <= SANDBOX_LIMITS.layerBytes &&
        bytes.subarray(0, 4).equals(PNG_MAGIC)
      )
        layers.push({ name, bytes });
    }),
  );
  const kept = new Set(layers.map((layer) => layer.name));
  return {
    // A Measurement whose layer could not be taken keeps its number.
    measurements: measurements.map((item) =>
      item.layer && !kept.has(item.layer)
        ? { ...item, layer: undefined }
        : item,
    ),
    layers,
    rejected,
  };
}

async function over(examinationId: string) {
  try {
    const status = await examinationStatus(examinationId);
    return status === null || isOver(status);
  } catch {
    return false;
  }
}

// The Toolkit's commands -----------------------------------------------------------------

const preparedSchema = z.object({
  format: z.enum(["pdf", "image"]),
  pages: z
    .array(
      z.object({
        page: z.number().int().min(1),
        width: z.number().int().min(1).max(10_000),
        height: z.number().int().min(1).max(10_000),
      }),
    )
    .min(1)
    .max(LIMITS.maxPages),
  kindGuess: z.enum(DOCUMENT_KINDS).catch("other"),
});

export type Prepared = {
  format: DocumentFormat;
  kindGuess: DocumentKind;
  pages: { page: number; width: number; height: number; bytes: Buffer }[];
};

/**
 * Opens the Sandbox with the Document in it and renders its pages. Throws
 * `SandboxUnavailable`, or an Error whose message is safe to show (the
 * Toolkit's own refusal: too many pages, an encrypted PDF, not a document).
 */
export async function prepareDocument(
  examinationId: string,
  document: () => Promise<DocumentFile>,
): Promise<Prepared> {
  const sandbox = await open(examinationId, document);
  const name =
    (
      await sandbox.readFileToBuffer({ path: `${WORK}/doc/name.txt` })
    )?.toString("utf8") ?? "input.bin";
  const result = await run(
    sandbox,
    "prepare",
    [
      "python3",
      "-m",
      "loupe",
      "prepare",
      "--doc",
      `${WORK}/doc/${inputName(name)}`,
      "--work",
      WORK,
    ],
    `${WORK}/out`,
  );
  if (result.exitCode !== 0) {
    const reason = result.stderr.trim().split("\n").pop()?.slice(0, 200);
    throw new Error(
      reason
        ? `The Document could not be opened: ${reason}`
        : "The Document could not be opened.",
    );
  }
  const parsed = preparedSchema.safeParse(lastJson(result.stdout));
  if (!parsed.success)
    throw new Error("The Document could not be opened: no pages came back.");
  const pages = await Promise.all(
    parsed.data.pages.map(async (page) => {
      const bytes = await sandbox.readFileToBuffer({
        path: `${WORK}/pages/p${page.page}.jpg`,
      });
      if (!bytes) throw new Error(`Page ${page.page} could not be rendered.`);
      return { ...page, bytes };
    }),
  );
  return {
    format: parsed.data.format,
    kindGuess: parsed.data.kindGuess,
    pages,
  };
}

const boxArg = (box: Box) => box.map((n) => n.toFixed(5)).join(",");

/** The Python a Toolkit command stands for, as shown on the Trail and re-runnable in `run_code`. */
export function checkCode(check: CheckId, page?: number, box?: Box | null) {
  const args = [
    ...(page ? [`page=${page}`] : []),
    ...(box ? [`box=(${box.map((n) => n.toFixed(4)).join(", ")})`] : []),
  ].join(", ");
  return `import loupe\nfor m in loupe.checks.${check}(${args}):\n    loupe.report(**m)`;
}

export const SWEEP_CODE =
  "python3 -m loupe sweep  # every Check that fits the Document";

type Seed = () => Promise<DocumentFile>;

function refused(stderr: string): RunOutput {
  return {
    stdout: "",
    stderr,
    exitCode: 1,
    ms: 0,
    measurements: [],
    layers: [],
    rejected: [],
  };
}

async function runAndCollect(
  examinationId: string,
  document: Seed,
  callId: string,
  command: (outDir: string) => string[],
  source: "measurements.json" | "reports.jsonl",
  before?: (sandbox: Sandbox, outDir: string) => Promise<void>,
  /** A client's Check on a finished Examination: a fresh Sandbox from the Document, removed after. */
  afterEnd = false,
): Promise<RunOutput> {
  if (!afterEnd && (await over(examinationId)))
    return refused("The Examination is over; nothing was run.");
  let sandbox: Sandbox;
  try {
    sandbox = await open(examinationId, document);
  } catch (error) {
    const text = message(error);
    return refused(
      error instanceof SandboxUnavailable || DOCUMENT_ERROR.test(text)
        ? text
        : "Sandbox unavailable: it could not be started.",
    );
  }
  const id = safeId(callId);
  const outDir = `${WORK}/out/${id}`;
  try {
    await sandbox.runCommand("mkdir", ["-p", outDir]);
    if (before) await before(sandbox, outDir);
    const result = await run(sandbox, id, command(outDir), outDir);
    const collected = await collect(sandbox, outDir, source).catch(() => ({
      measurements: [],
      layers: [],
      rejected: ["What the run wrote could not be read back."],
    }));
    return { ...result, ...collected };
  } catch (error) {
    console.error("[loupe] sandbox run failed", error);
    return refused("The Sandbox could not run the command.");
  } finally {
    // Stopped while it ran: the stop's own dispose may have come first.
    if (await over(examinationId)) await disposeSandbox(examinationId);
  }
}

/** The Sweep: every Check that fits the Document, no model. */
export function runSweep(input: {
  examinationId: string;
  document: Seed;
  kind: DocumentKind;
}) {
  return runAndCollect(
    input.examinationId,
    input.document,
    "sweep",
    (outDir) => [
      "python3",
      "-m",
      "loupe",
      "sweep",
      "--work",
      WORK,
      "--kind",
      input.kind,
      "--out",
      outDir,
    ],
    "measurements.json",
  );
}

/** One named Check, on a page or a region. */
export function runCheck(input: {
  examinationId: string;
  document: Seed;
  callId: string;
  check: CheckId;
  kind: DocumentKind;
  page?: number;
  box?: Box | null;
  afterEnd?: boolean;
}) {
  return runAndCollect(
    input.examinationId,
    input.document,
    input.callId,
    (outDir) => [
      "python3",
      "-m",
      "loupe",
      "check",
      input.check,
      "--work",
      WORK,
      "--out",
      outDir,
      "--kind",
      input.kind,
      ...(input.page ? ["--page", String(input.page)] : []),
      ...(input.box ? ["--box", boxArg(input.box)] : []),
    ],
    "measurements.json",
    undefined,
    input.afterEnd,
  );
}

/** Python the Examiner wrote. What it reports with `loupe.report` comes back as Measurements. */
export function runCode(input: {
  examinationId: string;
  document: Seed;
  callId: string;
  code: string;
}) {
  const file = `${WORK}/code/${safeId(input.callId)}.py`;
  return runAndCollect(
    input.examinationId,
    input.document,
    input.callId,
    () => ["python3", file],
    "reports.jsonl",
    async (sandbox) => {
      await sandbox.writeFiles([{ path: file, content: input.code }]);
    },
  );
}

/** A page, or a region of it zoomed in, as a JPEG for the Examiner to look at. */
export async function cropPage(input: {
  examinationId: string;
  document: Seed;
  callId: string;
  page: number;
  box: Box | null;
}): Promise<Buffer | null> {
  if (await over(input.examinationId)) return null;
  let sandbox: Sandbox;
  try {
    sandbox = await open(input.examinationId, input.document);
  } catch {
    return null;
  }
  const out = `${WORK}/out/${safeId(input.callId)}.jpg`;
  const result = await run(
    sandbox,
    `${safeId(input.callId)}-crop`,
    [
      "python3",
      "-m",
      "loupe",
      "crop",
      "--work",
      WORK,
      "--page",
      String(input.page),
      ...(input.box ? ["--box", boxArg(input.box)] : []),
      "--out",
      out,
    ],
    `${WORK}/out`,
  );
  if (result.exitCode !== 0) return null;
  const bytes = await sandbox.readFileToBuffer({ path: out }).catch(() => null);
  return bytes && bytes.length <= 3_000_000 ? bytes : null;
}
