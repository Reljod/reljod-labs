import { NotFoundError } from "@/platform/errors";
import { findPack, storagePath } from "../../packs";
import type { PackStore } from "../ports";

/** How long a page image's signed URL works; the redirect is cached for less. */
export const PAGE_IMAGE_SECONDS = 900;

/** The preset packs' page images: shared seed files, the same for every Owner. */
export interface PacksService {
  /** A short-lived signed URL for one page of a preset pack; 404 for anything else. */
  pageImage(packSlug: string, file: string): Promise<string>;
}

export function createPacksService(ports: { packs: PackStore }): PacksService {
  return {
    async pageImage(packSlug, file) {
      const pack = findPack(packSlug);
      const isPage = pack?.documents.some((document) =>
        document.pages.includes(file),
      );
      // Only a listed page: a file name never reaches a Storage path unchecked.
      if (!pack || !isPage) throw new NotFoundError();
      return ports.packs.signedUrl(
        storagePath(pack.slug, file),
        PAGE_IMAGE_SECONDS,
      );
    },
  };
}
