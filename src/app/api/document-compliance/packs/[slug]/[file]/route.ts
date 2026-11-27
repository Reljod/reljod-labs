import { packPagePathSchema } from "@/features/document-compliance/domain/api";
import { documentComplianceApi } from "@/features/document-compliance/server/api";
import { params } from "@/platform/http/middleware";

/** Redirects to a short-lived signed URL for one preset page image. */
export const GET = documentComplianceApi.use(params(packPagePathSchema)).handle(
  async ({ services, path }) =>
    new Response(null, {
      status: 302,
      headers: {
        location: await services.packs.pageImage(path.slug, path.file),
        "cache-control": "private, max-age=600",
      },
    }),
);
