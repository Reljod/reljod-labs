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
  });

  it("refuses a visitor's server actions, streams and API calls", () => {
    for (const [path, method] of [
      ["/demos/casework", "POST"],
      ["/api/casework/chat", "POST"],
      ["/api/casework/runs/1/events", "GET"],
      ["/demos/document-compliance/runs/1/events", "GET"],
      ["/demos/document-compliance/packs/clean/id.jpg", "GET"],
      ["/ask/abc/builds", "POST"],
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

  it("does not mistake a look-alike path for the door", () => {
    expect(visit("/accessories", null).kind).toBe("redirect");
  });
});

describe("checksItsOwnBearer", () => {
  it("is only the MCP route", () => {
    expect(checksItsOwnBearer("/api/casework/mcp")).toBe(true);
    expect(checksItsOwnBearer("/api/casework/mcp/sse")).toBe(true);
    expect(checksItsOwnBearer("/api/casework/mcp-evil")).toBe(false);
    expect(checksItsOwnBearer("/api/casework/chat")).toBe(false);
  });
});
