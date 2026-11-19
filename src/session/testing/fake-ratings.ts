// A small stand-in for the bundled MBFC snapshot, so session tests can say
// exactly how each domain is rated. Same shape as the real one.

import type { MbfcBiasKey, MbfcEntry, MbfcReporting, RatingsSnapshot } from '../sources/ratings';

export function fakeRatings(
  entries: Record<string, [bias: MbfcBiasKey, reporting: MbfcReporting | null, page?: string | null]>,
  aliases: Record<string, string> = {},
): RatingsSnapshot {
  const ratings: Record<string, MbfcEntry> = {};
  for (const [domain, [b, r, page]] of Object.entries(entries)) {
    ratings[domain] = { b, r, u: page === undefined ? `https://mediabiasfactcheck.com/${domain.replace(/\W+/g, '-')}/` : page, n: domain };
  }
  return {
    source: { repo: 'test/ratings', commit: 'test', path: 'csources.json', url: 'https://ratings.test/csources.json' },
    snapshotDate: '2026-10-24',
    dataUpdated: '2022-01-23',
    aliases,
    ratings,
  };
}
