import { onGithubEvent, validSignature } from "@/features/bank/server/growth";

/**
 * GitHub's webhook for the Growth loop: an issue or pull request changed, so
 * the requests it concerns are re-read at once instead of at the next look.
 * It checks GitHub's signature itself (BANK_GITHUB_WEBHOOK_SECRET); without
 * the secret, or with a bad signature, it answers 404 and does nothing.
 * Optional: the Growth Workflow and the Growth tab poll without it.
 */
export async function POST(request: Request) {
  const body = await request.text();
  if (body.length > 1_000_000 || !validSignature(body, request.headers.get("x-hub-signature-256"))) {
    return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  try {
    const touched = await onGithubEvent(payload);
    return Response.json({ ok: true, touched }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("[bank] github webhook", error);
    return Response.json({ ok: false }, { status: 500 });
  }
}
