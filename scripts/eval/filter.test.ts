import { describe, expect, it } from 'vitest';
import { formatFilterReport, loadFilterSentences, scoreFilter, sweepFilter, type FilterSentence } from './filter';

const sentence = (text: string, claims: Array<[number, boolean]> = []): FilterSentence => ({
  clip: 'clip',
  speaker: 'BIDEN',
  text,
  claims: claims.map(([i, rated]) => ({ i, rated })),
});

// Ten sentences: claim 0 (rated) spans two sentences, claim 1 (rated) one, claim 2 (unrated) one.
const SET = [
  sentence('Good evening.'),
  sentence('Unemployment rose to 15 percent', [[0, true]]),
  sentence('when I took office.', [[0, true]]),
  sentence('We created 15,000 jobs.', [[1, true]]),
  sentence('Inflation was 9 percent.', [[2, false]]),
  sentence('Thank you.'),
  sentence('I agree.'),
  sentence('Look.'),
  sentence('Let me finish.'),
  sentence('That is all.'),
];

describe('the claim filter gate', () => {
  it('counts a claim as caught when any sentence holding it passes, and reports the share of sentences passed', () => {
    const passed = [false, false, true, true, false, false, false, false, false, false];
    const score = scoreFilter(SET, passed);
    expect(score.rated).toMatchObject({ hits: 2, n: 2 });
    expect(score.all).toMatchObject({ hits: 2, n: 3 });
    expect(score.passed).toMatchObject({ hits: 2, n: 10 });
    expect(score.pass).toBe(true);
  });

  it('fails when it misses more than 10% of rated claims, or passes more than 40% of sentences', () => {
    expect(scoreFilter(SET, [false, true, false, false, true, false, false, false, false, false]).pass).toBe(false);
    const everything = SET.map(() => true);
    expect(scoreFilter(SET, everything)).toMatchObject({ rated: { rate: 1 }, pass: false });
    const four = [true, true, false, true, true, false, false, false, false, false];
    expect(scoreFilter(SET, four)).toMatchObject({ passed: { rate: 0.4 }, pass: true });
  });

  it('sweeps thresholds over the scores, for tuning', () => {
    const scores = [0.1, 0.45, 0.2, 0.9, 0.6, 0.05, 0.3, 0.1, 0.1, 0.2];
    const sweep = sweepFilter(SET, scores, [0.4, 0.5]);
    expect(sweep.map((row) => [row.threshold, row.score.rated.hits, row.score.passed.hits])).toEqual([
      [0.4, 2, 3],
      [0.5, 1, 2],
    ]);
  });

  it('prints each bar with PASS or FAIL', () => {
    const passed = [false, false, true, true, false, false, false, false, false, false];
    const report = formatFilterReport('claimbuster-detector, threshold 0.5', scoreFilter(SET, passed), sweepFilter(SET, [0.1, 0.45, 0.2, 0.9, 0.6, 0.05, 0.3, 0.1, 0.1, 0.2], [0.5]));
    expect(report).toMatch(/PASS {2}Rated claims caught\s+2\/2 \(100\.0%\)\s+target ≥ 90\.0%/);
    expect(report).toMatch(/PASS {2}Sentences passed\s+2\/10 \(20\.0%\)\s+target ≤ 40\.0%/);
    expect(report).toContain('All check-worthy claims caught');
    expect(report).toContain('Gate: PASS');
  });
});

describe("the filter gate's sentences", () => {
  it("are the reference transcripts' 281 sentences, holding all 80 of the set's claims (29 rated)", () => {
    const sentences = loadFilterSentences();
    expect(sentences).toHaveLength(281);
    const claims = new Map(sentences.flatMap((s) => s.claims.map((c) => [`${s.clip}#${c.i}`, c.rated] as const)));
    expect(claims.size).toBe(80);
    expect([...claims.values()].filter(Boolean)).toHaveLength(29);
  });
});
