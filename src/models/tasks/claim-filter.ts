// Worker side of the claim filter: sachaljawad/claimbuster-detector, a
// DistilBERT check-worthiness classifier (MIT; trained on ClaimBuster,
// CC-BY-4.0), exported to ONNX and quantized to 8 bits at build time by
// scripts/models.ts. It scores sentences; the pass/drop threshold is the
// client's (../claim-filter.ts).
//
// It runs on WASM even when WebGPU is there: the 8-bit weights use integer
// ops that WebGPU runs on the CPU anyway, and full-precision weights would
// add 200 MB to the bundle for a model that takes ~10 ms a sentence.

import { pipeline, type TextClassificationPipeline } from '@huggingface/transformers';
import type { TaskInput, TaskOutput } from '../protocol';

/** The model's folder under public/models/. */
export const CLAIM_FILTER_MODEL = 'claimcatcher/claimbuster-detector';
const CHECKWORTHY = 'checkworthy';

export function createClaimFilterTask() {
  let classifier: Promise<TextClassificationPipeline> | undefined;
  const load = () =>
    (classifier ??= pipeline('text-classification', CLAIM_FILTER_MODEL, { device: 'wasm', dtype: 'q8' }).catch((error: unknown) => {
      classifier = undefined; // let a later call try again
      throw error;
    }));

  return async ({ sentences }: TaskInput<'claim-filter'>): Promise<TaskOutput<'claim-filter'>> => {
    const classify = await load();
    const scores: number[] = [];
    for (const sentence of sentences) {
      const labels = await classify(sentence, { top_k: null });
      const list = (Array.isArray(labels) ? labels.flat() : [labels]) as Array<{ label: string; score: number }>;
      scores.push(list.find((l) => l.label === CHECKWORTHY)?.score ?? 0);
    }
    return { scores };
  };
}
