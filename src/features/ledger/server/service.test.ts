import { describe, expect, it, vi } from "vitest";
import { InvalidError, NotFoundError } from "@/platform/errors";
import type { BuildEvent } from "../domain/build-events";
import type { RawBuildPlan } from "../domain/build-plan";
import { limitMessage } from "../domain/limits";
import type { Caller, LedgerPorts } from "./ports";
import { createLedgerService } from "./service";

vi.mock("server-only", () => ({}));

const SESSION = "0b7f4a2e-3c1d-4e5f-8a9b-0c1d2e3f4a5b";
const caller: Caller = {
  owner: "guest:4f1c2d3e-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
  visitor: { hash: "v1", trusted: false },
};
const stranger = "host:9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b";

const PLAN: RawBuildPlan = {
  verdict: "answer",
  title: "Where Reljod has worked",
  layout: "timeline",
  answer: "Reljod has worked in several places.",
  steps: [
    {
      action: "fetch",
      source: "experience.0",
      excerpt: null,
      join: "Reljod is now",
      pace: "trot",
      line: "Here he is now.",
    },
    {
      action: "fetch",
      source: "experience.99",
      excerpt: null,
      join: "after",
      pace: "trot",
      line: "An invented job.",
    },
  ],
};

function setup() {
  const ports: LedgerPorts = {
    sessions: {
      create: vi.fn(async () => SESSION),
      load: vi.fn(async (id, owner) =>
        id === SESSION && owner === caller.owner ? { id, builds: [] } : null,
      ),
      insertBuild: vi.fn(async (input) => ({
        id: "b1",
        position: 0,
        question: input.question,
        plan: input.plan,
        createdAt: "2026-11-27T10:00:00.000000+00:00",
      })),
      latestAnswered: vi.fn(async () => "older-session"),
    },
    rate: {
      take: vi.fn(async () => null),
      peek: vi.fn(async () => null),
    },
    planner: {
      plan: vi.fn(() => ({
        partials: (async function* () {
          yield { verdict: "answer" as const, title: PLAN.title };
        })(),
        plan: Promise.resolve(PLAN),
        model: "test/model",
      })),
    },
  };
  return { ports, service: createLedgerService(ports) };
}

async function drain(stream: AsyncGenerator<BuildEvent>) {
  const events: BuildEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe("opening an Ask session", () => {
  it("only peeks at the cap, and over it opens nothing but the Owner's own latest answer", async () => {
    const { ports, service } = setup();
    vi.mocked(ports.rate.peek).mockResolvedValue("site");
    expect(await service.start(caller, "Where has he worked?")).toEqual({
      status: "limited",
      sessionId: "older-session",
      message: limitMessage("site"),
    });
    expect(ports.sessions.latestAnswered).toHaveBeenCalledWith(caller.owner);
    expect(ports.sessions.create).not.toHaveBeenCalled();
    expect(ports.rate.take).not.toHaveBeenCalled();
  });

  it("opens the session for the caller's Owner", async () => {
    const { ports, service } = setup();
    expect(await service.start(caller, "Where has he worked?")).toEqual({
      status: "started",
      sessionId: SESSION,
    });
    expect(ports.sessions.create).toHaveBeenCalledWith({
      owner: caller.owner,
      visitorHash: "v1",
    });
  });
});

describe("a Build", () => {
  it("answers another Owner's session as missing, and never plans", async () => {
    const { ports, service } = setup();
    await expect(
      service.build({ ...caller, owner: stranger }, SESSION, "Hi"),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(ports.planner.plan).not.toHaveBeenCalled();
  });

  it("refuses an empty question before the cap", async () => {
    const { ports, service } = setup();
    await expect(service.build(caller, SESSION, "")).rejects.toBeInstanceOf(
      InvalidError,
    );
    expect(ports.rate.take).not.toHaveBeenCalled();
  });

  it("takes the rate hit before the planner, and over the cap never plans", async () => {
    const { ports, service } = setup();
    vi.mocked(ports.rate.take).mockResolvedValue("visitor");
    const events = await drain(await service.build(caller, SESSION, "Hi"));
    expect(events).toEqual([
      {
        type: "limited",
        message: limitMessage("visitor"),
        sessionId: "older-session",
      },
    ]);
    expect(ports.planner.plan).not.toHaveBeenCalled();
    expect(ports.sessions.insertBuild).not.toHaveBeenCalled();
  });

  it("forces the limit for the e2e suite without spending a hit", async () => {
    const { ports, service } = setup();
    const events = await drain(
      await service.build(caller, SESSION, "Hi", { forceLimit: true }),
    );
    expect(events[0]?.type).toBe("limited");
    expect(ports.rate.take).not.toHaveBeenCalled();
    expect(ports.planner.plan).not.toHaveBeenCalled();
  });

  it("turns a failed count into an error line, and never plans", async () => {
    const { ports, service } = setup();
    vi.mocked(ports.rate.take).mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const events = await drain(await service.build(caller, SESSION, "Hi"));
    expect(events.map((event) => event.type)).toEqual(["error"]);
    expect(ports.planner.plan).not.toHaveBeenCalled();
  });

  it("stores only the steps that passed validation", async () => {
    const { ports, service } = setup();
    const events = await drain(await service.build(caller, SESSION, "Hi"));
    const stored = vi.mocked(ports.sessions.insertBuild).mock.calls[0]?.[0];
    expect(stored?.plan.steps.map((step) => step.source)).toEqual([
      "experience.0",
    ]);
    expect(events.at(-1)?.type).toBe("done");
  });
});
