import { describe, expect, it } from "vitest";
import { checksItsOwnBearer, decide } from "./routing";

const visit = (path: string, access: Parameters<typeof decide>[0]["access"]) =>
  decide({ path, search: "", method: "GET", access });

describe("decide", () => {
  it("lets Hosts, Guests and the e2e suite into the demos", () => {
    for (const access of ["host", "guest", "e2e"] as const) {
      expect(visit("/demos/casework", access)).toEqual({ kind: "pass" });
      expect(
        decide({
          path: "/api/casework/chat",
          search: "",
          method: "POST",
          access,
        }),
      ).toEqual({ kind: "pass" });
    }
  });

  it("sends a visitor's page visit to the door, remembering where they were going", () => {
    expect(
      decide({
        path: "/ask/abc",
        search: "?ask=hi",
        method: "GET",
        access: null,
      }),
    ).toEqual({ kind: "redirect", to: "/access?next=%2Fask%2Fabc%3Fask%3Dhi" });
    expect(visit("/demos/document-compliance/runs/1", null).kind).toBe(
      "redirect",
    );
    expect(visit("/demos/harness", null)).toEqual({
      kind: "redirect",
      to: "/access?next=%2Fdemos%2Fharness",
    });
  });

  it("refuses a visitor's server actions, streams and API calls", () => {
    for (const [path, method] of [
      ["/demos/casework", "POST"],
      ["/api/casework/chat", "POST"],
      ["/api/casework/runs/1/events", "GET"],
      ["/demos/document-compliance/runs/1/events", "GET"],
      ["/demos/document-compliance/packs/clean/id.jpg", "GET"],
      ["/ask/abc/builds", "POST"],
      ["/api/client-manager/clients", "GET"],
      ["/api/client-manager/clients/1/chat", "POST"],
      ["/api/client-manager/builds/1/events", "GET"],
      ["/api/process-transfer/runs/1/events", "GET"],
      ["/demos/process-transfer", "POST"],
      ["/api/harness/sessions", "GET"],
      ["/api/harness/sessions/1/chat", "POST"],
      ["/api/harness/runs/1/events", "GET"],
      ["/api/harness/mcp-token", "POST"],
      ["/demos/harness", "POST"],
      ["/ask/abc/builds", "GET"],
      ["/demos/casework", "DELETE"],
    ]) {
      expect(decide({ path, search: "", method, access: null })).toEqual({
        kind: "refuse",
      });
    }
  });

  it("keeps the door open to everyone", () => {
    for (const access of [null, "guest", "host"] as const) {
      expect(visit("/access", access)).toEqual({ kind: "pass" });
      expect(visit("/access/sign-in", access)).toEqual({ kind: "pass" });
    }
  });

  it("keeps a Host's pages to a Host", () => {
    for (const path of ["/access/guests", "/access/profile"]) {
      expect(visit(path, "host")).toEqual({ kind: "pass" });
      for (const access of [null, "guest", "e2e"] as const) {
        expect(visit(path, access)).toEqual({
          kind: "redirect",
          to: "/access/sign-in",
        });
      }
    }
  });

  it("opens the door's routes to everyone and the rest of Access's routes only to a Host", () => {
    for (const access of [null, "guest", "host", "e2e"] as const) {
      for (const method of ["GET", "POST", "DELETE"]) {
        expect(
          decide({ path: "/api/access/session", search: "", method, access }),
        ).toEqual({ kind: "pass" });
      }
      expect(
        decide({
          path: "/api/access/guest-session",
          search: "",
          method: "POST",
          access,
        }),
      ).toEqual({ kind: "pass" });
    }
    for (const path of [
      "/api/access/guest-passes",
      "/api/access/guest-passes/1/code",
      "/api/access/profile",
      "/api/access/password",
      "/api/access/mcp-clients",
      "/api/access/session/extra",
      "/api/access/something-new",
    ]) {
      expect(
        decide({ path, search: "", method: "POST", access: "host" }),
      ).toEqual({ kind: "pass" });
      for (const access of [null, "guest", "e2e"] as const) {
        expect(decide({ path, search: "", method: "POST", access })).toEqual({
          kind: "refuse",
        });
      }
    }
  });

  it("does not mistake a look-alike path for the door", () => {
    expect(visit("/accessories", null).kind).toBe("redirect");
  });
});

describe("checksItsOwnBearer", () => {
  it("is only the MCP and OAuth routes", () => {
    expect(checksItsOwnBearer("/api/client-manager/oauth/token")).toBe(true);
    expect(checksItsOwnBearer("/api/client-manager/oauth/register")).toBe(true);
    expect(checksItsOwnBearer("/api/client-manager/oauthx")).toBe(false);
    expect(checksItsOwnBearer("/api/client-manager/mcp")).toBe(true);
    expect(checksItsOwnBearer("/api/client-manager/mcp-token")).toBe(false);
    expect(checksItsOwnBearer("/api/client-manager/clients")).toBe(false);
    expect(checksItsOwnBearer("/api/casework/mcp")).toBe(true);
    expect(checksItsOwnBearer("/api/casework/mcp/sse")).toBe(true);
    expect(checksItsOwnBearer("/api/casework/mcp-evil")).toBe(false);
    expect(checksItsOwnBearer("/api/casework/chat")).toBe(false);
    expect(checksItsOwnBearer("/api/harness/mcp")).toBe(true);
    expect(checksItsOwnBearer("/api/harness/oauth/token")).toBe(true);
    expect(checksItsOwnBearer("/api/harness/mcp-token")).toBe(false);
    expect(checksItsOwnBearer("/api/harness/sessions")).toBe(false);
    expect(checksItsOwnBearer("/api/harness/plugin")).toBe(false);
  });
});
