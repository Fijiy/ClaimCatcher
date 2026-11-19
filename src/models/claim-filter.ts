// The session's claim filter (`ClaimFilter`), run in the model worker. A
// sentence passes when the classifier rates it check-worthy at PASS_THRESHOLD
// or above.
//
// The threshold leans toward letting borderline sentences through. Its bar,
// checked by the quality gate (`pnpm eval:on-device`, docs/quality-gate.md):
// at least 90% of rated claims while passing at most 40% of sentences. The
// prototype picked 0.5 on the full-precision model; the bundled 8-bit model
// (per channel) in the extension's WASM runtime meets the bar from 0.40 to
// 0.49 (2026-10-26: 27 of 29 rated claims, 38.8% of sentences passed at
// 0.45). 0.45 is the middle of that range, so neither half of the bar hangs
// on one score.

import type { ClaimFilter } from '../session/types';
import type { ModelClient } from './client';

export const PASS_THRESHOLD = 0.45;

export interface WorkerClaimFilter extends ClaimFilter {
  /** Loads the model now, so the first sentence doesn't wait for it. */
  warm(): Promise<void>;
}

export function createClaimFilter(models: Pick<ModelClient, 'run'>): WorkerClaimFilter {
  return {
    async passes(sentence) {
      const { scores } = await models.run('claim-filter', { sentences: [sentence] });
      const score = scores[0];
      if (score === undefined) throw new Error('the claim filter gave no score');
      return score >= PASS_THRESHOLD;
    },
    async warm() {
      await models.run('claim-filter', { sentences: [] });
    },
  };
}
