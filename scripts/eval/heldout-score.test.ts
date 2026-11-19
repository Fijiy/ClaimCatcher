// The held-out report's numbers, on hand-made verdicts: every count below is
// worked out from the six cases and two runs.

import { describe, expect, it } from 'vitest';
import type { Label } from '../../src/session/types';
import type { GateCase } from './eval-set';
import { scoreHeldout } from './heldout-score';
import type { Judged } from './score';

const kase = (id: string, truth: Exclude<Label, 'Unverified'>, basis: 'firm' | 'judgment' = 'firm'): GateCase => ({
  id,
  clip: 'heldout',
  date: '2026-01-01',
  truth,
  accept: [truth],
  basis,
  input: { literal: id, implied: '', context: '', title: '', evidence: [], judgedAsOf: '2026-01-01' },
});

const CASES = [kase('t1', 'True'), kase('t2', 'True'), kase('m1', 'Misleading'), kase('m2', 'Misleading', 'judgment'), kase('f1', 'False'), kase('f2', 'False', 'judgment')];
const said = (labels: Label[], ms = 1000): Judged[] => labels.map((label, i) => ({ caseId: CASES[i]!.id, label, ms: ms + i * 1000 }));

describe('the held-out score', () => {
  const run1 = said(['True', 'False', 'Misleading', 'False', 'False', 'Unverified']);
  const run2 = said(['True', 'False', 'Misleading', 'Misleading', 'True', 'Unverified']);
  const s = scoreHeldout(CASES, [run1, run2], { iterations: 200 });

  it('scores each run: exact, balanced, adjacent, Unverified and the True↔False errors, with intervals', () => {
    const r = s.runs[0]!;
    // Exact: t1, m1, f1 → 3/6. Recalls: True 1/2, Misleading 1/2, False 1/2 → balanced 0.5.
    expect(r.exact).toMatchObject({ hits: 3, n: 6 });
    expect(r.exact.ci.lo).toBeLessThan(0.5);
    expect(r.exact.ci.hi).toBeGreaterThan(0.5);
    expect(r.balanced.value).toBeCloseTo(0.5, 9);
    expect(r.recall).toMatchObject({ True: { hits: 1, n: 2 }, Misleading: { hits: 1, n: 2 }, False: { hits: 1, n: 2 } });
    // Adjacent adds m2 (Misleading said False) → 4/6.
    expect(r.adjacent).toMatchObject({ hits: 4, n: 6 });
    expect(r.unverified).toMatchObject({ hits: 1, n: 6 });
    // t2 True said False.
    expect(r.opposite).toEqual({ trueAsFalse: 1, falseAsTrue: 0, total: 1 });
    // Of the 5 that weren't Unverified, 3 exact.
    expect(r.exactWhenLabelled).toMatchObject({ hits: 3, n: 5 });
    expect(r.firm.exact).toMatchObject({ hits: 3, n: 4 });
    expect(r.judgment.exact).toMatchObject({ hits: 0, n: 2 });
    expect(r.judgment.adjacent).toMatchObject({ hits: 1, n: 2 });
    expect(r.confusion.True).toEqual({ True: 1, False: 1 });
    expect(r.confusion.False).toEqual({ False: 1, Unverified: 1 });
  });

  it('counts the second run’s False called True', () => {
    expect(s.runs[1]!.opposite).toEqual({ trueAsFalse: 1, falseAsTrue: 1, total: 2 });
  });

  it('measures repeat agreement and time per verdict over both runs', () => {
    // Same label: t1, t2, m1, f2 → 4/6.
    expect(s.repeat).toMatchObject({ hits: 4, n: 6 });
    // 12 verdicts, 1–6 s each run: median 3.5 s.
    expect(s.medianMs).toBe(3500);
    expect(s.baseRates).toEqual({ True: 2, Misleading: 2, False: 2 });
  });
});
