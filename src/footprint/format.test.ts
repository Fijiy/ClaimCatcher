// How the footer writes the estimator's ranges.

import { describe, expect, it } from 'vitest';
import { formatCost, formatRange } from './format';

describe('formatRange', () => {
  it('writes two significant figures below 10 and whole numbers above, joined by an en dash', () => {
    expect(formatRange({ low: 1.62, high: 13.94 })).toBe('1.6–14');
    expect(formatRange({ low: 0.4, high: 6.31 })).toBe('0.4–6.3');
    expect(formatRange({ low: 0.0123, high: 0.456 })).toBe('0.012–0.46');
    expect(formatRange({ low: 115.4, high: 1240.6 })).toBe('115–1241');
  });

  it('writes one figure when both ends round the same', () => {
    expect(formatRange({ low: 0, high: 0 })).toBe('0');
    expect(formatRange({ low: 10.2, high: 10.4 })).toBe('10');
  });
});

describe('formatCost', () => {
  it('writes cents up to a dollar, dollars above', () => {
    expect(formatCost({ low: 12.2, high: 25.4 })).toBe('12–25¢');
    expect(formatCost({ low: 0.31, high: 0.31 })).toBe('0.31¢');
    expect(formatCost({ low: 0, high: 0 })).toBe('0¢');
    expect(formatCost({ low: 120, high: 251 })).toBe('$1.20–2.51');
  });
});
