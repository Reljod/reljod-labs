import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ForbiddenError, InvalidError, NotFoundError } from "@/platform/errors";
import { LIMITS } from "../../domain/limits";
import type { SessionSummary } from "../../domain/session";
import type { Staff } from "../../domain/staff";
import type { SessionRepository } from "../ports";
import { createSessionService } from "./sessions";

const owner = "host:1" as const;
const visitor = { hash: "v", trusted: false };
const staff = (id: string, role: Staff["role"]): Staff => ({
  id,
  key: id,
  name: id,
  title: "",
  role,
  initials: "",
});
const keisha = staff("11111111-1111-4111-8111-111111111111", "user");
const dwayne = staff("22222222-2222-4222-8222-222222222222", "user");
const marva = staff("33333333-3333-4333-8333-333333333333", "admin");

const keishas: SessionSummary = {
  id: "44444444-4444-4444-8444-444444444444",
  title: "New session",
  status: "open",
  staff: { id: keisha.id, name: keisha.name, initials: "" },
  preview: "",
  createdAt: "",
  updatedAt: "",
};

function setup() {
  const calls: string[] = [];
  const sessions: SessionRepository = {
    list: async () => [],
    // Every Session is Keisha's, in the Owner's Workspace only.
    owned: async (asked, id) =>
      asked === owner && id === keishas.id ? keishas : null,
    create: async () => null,
    rename: async () => {},
    messages: async () => [],
    append: async () => {
      calls.push("append");
      return { id: "m", createdAt: "" };
    },
    attachments: async () => [],
  };
  const service = createSessionService({
    sessions,
    rate: {
      take: async (kind) => {
        calls.push(`take:${kind}`);
      },
      used: async () => ({}) as never,
    },
  });
  return { service, calls };
}

describe("a Session is its Staff member's own", () => {
  it("lets nobody else write in it, before a message is counted or saved", async () => {
    const { service, calls } = setup();
    await expect(
      service.writable({ owner, staff: dwayne }, keishas.id),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      service.sendStaff({ owner, staff: dwayne, visitor }, keishas, "Hi", []),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(calls).toEqual([]);
  });

  it("is readable by an admin, not by another user", async () => {
    const { service } = setup();
    expect(await service.readable({ owner, staff: marva }, keishas.id)).toBe(
      keishas,
    );
    expect(
      await service.readable({ owner, staff: dwayne }, keishas.id),
    ).toBeNull();
  });

  it("is not found from another Workspace", async () => {
    const { service } = setup();
    await expect(
      service.messages({ owner: "host:2", staff: marva }, keishas.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses a message over the cap before it takes the visitor's hourly allowance", async () => {
    const { service, calls } = setup();
    await expect(
      service.sendStaff(
        { owner, staff: keisha, visitor },
        keishas,
        "x".repeat(LIMITS.messageChars + 1),
        [],
      ),
    ).rejects.toBeInstanceOf(InvalidError);
    expect(calls).toEqual([]);
  });

  it("counts a message against the visitor before saving it", async () => {
    const { service, calls } = setup();
    const { session } = await service.sendStaff(
      { owner, staff: keisha, visitor },
      keishas,
      "Please handle this member request",
      [],
    );
    expect(calls).toEqual(["take:message", "append"]);
    expect(session.title).not.toBe("New session");
  });
});
