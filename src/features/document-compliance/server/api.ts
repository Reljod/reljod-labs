import "server-only";
import {
  sameOrigin,
  withOwner,
  withServices,
  withVisitor,
} from "@/platform/http/middleware";
import { api, derive } from "@/platform/http/pipeline";
import { actorOf } from "./audit";
import { documentCompliance } from "./container";

/**
 * Document compliance's base route stack: same-origin writes, the Access gate
 * and the Owner every row is scoped to, the visitor hash the Pre-screen caps
 * count against, the `caller` the services take (Owner, the person the Audit
 * trail names, visitor), and the services. Each route adds its own body,
 * query or path layer.
 */
export const documentComplianceApi = api("document-compliance")
  .use(sameOrigin())
  .use(withOwner())
  .use(withVisitor())
  .use(
    derive(({ access, owner, visitor }) => ({
      caller: { owner, actor: actorOf(access), visitor },
    })),
  )
  .use(withServices(documentCompliance));
