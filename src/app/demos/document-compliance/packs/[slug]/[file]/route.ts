import { accessOrDenied } from "@/features/access/server/gate";
import { findPack, storagePath } from "@/features/document-compliance/packs";
import { signedUrl } from "@/features/document-compliance/server/supabase";

/** Redirects to a short-lived signed URL for one preset page image. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; file: string }> },
) {
  const access = await accessOrDenied();
  if (access instanceof Response) return access;
  const { slug, file } = await params;
  const pack = findPack(slug);
  const isPage = pack?.documents.some((document) =>
    document.pages.includes(file),
  );
  if (!pack || !isPage) return new Response("Not found", { status: 404 });

  return new Response(null, {
    status: 302,
    headers: {
      location: await signedUrl(storagePath(slug, file), 900),
      "cache-control": "private, max-age=600",
    },
  });
}
