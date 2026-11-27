import { ROUTES } from "../domain/api";

/** A preset page image, served through a short-lived signed redirect. */
export function pageImageUrl(packSlug: string, file: string) {
  return ROUTES.packPage(packSlug, file);
}
