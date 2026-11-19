// Intervals for the held-out accuracy report: Wilson score intervals for
// rates, a stratified bootstrap for balanced accuracy. Reference values are
// worked out by hand (Wilson) or follow from the definition (bootstrap).

import { describe, expect, it } from 'vitest';
import { bootstrapBalanced, wilson } from './stats';

describe('the Wilson score interval (95%)', () => {
  it('matches the textbook values', () => {
    // 8/10: centre (8 + 1.92) / 13.84 = 0.7169, half-width 1.96·sqrt(1.6 + 0.9604)/13.84 = 0.2265.
    const i = wilson(8, 10);
    expect(i.lo).toBeCloseTo(0.4902, 3);
    expect(i.hi).toBeCloseTo(0.9433, 3);
    // 0/20: lower bound 0, upper 3.8416 / 23.8416.
    expect(wilson(0, 20).lo).toBe(0);
    expect(wilson(0, 20).hi).toBeCloseTo(0.1611, 3);
    expect(wilson(20, 20).hi).toBeCloseTo(1, 9);
  });

  it('is empty-safe', () => {
    expect(wilson(0, 0)).toEqual({ lo: 0, hi: 0 });
  });
});

describe('the stratified bootstrap of balanced accuracy', () => {
  it('collapses to the point value when every class is all right or all wrong', () => {
    // True all right, False all wrong: every resample gives (1 + 0) / 2.
    const hits = { True: [true, true, true], False: [false, false] };
    expect(bootstrapBalanced(hits, { iterations: 500, seed: 1 })).toEqual({ lo: 0.5, hi: 0.5 });
  });

  it('brackets the point value, is reproducible by seed, and widens with fewer claims', () => {
    const many = { True: Array.from({ length: 60 }, (_, i) => i % 2 === 0), False: Array.from({ length: 60 }, (_, i) => i % 4 !== 0) };
    const few = { True: many.True.slice(0, 12), False: many.False.slice(0, 12) };
    const a = bootstrapBalanced(many, { iterations: 2000, seed: 7 });
    expect(a).toEqual(bootstrapBalanced(many, { iterations: 2000, seed: 7 }));
    // Point value (0.5 + 0.75) / 2 = 0.625.
    expect(a.lo).toBeLessThan(0.625);
    expect(a.hi).toBeGreaterThan(0.625);
    const b = bootstrapBalanced(few, { iterations: 2000, seed: 7 });
    expect(b.hi - b.lo).toBeGreaterThan(a.hi - a.lo);
  });
});
