import { CASE_SAMPLES } from "./cases";
import { KNOWLEDGE_SAMPLES } from "./knowledge";
import type { SampleFile } from "./types";

export type { SampleFile } from "./types";

export const SAMPLES: SampleFile[] = [...CASE_SAMPLES, ...KNOWLEDGE_SAMPLES];

export function sampleById(id: string) {
  return SAMPLES.find((sample) => sample.id === id);
}
