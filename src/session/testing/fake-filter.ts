import type { ClaimFilter } from '../types';

export interface FakeFilter extends ClaimFilter {
  /** Every sentence the filter was asked about, in order. */
  asked: string[];
  /** Makes the next `count` calls fail, as a crashed or missing model would. */
  failNext(count?: number): void;
}

/**
 * A claim filter for session tests. By default it passes a sentence that has a
 * digit in it and drops the rest; pass `decide` to script it.
 */
export function createFakeFilter(decide: (sentence: string) => boolean = (s) => /\d/.test(s)): FakeFilter {
  const asked: string[] = [];
  let failures = 0;
  return {
    asked,
    failNext(count = 1) {
      failures += count;
    },
    async passes(sentence) {
      asked.push(sentence);
      await Promise.resolve();
      if (failures > 0) {
        failures--;
        throw new Error('the on-device model stopped');
      }
      return decide(sentence);
    },
  };
}
