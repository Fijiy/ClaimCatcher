import { describe, expect, it } from 'vitest';
import type { GateCase } from './eval-set';
import { formatReport, scoreGate, scorePass, type BarId, type Judged } from './score';

/** A rated claim; only what scoring reads matters here. */
function rated(id: string, truth: GateCase['truth'], basis: GateCase['basis'], accept: GateCase['accept'] = [truth]): GateCase {
  return {
    id,
    clip: id.split('#')[0]!,
    date: '2024-06-27',
    truth,
    accept,
    basis,
    input: { literal: id, implied: '', context: '', title: 't', evidence: [], judgedAsOf: '2024-06-27' },
  };
}

const said = (caseId: string, label: Judged['label'], ms = 1000): Judged => ({ caseId, label, ms });

describe('scoring one pass', () => {
  const cases = [
    rated('a#0', 'True', 'firm'),
    rated('b#0', 'Misleading', 'firm'),
    rated('c#0', 'False', 'judgment', ['False', 'Misleading']),
    rated('d#0', 'False', 'judgment'),
  ];

  it('counts an exact match when the label is one the audited key accepts', () => {
    const m = scorePass(cases, [said('a#0', 'True'), said('b#0', 'False'), said('c#0', 'Misleading'), said('d#0', 'Unverified')]);
    // a hit; b miss (adjacent); c hit through its second accepted label; d miss.
    expect(m.exact).toEqual({ n: 4, hits: 2, rate: 0.5 });
    // b counts as a near miss: Misleading and False are adjacent. d's Unverified never is.
    expect(m.adjacent).toEqual({ n: 4, hits: 3, rate: 0.75 });
  });

  it('reports firm and judgment mappings separately', () => {
    const m = scorePass(cases, [said('a#0', 'True'), said('b#0', 'False'), said('c#0', 'Misleading'), said('d#0', 'Misleading')]);
    expect(m.firm.exact).toEqual({ n: 2, hits: 1, rate: 0.5 });
    expect(m.firm.adjacent).toEqual({ n: 2, hits: 2, rate: 1 });
    expect(m.judgment.exact).toEqual({ n: 2, hits: 1, rate: 0.5 });
    expect(m.judgment.adjacent).toEqual({ n: 2, hits: 2, rate: 1 });
  });

  it('takes balanced accuracy as the mean recall over the True, Misleading and False claims', () => {
    const m = scorePass(cases, [said('a#0', 'True'), said('b#0', 'False'), said('c#0', 'Misleading'), said('d#0', 'Misleading')]);
    // True 1/1, Misleading 0/1, False 1/2.
    expect(m.balanced).toBeCloseTo(0.5, 10);
  });

  it('counts True↔False errors only where the key does not accept the label', () => {
    const lenient = [rated('t#0', 'True', 'judgment', ['True', 'False']), rated('t#1', 'True', 'firm'), rated('f#0', 'False', 'firm')];
    const m = scorePass(lenient, [said('t#0', 'False'), said('t#1', 'False'), said('f#0', 'True')]);
    expect(m.opposite).toEqual({ trueAsFalse: 1, falseAsTrue: 1 });
  });

  it('reports the share of claims ended Unverified, failures included', () => {
    const m = scorePass(cases, [
      said('a#0', 'Unverified'),
      { ...said('b#0', 'Unverified'), error: 'Gemini Nano: no answer within 60 s' },
      said('c#0', 'False'),
      said('d#0', 'False'),
    ]);
    expect(m.unverified).toEqual({ n: 4, hits: 2, rate: 0.5 });
    expect(m.failed).toBe(1);
  });
});

describe('the bar', () => {
  /** n claims with each truth label, ids like T0, M0, F0. */
  function set(t: number, m: number, f: number): GateCase[] {
    const make = (n: number, truth: GateCase['truth'], p: string) => Array.from({ length: n }, (_, i) => rated(`${p}${i}#0`, truth, 'firm'));
    return [...make(t, 'True', 'T'), ...make(m, 'Misleading', 'M'), ...make(f, 'False', 'F')];
  }
  const right = (cases: GateCase[], ms = 1000) => cases.map((c) => said(c.id, c.truth, ms));
  const relabel = (pass: Judged[], changes: Record<string, Judged['label']>) =>
    pass.map((v) => (v.caseId in changes ? { ...v, label: changes[v.caseId]! } : v));
  const check = (result: ReturnType<typeof scoreGate>, id: BarId) => result.checks.find((c) => c.id === id)!.pass;

  it('passes when every check passes on both runs', () => {
    const cases = set(3, 4, 3);
    const result = scoreGate(cases, [right(cases), right(cases)]);
    expect(result.checks.map((c) => [c.id, c.pass])).toEqual([
      ['opposite', true],
      ['balanced', true],
      ['unverified', true],
      ['repeat', true],
      ['median', true],
    ]);
    expect(result.pass).toBe(true);
  });

  it('fails on a single True↔False error in either run (the hard check)', () => {
    const cases = set(3, 4, 3);
    const result = scoreGate(cases, [right(cases), relabel(right(cases), { 'F0#0': 'True' })]);
    expect(check(result, 'opposite')).toBe(false);
    expect(result.pass).toBe(false);
  });

  it('needs balanced accuracy of at least 60% in every run', () => {
    const cases = set(5, 5, 5);
    // True 5/5, Misleading 2/5, False 2/5: exactly 60%.
    const atBar = relabel(right(cases), { 'M0#0': 'False', 'M1#0': 'False', 'M2#0': 'False', 'F0#0': 'Misleading', 'F1#0': 'Misleading', 'F2#0': 'Misleading' });
    expect(check(scoreGate(cases, [atBar, atBar]), 'balanced')).toBe(true);
    const below = relabel(atBar, { 'T0#0': 'Misleading' });
    expect(check(scoreGate(cases, [atBar, below]), 'balanced')).toBe(false);
  });

  it('allows Unverified on at most 25% of claims', () => {
    const cases = set(1, 1, 2);
    const one = relabel(right(cases), { 'F0#0': 'Unverified' });
    expect(check(scoreGate(cases, [one, one]), 'unverified')).toBe(true);
    const two = relabel(one, { 'F1#0': 'Unverified' });
    expect(check(scoreGate(cases, [one, two]), 'unverified')).toBe(false);
  });

  it('needs the same label on a repeat run for at least 90% of claims', () => {
    const cases = set(3, 4, 3);
    const first = right(cases);
    expect(check(scoreGate(cases, [first, relabel(first, { 'M0#0': 'False' })]), 'repeat')).toBe(true);
    const twoChanged = relabel(first, { 'M0#0': 'False', 'M1#0': 'False' });
    const result = scoreGate(cases, [first, twoChanged]);
    expect(result.repeat).toBeCloseTo(0.8, 10);
    expect(check(result, 'repeat')).toBe(false);
  });

  it('cannot pass the repeat check on a single run', () => {
    const cases = set(3, 4, 3);
    const result = scoreGate(cases, [right(cases)]);
    expect(result.repeat).toBeNull();
    expect(check(result, 'repeat')).toBe(false);
    expect(result.pass).toBe(false);
  });

  it('needs a median of at most 9 s per verdict, over every verdict of every run', () => {
    const cases = set(1, 1, 1);
    const times = (...ms: number[]) => right(cases).map((v, i) => ({ ...v, ms: ms[i]! }));
    // All six times: 1, 2, 8.9, 9.1, 30, 40 s: median 9 s.
    const ok = scoreGate(cases, [times(1000, 8900, 30_000), times(2000, 9100, 40_000)]);
    expect(ok.medianMs).toBe(9000);
    expect(check(ok, 'median')).toBe(true);
    const slow = scoreGate(cases, [times(1000, 9000, 30_000), times(2000, 9100, 40_000)]);
    expect(check(slow, 'median')).toBe(false);
  });
});

describe('the printed report', () => {
  const cases = [rated('a#0', 'True', 'firm'), rated('b#0', 'Misleading', 'judgment'), rated('c#0', 'False', 'judgment')];
  const run = (labels: Judged['label'][], ms = 1000) => cases.map((c, i) => said(c.id, labels[i]!, ms));

  it('prints each bar with pass or fail, and the gate overall', () => {
    const text = formatReport('Gemini Nano', cases, scoreGate(cases, [run(['True', 'Misleading', 'False']), run(['True', 'False', 'False'], 20_000)]));
    const lines = text.split('\n');
    const bar = (name: string) => lines.find((l) => l.includes(name))!.trim().split(/\s+/)[0];
    expect(bar('True↔False errors')).toBe('PASS');
    expect(bar('Balanced accuracy')).toBe('PASS');
    expect(bar('Unverified')).toBe('PASS');
    expect(bar('Same label on a repeat run')).toBe('FAIL');
    expect(bar('Median time per verdict')).toBe('FAIL');
    expect(text).toMatch(/^Gate: FAIL$/m);
  });

  it('reports exact and adjacent matches, with firm and judgment mappings separately, for each run', () => {
    const text = formatReport('m', cases, scoreGate(cases, [run(['True', 'Misleading', 'False']), run(['True', 'False', 'False'])]));
    expect(text).toMatch(/^\s*exact\s+3\/3 \(100\.0%\)\s+2\/3 \(66\.7%\)$/m);
    expect(text).toMatch(/^\s*adjacent\s+3\/3 \(100\.0%\)\s+3\/3 \(100\.0%\)$/m);
    expect(text).toMatch(/^\s*firm exact\s+1\/1 \(100\.0%\)\s+1\/1 \(100\.0%\)$/m);
    expect(text).toMatch(/^\s*judgment exact\s+2\/2 \(100\.0%\)\s+1\/2 \(50\.0%\)$/m);
    expect(text).toMatch(/^\s*judgment adjacent\s+2\/2 \(100\.0%\)\s+2\/2 \(100\.0%\)$/m);
  });
});
