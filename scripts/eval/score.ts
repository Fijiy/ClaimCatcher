// Scoring for the verdict gate, as eval/README.md defines it: exact matches
// against the audited key, adjacent matches (Misleading and False count as a
// near miss), firm and judgment mappings reported separately.

import type { Label } from '../../src/session/types';
import type { GateCase } from './eval-set';

/** What the verdict step said about one case. */
export interface Judged {
  caseId: string;
  /** After the consistency rule. A verdict that failed is Unverified, as its card would be. */
  label: Label;
  /** How long the verdict step took, retry included. */
  ms: number;
  /** Set when the step failed and the claim ended Unverified. */
  error?: string;
  conclusion?: string;
}

export interface Rate {
  n: number;
  hits: number;
  rate: number;
}

export interface PassMetrics {
  exact: Rate;
  adjacent: Rate;
  firm: { exact: Rate; adjacent: Rate };
  judgment: { exact: Rate; adjacent: Rate };
  /** The mean of the exact-match rate over the True, Misleading and False claims. */
  balanced: number;
  /** The hard errors: a True claim called False, or a False one called True, where the key accepts neither. */
  opposite: { trueAsFalse: number; falseAsTrue: number };
  unverified: Rate;
  /** Verdicts that failed (and so ended Unverified). */
  failed: number;
  /** Truth label → label given → count. */
  confusion: Record<string, Partial<Record<Label, number>>>;
}

const TRUTHS = ['True', 'Misleading', 'False'] as const;

export const rate = (hits: number, n: number): Rate => ({ n, hits, rate: n === 0 ? 0 : hits / n });

const isExact = (c: GateCase, label: Label) => c.accept.includes(label);
const isAdjacent = (c: GateCase, label: Label) =>
  isExact(c, label) || (label !== c.truth && [label, c.truth].every((l) => l === 'Misleading' || l === 'False'));

export function scorePass(cases: GateCase[], verdicts: Judged[]): PassMetrics {
  const byId = new Map(verdicts.map((v) => [v.caseId, v]));
  const labelOf = (c: GateCase): Label => byId.get(c.id)?.label ?? 'Unverified';
  const count = (subset: GateCase[], hit: (c: GateCase, label: Label) => boolean) =>
    rate(subset.filter((c) => hit(c, labelOf(c))).length, subset.length);
  const firm = cases.filter((c) => c.basis === 'firm');
  const judgment = cases.filter((c) => c.basis === 'judgment');
  const recalls = TRUTHS.map((truth) => cases.filter((c) => c.truth === truth))
    .filter((group) => group.length > 0)
    .map((group) => count(group, isExact).rate);
  const opposite = (truth: Label, said: Label) => cases.filter((c) => c.truth === truth && labelOf(c) === said && !c.accept.includes(said)).length;
  const confusion: PassMetrics['confusion'] = {};
  for (const c of cases) {
    const row = (confusion[c.truth] ??= {});
    row[labelOf(c)] = (row[labelOf(c)] ?? 0) + 1;
  }
  return {
    balanced: recalls.length === 0 ? 0 : recalls.reduce((a, b) => a + b, 0) / recalls.length,
    opposite: { trueAsFalse: opposite('True', 'False'), falseAsTrue: opposite('False', 'True') },
    unverified: count(cases, (_, label) => label === 'Unverified'),
    failed: cases.filter((c) => byId.get(c.id)?.error !== undefined).length,
    confusion,
    exact: count(cases, isExact),
    adjacent: count(cases, isAdjacent),
    firm: { exact: count(firm, isExact), adjacent: count(firm, isAdjacent) },
    judgment: { exact: count(judgment, isExact), adjacent: count(judgment, isAdjacent) },
  };
}

// ---- The bar (spec "Quality gates", ticket #40) --------------------------------

export const BAR = {
  /** True↔False errors allowed: none. The one hard check. */
  opposite: 0,
  balanced: 0.6,
  unverified: 0.25,
  repeat: 0.9,
  medianMs: 9_000,
} as const;

export type BarId = 'opposite' | 'balanced' | 'unverified' | 'repeat' | 'median';

export interface BarCheck {
  id: BarId;
  name: string;
  /** The measured value, as printed. */
  value: string;
  target: string;
  pass: boolean;
}

export interface GateScore {
  /** One per run, in order. */
  runs: PassMetrics[];
  /** Share of claims with the same label in every run; null with a single run. */
  repeat: number | null;
  /** Over every verdict of every run. */
  medianMs: number;
  p90Ms: number;
  checks: BarCheck[];
  /** Every check passes. */
  pass: boolean;
}

/** Rates are compared with a little slack, so 3/5 counts as 60%. (Shared with the on-device model gates.) */
export const EPSILON = 1e-9;
export const percent = (x: number) => `${(x * 100).toFixed(1)}%`;
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/**
 * Scores every run and checks the bar. Each rate is checked on every run and
 * the worst run counts; the repeat check compares the runs with each other.
 */
export function scoreGate(cases: GateCase[], runs: Judged[][]): GateScore {
  const metrics = runs.map((run) => scorePass(cases, run));
  const worst = (pick: (m: PassMetrics) => number, take: (a: number, b: number) => number) => metrics.map(pick).reduce((a, b) => take(a, b));
  const opposite = worst((m) => m.opposite.trueAsFalse + m.opposite.falseAsTrue, Math.max);
  const balanced = worst((m) => m.balanced, Math.min);
  const unverified = worst((m) => m.unverified.rate, Math.max);
  const repeat = runs.length < 2 ? null : sameInEveryRun(cases, runs);
  const times = runs.flat().map((v) => v.ms).sort((a, b) => a - b);
  const medianMs = quantile(times, 0.5);
  const p90Ms = quantile(times, 0.9);

  const checks: BarCheck[] = [
    { id: 'opposite', name: 'True↔False errors (hard)', value: String(opposite), target: '0', pass: opposite <= BAR.opposite },
    { id: 'balanced', name: 'Balanced accuracy', value: percent(balanced), target: `≥ ${percent(BAR.balanced)}`, pass: balanced >= BAR.balanced - EPSILON },
    {
      id: 'unverified',
      name: 'Unverified',
      value: percent(unverified),
      target: `≤ ${percent(BAR.unverified)}`,
      pass: unverified <= BAR.unverified + EPSILON,
    },
    {
      id: 'repeat',
      name: 'Same label on a repeat run',
      value: repeat === null ? 'not measured (one run)' : percent(repeat),
      target: `≥ ${percent(BAR.repeat)}`,
      pass: repeat !== null && repeat >= BAR.repeat - EPSILON,
    },
    { id: 'median', name: 'Median time per verdict', value: seconds(medianMs), target: `≤ ${seconds(BAR.medianMs)}`, pass: medianMs <= BAR.medianMs },
  ];
  return { runs: metrics, repeat, medianMs, p90Ms, checks, pass: checks.every((c) => c.pass) };
}

function sameInEveryRun(cases: GateCase[], runs: Judged[][]): number {
  const labels = runs.map((run) => new Map(run.map((v) => [v.caseId, v.label])));
  const same = cases.filter((c) => labels.every((run) => run.get(c.id) === labels[0]!.get(c.id))).length;
  return cases.length === 0 ? 0 : same / cases.length;
}

/** Linear interpolation between closest ranks; the median of an even count is the mean of the middle two. */
export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
}

// ---- The printed report ---------------------------------------------------------

export const fraction = (r: Rate) => `${r.hits}/${r.n} (${percent(r.rate)})`;
const LABEL_ORDER: Label[] = ['True', 'Misleading', 'False', 'Unverified'];

/** The gate's result as printed: each bar with PASS or FAIL, then the matches per run. */
export function formatReport(title: string, cases: GateCase[], score: GateScore): string {
  const runs = score.runs;
  const header = `${''.padEnd(20)}${runs.map((_, i) => `run ${i + 1}`.padEnd(18)).join('')}`.trimEnd();
  const row = (name: string, pick: (m: PassMetrics) => Rate) => `  ${name.padEnd(18)}${runs.map((m) => fraction(pick(m)).padEnd(18)).join('')}`.trimEnd();
  const lines = [
    `Verdict gate: ${title}`,
    `${cases.length} rated claims × ${runs.length} run${runs.length === 1 ? '' : 's'}`,
    '',
    'The bar (each rate on its worst run):',
    ...score.checks.map((c) => `  ${c.pass ? 'PASS' : 'FAIL'}  ${c.name.padEnd(30)}${c.value.padEnd(24)}target ${c.target}`),
    '',
    `Gate: ${score.pass ? 'PASS' : 'FAIL'}`,
    '',
    'Matches against the audited key (adjacent also counts Misleading↔False):',
    header,
    row('exact', (m) => m.exact),
    row('adjacent', (m) => m.adjacent),
    row('firm exact', (m) => m.firm.exact),
    row('firm adjacent', (m) => m.firm.adjacent),
    row('judgment exact', (m) => m.judgment.exact),
    row('judgment adjacent', (m) => m.judgment.adjacent),
    row('Unverified', (m) => m.unverified),
    `  ${'failed verdicts'.padEnd(18)}${runs.map((m) => String(m.failed).padEnd(18)).join('')}`.trimEnd(),
    `  ${'balanced'.padEnd(18)}${runs.map((m) => percent(m.balanced).padEnd(18)).join('')}`.trimEnd(),
    '',
    `Time per verdict: median ${seconds(score.medianMs)}, p90 ${seconds(score.p90Ms)}`,
    '',
    'Labels given, by the key’s label (run 1):',
    ...(['True', 'Misleading', 'False'] as const).map((truth) => {
      const given = runs[0]?.confusion[truth] ?? {};
      return `  ${truth.padEnd(12)}${LABEL_ORDER.filter((l) => given[l]).map((l) => `${l} ${given[l]}`).join(', ')}`;
    }),
  ];
  return lines.join('\n');
}
