import { describe, expect, it } from 'vitest';
import type { FilterSentence } from './filter';
import { formatReviewReport, scoreReview } from './review-score';

const sentence = (clip: string, claims: Array<{ i: number; rated: boolean }>): FilterSentence => ({ clip, speaker: null, text: `${clip} said something.`, claims });

describe('claim review measurement', () => {
  const sentences = [
    sentence('a', [{ i: 0, rated: true }]),
    sentence('a', [{ i: 1, rated: false }]),
    sentence('b', []),
    sentence('b', [{ i: 0, rated: true }]),
    sentence('c', [{ i: 0, rated: true }]),
  ];

  it('counts sentences ending as cards and claims reaching one, before and after the review', () => {
    const score = scoreReview(sentences, [
      { before: 2, after: 1, dropped: ['opinion'] },
      { before: 1, after: 0, dropped: ['too vague to check'] },
      { before: 1, after: 0, dropped: ['not self-contained'] },
      null, // the filter dropped it
      { before: 0, after: 0, dropped: [], error: 'Gemini Nano failed' },
    ]);
    expect(score.passed).toEqual({ n: 5, hits: 4, rate: 0.8 });
    expect(score.withCards.before).toEqual({ n: 5, hits: 4, rate: 0.8 });
    expect(score.withCards.after).toEqual({ n: 5, hits: 2, rate: 0.4 });
    expect(score.cardsPerSentence).toEqual({ before: 5 / 4, after: 2 / 4 });
    // A failed sentence still ends as a card; one the filter dropped never does.
    expect(score.rated.before).toEqual({ n: 3, hits: 2, rate: 2 / 3 });
    expect(score.rated.after).toEqual({ n: 3, hits: 2, rate: 2 / 3 });
    expect(score.all.after.hits).toBe(2);
    expect(score.droppedFor).toEqual({ opinion: 1, 'too vague to check': 1, 'not self-contained': 1 });
    expect(score.pass).toBe(false);
    expect(formatReviewReport('test', score)).toContain('FAIL');
  });

  it('passes when at least 90% of rated claims still reach a card', () => {
    const all = sentences.map(() => ({ before: 1, after: 1, dropped: [] }));
    expect(scoreReview(sentences, all).pass).toBe(true);
  });
});
