// `pnpm eval:heldout-report <eval/results/heldout-….json>`: re-scores a
// recorded held-out run, for docs/quality-gate.md. Prints the whole set's
// report (as `pnpm eval:heldout` did) and, as an exploratory split (not the
// headline), the same report over claims whose frozen evidence has at least
// one source, and over claims with three or more.

import { readFileSync } from 'node:fs';
import { heldoutCases, loadEvidencePacks, loadHeldoutClaims } from './heldout';
import { formatHeldout, scoreHeldout } from './heldout-score';
import type { Judged } from './score';

const file = process.argv[2];
if (!file) {
  console.error('Give the recorded run: pnpm eval:heldout-report eval/results/heldout-<time>.json');
  process.exit(2);
}
const record = JSON.parse(readFileSync(file, 'utf8')) as { environment: { chrome: string }; runs: Judged[][] };
const packs = loadEvidencePacks();
const cases = heldoutCases(loadHeldoutClaims(), packs);
const sources = (id: string) => packs.get(id)?.evidence.length ?? 0;

const report = (title: string, keep: (id: string) => boolean) => {
  const subset = cases.filter((c) => keep(c.id));
  const runs = record.runs.map((run) => run.filter((v) => keep(v.caseId)));
  return formatHeldout(`${title} (${subset.length} claims)`, scoreHeldout(subset, runs));
};

console.log(report(`Gemini Nano, Chrome ${record.environment.chrome}: every claim`, () => true));
console.log(report('Exploratory: claims with at least one source', (id) => sources(id) >= 1));
console.log(report('Exploratory: claims with three or more sources', (id) => sources(id) >= 3));
