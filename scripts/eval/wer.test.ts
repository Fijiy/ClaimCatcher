import { describe, expect, it } from 'vitest';
import { formatWerReport, scoreWer, wordErrors } from './wer';

// eval/README.md, "How to score speech-to-text against these": normalise both
// sides, treat [unclear: …] as a wildcard, drop fillers and NAME: labels.

describe('word errors against a reference transcript', () => {
  it('normalises both sides the same way before comparing', () => {
    const reference = 'BIDEN: Unemployment rate rose to 15%. We created 15,000 new jobs — gonna be well-paid.';
    const heard = 'unemployment rate rose to 15 percent we created 15000 new jobs going to be well paid';
    expect(wordErrors(reference, heard)).toEqual({ errors: 0, words: 16 });
  });

  it('drops fillers the model heard, and speaker labels on every line', () => {
    const reference = 'DAVID MUIR: Thank you.\nTRUMP: I have a plan.';
    expect(wordErrors(reference, 'Um, thank you. Uh, I have a, uh, plan.')).toEqual({ errors: 0, words: 6 });
  });

  it('counts substitutions, deletions and insertions', () => {
    // "rose" → "rows" (1), "to" dropped (1), "percent" extra (1)
    expect(wordErrors('Unemployment rate rose to 15 percent.', 'unemployment rate rows 15 percent percent')).toEqual({ errors: 3, words: 6 });
  });

  it('lets an [unclear] span match any run of words, or none, at no cost, and leaves its words out of the count', () => {
    const reference = 'BIDEN: [unclear: We | (nothing)] got to take a look at [unclear: what I | what] was left.';
    expect(wordErrors(reference, 'we got to take a look at what i was left')).toEqual({ errors: 0, words: 8 });
    expect(wordErrors(reference, 'got to take a look at was left')).toEqual({ errors: 0, words: 8 });
    expect(wordErrors(reference, 'got to take a look at all the things that was left')).toEqual({ errors: 0, words: 8 });
    // Outside the span, a miss still counts.
    expect(wordErrors(reference, 'got to make a look at was left')).toEqual({ errors: 1, words: 8 });
  });
});

describe('the speech-to-text gate', () => {
  const clips = [
    { clip: 'a', reference: 'one two three four five six seven eight nine ten', heard: 'one two three four five six seven eight nine ten', seconds: 60, ms: 2_000 },
    { clip: 'b', reference: 'one two three four five six seven eight nine ten', heard: 'one two tree four five six seven eight nine', seconds: 40, ms: 2_000 },
  ];

  it('pools errors over every word of every clip, and passes at 10% or less', () => {
    const score = scoreWer(clips);
    expect(score.wer).toBeCloseTo(2 / 20);
    expect(score.clips.map((c) => [c.clip, c.wer])).toEqual([
      ['a', 0],
      ['b', 0.2],
    ]);
    expect(score.pass).toBe(true);
    // Speech-to-text time over audio time.
    expect(score.realTime).toBeCloseTo(4 / 100);
  });

  it('fails above 10%', () => {
    const score = scoreWer([{ ...clips[1]!, heard: 'one two tree four five six seven eight' }]);
    expect(score.wer).toBeCloseTo(0.3);
    expect(score.pass).toBe(false);
  });

  it('prints the bar with PASS or FAIL, and each clip', () => {
    const report = formatWerReport('Moonshine base', scoreWer(clips));
    expect(report).toContain('PASS  Word error rate');
    expect(report).toContain('10.0%');
    expect(report).toContain('≤ 10.0%');
    expect(report).toMatch(/b\s+20\.0%\s+2\/10/);
    expect(formatWerReport('x', scoreWer([{ ...clips[1]!, heard: '' }]))).toContain('FAIL  Word error rate');
  });
});
