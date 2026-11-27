import { expect, test } from "@playwright/test";

/*
 * The Guest access MCP server's OAuth front door, as an MCP client finds it:
 * the 401 that names its resource metadata, the metadata that names its own
 * issuer, dynamic registration, and the consent page sending a non-Host to
 * the Host sign-in. No model call and no database write: no Host signs in.
 */

test("an MCP client finds Guest access's own OAuth server and registers", async ({
  request,
  baseURL,
}) => {
  const challenge = await request.post("/api/access/mcp", {
    headers: { accept: "application/json, text/event-stream" },
    data: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
  });
  expect(challenge.status()).toBe(401);
  expect(challenge.headers()["www-authenticate"]).toContain(
    "/.well-known/oauth-protected-resource/api/access/mcp",
  );

  const resource = await request.get(
    "/.well-known/oauth-protected-resource/api/access/mcp",
  );
  expect(await resource.json()).toMatchObject({
    resource: `${baseURL}/api/access/mcp`,
    authorization_servers: [`${baseURL}/api/access`],
  });

  const server = await request.get(
    "/.well-known/oauth-authorization-server/api/access",
  );
  expect(await server.json()).toMatchObject({
    issuer: `${baseURL}/api/access`,
    authorization_endpoint: `${baseURL}/access/mcp/authorize`,
    code_challenge_methods_supported: ["S256"],
  });

  const registered = await request.post("/api/access/oauth/register", {
    data: {
      redirect_uris: ["http://127.0.0.1:33418/callback"],
      client_name: "e2e client",
    },
  });
  expect(registered.status()).toBe(201);
  expect((await registered.json()).client_id).toMatch(/^gac_/);
});

test("the consent page sends a visitor to the Host sign-in, and back after", async ({
  page,
}) => {
  await page.goto("/access/mcp/authorize?client_id=gac_x&state=s");
  await expect(page).toHaveURL(
    /\/access\/sign-in\?next=%2Faccess%2Fmcp%2Fauthorize%3Fclient_id%3Dgac_x%26state%3Ds$/,
  );
});
