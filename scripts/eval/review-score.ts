// The claim review's measurement (#46): on the evaluation set's sentences,
// how many end as cards before and after the review, and how many rated
// claims still reach a card through the claim filter, claim breakdown and the
// review together. The filter gate's bar applies to the whole: at least 90%
// of rated claims reach a card.
//
// A claim reaches a card when a sentence holding it passes the filter and
// gives at least one card (eval/filter/sentences.json marks which sentences
// hold which claims, as for the filter gate).

import { FILTER_BAR, type FilterSentence } from './filter';
import { EPSILON, fraction, percent, rate, type Rate } from './score';

/** What one sentence came to. `null` for a sentence the filter dropped (never broken down). */
export interface SentenceResult {
  /** Claims breakdown gave (after its code checks), before the review. */
  before: number;
  /** Claims left after the review: the cards. */
  after: number;
  /** Why the review (or the code checks) dropped the others. */
  dropped: string[];
  /** The model failed on this sentence (it would end as one Unverified card). */
  error?: string;
}

export interface ReviewScore {
  sentences: number;
  /** Sentences the filter passed. */
  passed: Rate;
  /** Sentences that end as at least one card, before and after the review. */
  withCards: { before: Rate; after: Rate };
  /** Cards per sentence passed, before and after. */
  cardsPerSentence: { before: number; after: number };
  /** Rated claims reaching a card, before and after the review. */
  rated: { before: Rate; after: Rate };
  /** All check-worthy claims reaching a card, before and after. */
  all: { before: Rate; after: Rate };
  /** Why claims were dropped, and how often. */
  droppedFor: Record<string, number>;
  /** Filter + breakdown + review keep at least 90% of rated claims. */
  pass: boolean;
}

export function scoreReview(sentences: FilterSentence[], results: Array<SentenceResult | null>): ReviewScore {
  const claims = new Map<string, { rated: boolean; before: boolean; after: boolean }>();
  sentences.forEach((s, i) => {
    const r = results[i];
    for (const c of s.claims) {
      const key = `${s.clip}#${c.i}`;
      const claim = claims.get(key) ?? { rated: c.rated, before: false, after: false };
      // A failed sentence still ends as a card (Unverified, "couldn't be checked").
      claim.before ||= !!r && (r.before > 0 || !!r.error);
      claim.after ||= !!r && (r.after > 0 || !!r.error);
      claims.set(key, claim);
    }
  });
  const all = [...claims.values()];
  const rated = all.filter((c) => c.rated);
  const through = results.filter((r): r is SentenceResult => r !== null);
  const cards = (pick: (r: SentenceResult) => number) => through.reduce((n, r) => n + (r.error ? 1 : pick(r)), 0);
  const droppedFor: Record<string, number> = {};
  for (const r of through) for (const why of r.dropped) droppedFor[why] = (droppedFor[why] ?? 0) + 1;
  const score = {
    sentences: sentences.length,
    passed: rate(through.length, sentences.length),
    withCards: {
      before: rate(through.filter((r) => r.before > 0 || r.error).length, sentences.length),
      after: rate(through.filter((r) => r.after > 0 || r.error).length, sentences.length),
    },
    cardsPerSentence: {
      before: through.length ? cards((r) => r.before) / through.length : 0,
      after: through.length ? cards((r) => r.after) / through.length : 0,
    },
    rated: { before: rate(rated.filter((c) => c.before).length, rated.length), after: rate(rated.filter((c) => c.after).length, rated.length) },
    all: { before: rate(all.filter((c) => c.before).length, all.length), after: rate(all.filter((c) => c.after).length, all.length) },
    droppedFor,
  };
  return { ...score, pass: score.rated.after.rate >= FILTER_BAR.rated - EPSILON };
}

export function formatReviewReport(title: string, score: ReviewScore): string {
  const row = (name: string, before: Rate, after: Rate) => `  ${name.padEnd(40)}${fraction(before).padEnd(24)}${fraction(after)}`;
  return [
    `Claim review: ${title}`,
    `${score.sentences} sentences; the claim filter passed ${fraction(score.passed)}`,
    '',
    `  ${''.padEnd(40)}${'before the review'.padEnd(24)}after`,
    row('Sentences ending as cards', score.withCards.before, score.withCards.after),
    `  ${'Cards per sentence passed'.padEnd(40)}${score.cardsPerSentence.before.toFixed(2).padEnd(24)}${score.cardsPerSentence.after.toFixed(2)}`,
    row('Rated claims reaching a card', score.rated.before, score.rated.after),
    row('All check-worthy claims reaching a card', score.all.before, score.all.after),
    '',
    `Dropped: ${Object.entries(score.droppedFor).sort((a, b) => b[1] - a[1]).map(([why, n]) => `${why} ${n}`).join(', ') || 'none'}`,
    '',
    `  ${score.pass ? 'PASS' : 'FAIL'}  Rated claims reaching a card (filter + breakdown + review) ≥ ${percent(FILTER_BAR.rated)}: ${fraction(score.rated.after)}`,
  ].join('\n');
}
