import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The page's GET routes: the gate first, inputs checked, reads scoped to the
 * Owner, never cached, and failures told without detail.
 */

vi.mock("server-only", () => ({}));

const gate = vi.hoisted(() => {
  class AccessDeniedError extends Error {}
  return {
    AccessDeniedError,
    requireOwner: vi.fn(),
    denied: () => new Response("denied", { status: 401 }),
  };
});
vi.mock("@/features/access/server/gate", () => gate);

const reads = vi.hoisted(() => ({
  readDesk: vi.fn(),
  readRun: vi.fn(),
  readAudit: vi.fn(),
}));
vi.mock("@/features/process-transfer/server/reads", () => reads);

const { GET: getDesk } = await import("./desk/route");
const { GET: getRun } = await import("./runs/[runId]/route");
const { GET: getAudit } = await import("./audit/route");

const OWNER = "host:a";
const ACCESS = { kind: "host" };
const RUN_ID = "6f1d3c2a-5b4e-4f7a-9c8d-1e2f3a4b5c6d";

const runContext = (runId: string) => ({
  params: Promise.resolve({ runId }),
});
const auditRequest = (search = "") =>
  new Request(`http://test/api/process-transfer/audit${search}`);

beforeEach(() => {
  vi.clearAllMocks();
  gate.requireOwner.mockResolvedValue({ access: ACCESS, owner: OWNER });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("without Access", () => {
  beforeEach(() => {
    gate.requireOwner.mockRejectedValue(new gate.AccessDeniedError("no"));
  });

  it("every route answers 401 and reads nothing", async () => {
    const answers = await Promise.all([
      getDesk(),
      getRun(new Request("http://test"), runContext(RUN_ID)),
      getAudit(auditRequest()),
    ]);
    expect(answers.map((answer) => answer.status)).toEqual([401, 401, 401]);
    expect(reads.readDesk).not.toHaveBeenCalled();
    expect(reads.readRun).not.toHaveBeenCalled();
    expect(reads.readAudit).not.toHaveBeenCalled();
  });
});

describe("GET /desk", () => {
  it("reads the Owner's Desk, never cached", async () => {
    reads.readDesk.mockResolvedValue({ runs: [] });
    const answer = await getDesk();
    expect(answer.status).toBe(200);
    expect(answer.headers.get("cache-control")).toBe("private, no-store");
    expect(await answer.json()).toEqual({ desk: { runs: [] } });
    expect(reads.readDesk).toHaveBeenCalledWith(ACCESS, OWNER);
  });

  it("tells a failure without its detail", async () => {
    reads.readDesk.mockRejectedValue(new Error("password=hunter2"));
    const answer = await getDesk();
    expect(answer.status).toBe(500);
    expect(await answer.text()).not.toContain("hunter2");
  });
});

describe("GET /runs/[runId]", () => {
  it("reads the Run scoped to the Owner", async () => {
    reads.readRun.mockResolvedValue({ id: RUN_ID });
    const answer = await getRun(new Request("http://test"), runContext(RUN_ID));
    expect(answer.status).toBe(200);
    expect(answer.headers.get("cache-control")).toBe("private, no-store");
    expect(await answer.json()).toEqual({ run: { id: RUN_ID } });
    expect(reads.readRun).toHaveBeenCalledWith(OWNER, RUN_ID);
  });

  it("answers 404 for another Owner's Run", async () => {
    reads.readRun.mockResolvedValue(null);
    const answer = await getRun(new Request("http://test"), runContext(RUN_ID));
    expect(answer.status).toBe(404);
  });

  it("answers 404 for an id that is not a Run id, without reading", async () => {
    const answer = await getRun(
      new Request("http://test"),
      runContext("../desk"),
    );
    expect(answer.status).toBe(404);
    expect(reads.readRun).not.toHaveBeenCalled();
  });
});

describe("GET /audit", () => {
  it("reads a page scoped to the Owner", async () => {
    reads.readAudit.mockResolvedValue([]);
    const answer = await getAudit(auditRequest(`?before=5&run=${RUN_ID}`));
    expect(answer.status).toBe(200);
    expect(answer.headers.get("cache-control")).toBe("private, no-store");
    expect(await answer.json()).toEqual({ events: [] });
    expect(reads.readAudit).toHaveBeenCalledWith(OWNER, {
      before: 5,
      runId: RUN_ID,
    });
  });

  it("answers 400 for a malformed query, without reading", async () => {
    const answer = await getAudit(auditRequest("?before=abc"));
    expect(answer.status).toBe(400);
    expect(reads.readAudit).not.toHaveBeenCalled();
  });
});
