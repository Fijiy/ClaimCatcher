// The held-out accuracy report's numbers (docs/quality-gate.md, "Held-out
// accuracy"): per run, exact and balanced accuracy, adjacent matches,
// Unverified, True↔False errors and accuracy when a label was given, each
// with a 95% interval (Wilson for rates, a stratified bootstrap for balanced
// accuracy), split into firm and judgment mappings; across runs, repeat
// agreement and time per verdict. Scored as eval/README.md says, against the
// mapped label (the held-out set accepts one label per claim).

import type { Label } from '../../src/session/types';
import type { GateCase } from './eval-set';
import { quantile, type Judged } from './score';
import { bootstrapBalanced, wilson, type Interval } from './stats';

const TRUTHS = ['True', 'Misleading', 'False'] as const;
type Truth = (typeof TRUTHS)[number];

export interface RateCI {
  hits: number;
  n: number;
  rate: number;
  ci: Interval;
}

export interface HeldoutRun {
  exact: RateCI;
  balanced: { value: number; ci: Interval };
  recall: Record<Truth, RateCI>;
  adjacent: RateCI;
  unverified: RateCI;
  /** Exact matches among the claims that got True, Misleading or False. */
  exactWhenLabelled: RateCI;
  opposite: { trueAsFalse: number; falseAsTrue: number; total: number };
  firm: { exact: RateCI; adjacent: RateCI };
  judgment: { exact: RateCI; adjacent: RateCI };
  failed: number;
  /** Truth → label given → count. */
  confusion: Record<Truth, Partial<Record<Label, number>>>;
}

export interface HeldoutScore {
  runs: HeldoutRun[];
  /** Same label in every run; null with one run. */
  repeat: RateCI | null;
  medianMs: number;
  p90Ms: number;
  baseRates: Record<Truth, number>;
}

const rateCI = (hits: number, n: number): RateCI => ({ hits, n, rate: n === 0 ? 0 : hits / n, ci: wilson(hits, n) });
const isAdjacent = (truth: Label, label: Label) => truth === label || (label !== truth && [label, truth].every((l) => l === 'Misleading' || l === 'False'));

export function scoreRun(cases: GateCase[], verdicts: Judged[], options: { iterations?: number; seed?: number } = {}): HeldoutRun {
  const byId = new Map(verdicts.map((v) => [v.caseId, v]));
  const labelOf = (c: GateCase): Label => byId.get(c.id)?.label ?? 'Unverified';
  const exact = (c: GateCase) => c.accept.includes(labelOf(c));
  const count = (subset: GateCase[], hit: (c: GateCase) => boolean) => rateCI(subset.filter(hit).length, subset.length);
  const adjacent = (c: GateCase) => exact(c) || isAdjacent(c.truth, labelOf(c));
  const byTruth = Object.fromEntries(TRUTHS.map((t) => [t, cases.filter((c) => c.truth === t)])) as Record<Truth, GateCase[]>;
  const hits = Object.fromEntries(TRUTHS.map((t) => [t, byTruth[t].map(exact)]));
  const present = TRUTHS.filter((t) => byTruth[t].length > 0);
  const balanced = present.reduce((sum, t) => sum + count(byTruth[t], exact).rate, 0) / (present.length || 1);
  const opposite = (truth: Truth, said: Label) => byTruth[truth].filter((c) => labelOf(c) === said && !c.accept.includes(said)).length;
  const confusion = Object.fromEntries(TRUTHS.map((t) => [t, {}])) as HeldoutRun['confusion'];
  for (const c of cases) {
    const row = confusion[c.truth as Truth];
    row[labelOf(c)] = (row[labelOf(c)] ?? 0) + 1;
  }
  const labelled = cases.filter((c) => labelOf(c) !== 'Unverified');
  const firm = cases.filter((c) => c.basis === 'firm');
  const judgment = cases.filter((c) => c.basis === 'judgment');
  const trueAsFalse = opposite('True', 'False');
  const falseAsTrue = opposite('False', 'True');
  return {
    exact: count(cases, exact),
    balanced: { value: balanced, ci: bootstrapBalanced(hits, options) },
    recall: Object.fromEntries(TRUTHS.map((t) => [t, count(byTruth[t], exact)])) as Record<Truth, RateCI>,
    adjacent: count(cases, adjacent),
    unverified: count(cases, (c) => labelOf(c) === 'Unverified'),
    exactWhenLabelled: count(labelled, exact),
    opposite: { trueAsFalse, falseAsTrue, total: trueAsFalse + falseAsTrue },
    firm: { exact: count(firm, exact), adjacent: count(firm, adjacent) },
    judgment: { exact: count(judgment, exact), adjacent: count(judgment, adjacent) },
    failed: cases.filter((c) => byId.get(c.id)?.error !== undefined).length,
    confusion,
  };
}

export function scoreHeldout(cases: GateCase[], runs: Judged[][], options: { iterations?: number; seed?: number } = {}): HeldoutScore {
  const labels = runs.map((run) => new Map(run.map((v) => [v.caseId, v.label])));
  const same = cases.filter((c) => labels.every((run) => run.get(c.id) === labels[0]!.get(c.id))).length;
  const times = runs.flat().map((v) => v.ms).sort((a, b) => a - b);
  return {
    runs: runs.map((run) => scoreRun(cases, run, options)),
    repeat: runs.length < 2 ? null : rateCI(same, cases.length),
    medianMs: quantile(times, 0.5),
    p90Ms: quantile(times, 0.9),
    baseRates: Object.fromEntries(TRUTHS.map((t) => [t, cases.filter((c) => c.truth === t).length])) as Record<Truth, number>,
  };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const ci = (r: { ci: Interval }) => `[${pct(r.ci.lo)}, ${pct(r.ci.hi)}]`;
const frac = (r: RateCI) => `${r.hits}/${r.n} = ${pct(r.rate)} ${ci(r)}`;
const LABELS: Label[] = ['True', 'Misleading', 'False', 'Unverified'];

/** The report as Markdown: one column per run. */
export function formatHeldout(title: string, s: HeldoutScore): string {
  const head = `| | ${s.runs.map((_, i) => `Run ${i + 1}`).join(' | ')} |`;
  const rule = `|---|${s.runs.map(() => '---').join('|')}|`;
  const row = (name: string, cell: (r: HeldoutRun) => string) => `| ${name} | ${s.runs.map(cell).join(' | ')} |`;
  const lines = [
    `### ${title}`,
    '',
    `${s.baseRates.True + s.baseRates.Misleading + s.baseRates.False} claims: ${s.baseRates.True} True, ${s.baseRates.Misleading} Misleading, ${s.baseRates.False} False (mapped). Intervals are 95%: Wilson for rates, a stratified bootstrap for balanced accuracy.`,
    '',
    head,
    rule,
    row('Balanced accuracy', (r) => `${pct(r.balanced.value)} ${ci(r.balanced)}`),
    row('Exact match', (r) => frac(r.exact)),
    row('Exact, True claims', (r) => frac(r.recall.True)),
    row('Exact, Misleading claims', (r) => frac(r.recall.Misleading)),
    row('Exact, False claims', (r) => frac(r.recall.False)),
    row('Adjacent (Misleading↔False counts)', (r) => frac(r.adjacent)),
    row('Unverified', (r) => frac(r.unverified)),
    row('Exact when a label was given', (r) => frac(r.exactWhenLabelled)),
    row('True↔False errors', (r) => `${r.opposite.total} (True→False ${r.opposite.trueAsFalse}, False→True ${r.opposite.falseAsTrue})`),
    row('Firm mappings: exact', (r) => frac(r.firm.exact)),
    row('Firm mappings: adjacent', (r) => frac(r.firm.adjacent)),
    row('Judgment mappings: exact', (r) => frac(r.judgment.exact)),
    row('Judgment mappings: adjacent', (r) => frac(r.judgment.adjacent)),
    row('Failed verdicts (shown Unverified)', (r) => String(r.failed)),
    '',
    `Same label on both runs: ${s.repeat ? frac(s.repeat) : 'not measured (one run)'}. Time per verdict: median ${(s.medianMs / 1000).toFixed(1)} s, p90 ${(s.p90Ms / 1000).toFixed(1)} s.`,
    '',
    ...s.runs.flatMap((r, i) => [
      `Confusion, run ${i + 1} (rows: mapped label; columns: label given):`,
      '',
      `| | ${LABELS.join(' | ')} |`,
      `|---|${LABELS.map(() => '---').join('|')}|`,
      ...TRUTHS.map((t) => `| ${t} | ${LABELS.map((l) => r.confusion[t][l] ?? 0).join(' | ')} |`),
      '',
    ]),
  ];
  return lines.join('\n');
}
