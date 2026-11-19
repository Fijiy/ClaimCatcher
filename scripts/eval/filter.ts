// The claim filter gate's cases and scoring. The cases are the evaluation
// set's reference transcripts split into sentences, each marked with the
// claims (eval/clips.json `claims[]`) it holds: eval/filter/sentences.json,
// from prototype/local-mode-eval (prep.py: split after . ? !, claims located
// by word matching; a claim can span two or three sentences).
//
// A claim is caught when any sentence holding it passes the filter. The bar:
// at least 90% of rated claims caught while passing at most 40% of sentences.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './cli';
import { EPSILON, fraction, percent, rate, type Rate } from './score';

export const FILTER_BAR = { rated: 0.9, passed: 0.4 } as const;

export interface FilterSentence {
  clip: string;
  /** The reference's label for who said it ("BIDEN"), or null. */
  speaker: string | null;
  text: string;
  /** The claims it holds: index into the clip's `claims`, and whether a fact-checker rated it. */
  claims: Array<{ i: number; rated: boolean }>;
}

export function loadFilterSentences(): FilterSentence[] {
  return JSON.parse(readFileSync(join(ROOT, 'eval', 'filter', 'sentences.json'), 'utf8')) as FilterSentence[];
}

export interface FilterScore {
  /** Rated claims caught. */
  rated: Rate;
  /** Every check-worthy claim (rated or not) caught. */
  all: Rate;
  /** Sentences the filter let through. */
  passed: Rate;
  /** Of the sentences passed, the share holding a claim. */
  precision: number;
  pass: boolean;
}

/** `passed[i]`: whether the filter let sentence i through. */
export function scoreFilter(sentences: FilterSentence[], passed: boolean[]): FilterScore {
  const claims = new Map<string, { rated: boolean; caught: boolean }>();
  sentences.forEach((s, i) => {
    for (const c of s.claims) {
      const key = `${s.clip}#${c.i}`;
      const claim = claims.get(key) ?? { rated: c.rated, caught: false };
      claim.caught ||= passed[i] === true;
      claims.set(key, claim);
    }
  });
  const all = [...claims.values()];
  const rated = all.filter((c) => c.rated);
  const through = sentences.filter((_, i) => passed[i]);
  const score = {
    rated: rate(rated.filter((c) => c.caught).length, rated.length),
    all: rate(all.filter((c) => c.caught).length, all.length),
    passed: rate(through.length, sentences.length),
    precision: through.length === 0 ? 0 : through.filter((s) => s.claims.length > 0).length / through.length,
  };
  return { ...score, pass: score.rated.rate >= FILTER_BAR.rated - EPSILON && score.passed.rate <= FILTER_BAR.passed + EPSILON };
}

/** The gate's numbers at other thresholds, from each sentence's check-worthiness score. */
export function sweepFilter(sentences: FilterSentence[], scores: number[], thresholds: number[]): Array<{ threshold: number; score: FilterScore }> {
  return thresholds.map((threshold) => ({ threshold, score: scoreFilter(sentences, scores.map((s) => s >= threshold)) }));
}

export function formatFilterReport(title: string, score: FilterScore, sweep: Array<{ threshold: number; score: FilterScore }>): string {
  const bar = (pass: boolean, name: string, value: Rate, target: string) => `  ${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(30)}${fraction(value).padEnd(24)}target ${target}`;
  return [
    `Claim filter gate: ${title}`,
    `${score.passed.n} sentences holding ${score.all.n} check-worthy claims, ${score.rated.n} of them rated`,
    '',
    bar(score.rated.rate >= FILTER_BAR.rated - EPSILON, 'Rated claims caught', score.rated, `≥ ${percent(FILTER_BAR.rated)}`),
    bar(score.passed.rate <= FILTER_BAR.passed + EPSILON, 'Sentences passed', score.passed, `≤ ${percent(FILTER_BAR.passed)}`),
    '',
    `Gate: ${score.pass ? 'PASS' : 'FAIL'}`,
    '',
    `  All check-worthy claims caught: ${fraction(score.all)}`,
    `  Passed sentences holding a claim: ${percent(score.precision)}`,
    '',
    'At other thresholds (same scores):',
    '  threshold  passed            rated caught      all caught',
    ...sweep.map(
      ({ threshold, score: s }) =>
        `  ${threshold.toFixed(2).padEnd(11)}${percent(s.passed.rate).padEnd(18)}${percent(s.rated.rate).padEnd(18)}${percent(s.all.rate).padEnd(10)}${s.pass ? 'pass' : 'fail'}`,
    ),
  ].join('\n');
}
