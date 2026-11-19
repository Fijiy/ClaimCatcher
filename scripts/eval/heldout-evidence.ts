// `pnpm eval:heldout-evidence`: freezes the held-out set's evidence. Each
// claim's two searches go through the shipped TinyFish adapter (with the
// pipeline's one retry), leaks are dropped (professional fact-checkers on
// the product's list, pages calling themselves fact-checks, results dated
// after the day said), the shipped balancing search runs when the top 5 lean
// one way, and the shipped selection's top 5 is written to
// eval/heldout/evidence/<id>.json with every result and why any was dropped.
// The verdict runs (`pnpm eval:heldout`) read only these files.
//
//   pnpm eval:heldout-evidence --tinyfish-key-file ~/.tinyfish-key
//   --pause-ms N (between claims, default 6000: TinyFish allows 30 a minute, 500 an hour)
//   --force (search again for claims already frozen)  --retry-failed (again for those a search failed on)
//   --refilter (apply the current leak rules to the frozen searches; only balancing searches go out)
//   --only <id,…>
//
// The key (TINYFISH_API_KEY, or the file named by --tinyfish-key-file or
// TINYFISH_API_KEY_FILE) goes only to TinyFish and is never printed or
// written down. Exit code 0, 1 if a claim's search failed, 2 if it can't run.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createTinyFishSearch } from '../../src/session/checks/tinyfish';
import { flag, option } from './cli';
import { bundledRatingsFromDisk } from './eval-set';
import { DROP_REASONS, evidencePath, freezeEvidence, HELDOUT_DIR, loadEvidencePacks, loadHeldoutClaims, type EvidencePack } from './heldout';

function readKey(): string {
  const file = option('tinyfish-key-file') ?? process.env.TINYFISH_API_KEY_FILE;
  const raw = file ? readFileSync(file.replace(/^~(?=\/)/, homedir()), 'utf8') : process.env.TINYFISH_API_KEY;
  return (raw ?? '').trim();
}

async function main(): Promise<number> {
  const key = readKey();
  if (!key) {
    console.error('No TinyFish key: set TINYFISH_API_KEY or pass --tinyfish-key-file <path>.');
    return 2;
  }
  const pauseMs = Number(option('pause-ms') ?? 6000);
  const only = option('only')?.split(',');
  const ratings = bundledRatingsFromDisk();
  const claims = loadHeldoutClaims().filter((c) => !only || only.includes(c.id));
  const search = createTinyFishSearch((i, init) => fetch(i, init), key);
  mkdirSync(join(HELDOUT_DIR, 'evidence'), { recursive: true });

  const refilter = flag('refilter');
  const todo = claims.filter((c) => {
    const path = evidencePath(c.id);
    if (refilter) return existsSync(path);
    if (flag('force') || !existsSync(path)) return true;
    return flag('retry-failed') && (JSON.parse(readFileSync(path, 'utf8')) as EvidencePack).failed;
  });
  console.log(`${refilter ? 'Re-filtering' : 'Freezing'} evidence for ${todo.length} of ${claims.length} claims (TinyFish, ${pauseMs} ms between claims)…`);
  for (const [i, c] of todo.entries()) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, refilter ? Math.min(pauseMs, 2500) : pauseMs));
    const earlier = refilter ? (JSON.parse(readFileSync(evidencePath(c.id), 'utf8')) as EvidencePack & { frozenAt: string }) : undefined;
    const pack = await freezeEvidence(c, search, ratings, { earlier });
    mkdirSync(dirname(evidencePath(c.id)), { recursive: true });
    const stamp = earlier ? { frozenAt: earlier.frozenAt, refilteredAt: new Date().toISOString() } : { frozenAt: new Date().toISOString() };
    writeFileSync(evidencePath(c.id), `${JSON.stringify({ ...stamp, ...pack }, null, 2)}\n`);
    const drops = DROP_REASONS.filter((r) => pack.dropped[r]).map((r) => `${pack.dropped[r]} ${r}`).join(', ');
    console.log(
      `  ${String(i + 1).padStart(3)}/${todo.length}  ${pack.returned} results, ${drops || 'none dropped'}; top ${pack.evidence.length}${pack.balanced ? ', balanced' : ''}${pack.failed ? ', A SEARCH FAILED' : ''}  [${c.id}]`,
    );
  }

  // The summary over every frozen claim (also those frozen on an earlier run).
  const packs = [...loadEvidencePacks().values()].filter((p) => claims.some((c) => c.id === p.id));
  const sum = (pick: (p: EvidencePack) => number) => packs.reduce((n, p) => n + pick(p), 0);
  const summary = {
    claims: packs.length,
    requests: sum((p) => p.requests.length),
    failedRequests: sum((p) => p.requests.filter((r) => r.error).length),
    claimsWithAFailedSearch: packs.filter((p) => p.failed).length,
    returned: sum((p) => p.returned),
    dropped: Object.fromEntries(DROP_REASONS.map((r) => [r, sum((p) => p.dropped[r])])),
    keptDatedOnlyByLink: sum((p) => p.linkDatedKept),
    balancingSearches: packs.filter((p) => p.balanced).length,
    evidenceGiven: sum((p) => p.evidence.length),
    claimsWithFive: packs.filter((p) => p.evidence.length === 5).length,
    claimsWithNone: packs.filter((p) => p.evidence.length === 0).length,
  };
  writeFileSync(join(HELDOUT_DIR, 'evidence-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`\n${JSON.stringify(summary, null, 2)}`);
  return summary.claimsWithAFailedSearch > 0 ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`\nThe freeze can't run: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  },
);
