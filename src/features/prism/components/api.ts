"use client";

import { send, streamJson } from "@/platform/client/api";
import {
  API_ROOT,
  type CascadeStreamEvent,
  type RefractResponse,
  type TribunalStreamEvent,
} from "../domain/api";
import type { DecisionModelId } from "../domain/models";
import type { PrismQuestionMap } from "../domain/questions";

/** Typed wrappers over the Prism routes; components never call `fetch` themselves. */

export function refractSlip(params: {
  modelId: DecisionModelId;
  state: string;
  questions?: PrismQuestionMap;
  signal?: AbortSignal;
}): Promise<RefractResponse> {
  return send<RefractResponse>(
    "POST",
    `${API_ROOT}/refract`,
    {
      modelId: params.modelId,
      state: params.state,
      ...(params.questions ? { questions: params.questions } : {}),
    },
    { signal: params.signal },
  );
}

export function streamTribunal(params: {
  state: string;
  modelIds: readonly DecisionModelId[];
  onEvent: (event: TribunalStreamEvent) => void;
  signal?: AbortSignal;
}): Promise<void> {
  return streamJson<TribunalStreamEvent>(
    `${API_ROOT}/tribunal`,
    { state: params.state, modelIds: params.modelIds },
    params.onEvent,
    { signal: params.signal },
  );
}

export function streamCascade(params: {
  modelId: DecisionModelId;
  items: readonly { id: string; text: string }[];
  onEvent: (event: CascadeStreamEvent) => void;
  signal?: AbortSignal;
}): Promise<void> {
  return streamJson<CascadeStreamEvent>(
    `${API_ROOT}/cascade`,
    { modelId: params.modelId, items: params.items },
    params.onEvent,
    { signal: params.signal },
  );
}
