import {
  API_ROOT,
  type CascadeStreamEvent,
  type RefractResponse,
  type TribunalStreamEvent,
} from "../domain/api";
import type { DecisionModelId } from "../domain/models";
import type { PrismQuestionMap } from "../domain/questions";

async function readError(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  if (text) {
    try {
      const parsed = JSON.parse(text) as { error?: string };
      if (typeof parsed.error === "string" && parsed.error.trim()) {
        return parsed.error;
      }
    } catch {
      return text.trim();
    }
  }
  return `Request failed (${response.status})`;
}

async function consumeNdjson<T>(
  response: Response,
  onEvent: (event: T) => void,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl = buffer.indexOf("\n");
    while (nl >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) {
        try {
          onEvent(JSON.parse(line) as T);
        } catch {
          // Ignore partial or malformed lines.
        }
      }
      nl = buffer.indexOf("\n");
    }
  }
  const tail = buffer.trim();
  if (tail) {
    try {
      onEvent(JSON.parse(tail) as T);
    } catch {
      // Ignore trailing fragment.
    }
  }
}

export async function refractSlip(params: {
  modelId: DecisionModelId;
  state: string;
  questions?: PrismQuestionMap;
  signal?: AbortSignal;
}): Promise<RefractResponse> {
  const response = await fetch(`${API_ROOT}/refract`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      modelId: params.modelId,
      state: params.state,
      ...(params.questions ? { questions: params.questions } : {}),
    }),
    signal: params.signal,
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as RefractResponse;
}

export async function streamTribunal(params: {
  state: string;
  modelIds: readonly DecisionModelId[];
  onEvent: (event: TribunalStreamEvent) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const response = await fetch(`${API_ROOT}/tribunal`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      state: params.state,
      modelIds: params.modelIds,
    }),
    signal: params.signal,
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  await consumeNdjson(response, params.onEvent);
}

export async function streamCascade(params: {
  modelId: DecisionModelId;
  items: readonly { id: string; text: string }[];
  onEvent: (event: CascadeStreamEvent) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const response = await fetch(`${API_ROOT}/cascade`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      modelId: params.modelId,
      items: params.items,
    }),
    signal: params.signal,
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  await consumeNdjson(response, params.onEvent);
}
