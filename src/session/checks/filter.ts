// Step 0, the claim filter: the bundled on-device classifier drops sentences
// with no checkable claim before any LLM sees them. Only sentences it passes
// go on to claim breakdown; the rest become skipped lines with one generic
// reason. Breakdown's own reasons cover what it skips later.
//
// It leans toward letting sentences through: the model's threshold is set low
// (src/models/claim-filter.ts), and when the model can't run at all, every
// sentence passes rather than being silently dropped.

import type { ClaimFilter, SkippedPart } from '../types';

/** The reason shown on a line the filter dropped ("Skipped: not flagged as a claim"). */
export const FILTERED: SkippedPart['reason'] = 'not flagged as a claim';

export async function passesFilter(filter: ClaimFilter | undefined, sentence: string): Promise<boolean> {
  if (!filter) return true;
  try {
    return await filter.passes(sentence);
  } catch (error) {
    console.warn('[ClaimCatcher] the claim filter failed; checking the sentence anyway', error);
    return true;
  }
}
