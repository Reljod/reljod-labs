import {
  type ModelsResponse,
  modelsRequestSchema,
} from "@/features/process-transfer/domain/api";
import { handoverApi } from "@/features/process-transfer/server/api";
import { body } from "@/platform/http/middleware";

/** The models the Owner's next Runs call; only a model that takes video may Watch. */
export const PUT = handoverApi.use(body(modelsRequestSchema)).handle(
  async ({ services, owner, body }): Promise<ModelsResponse> => ({
    models: (await services.settings.saveModels(owner, body)).models,
  }),
);
