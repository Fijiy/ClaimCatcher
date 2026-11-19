// `pnpm eval:search`: compares local mode's searches (ticket #45) on the
// evaluation set's 29 rated claims. Each search that can run here runs every
// claim's two queries through the shipped adapter, then the shipped pipeline
// after search (classification, balancing search, top 5); see
// search-compare.ts for what is measured. With --verdicts and Gemini Nano on
// this Chrome profile, the verdict gate also runs on each search's evidence
// (and on the frozen evidence, for reference).
//
//   pnpm eval:search                         every search that has a key or needs none
//   pnpm eval:search --only tinyfish
//   pnpm eval:search --verdicts [--runs N] [--download]
//   --venice-key-file <path>  --tinyfish-key-file <path>  (or VENICE_API_KEY / TINYFISH_API_KEY)
//   --pause-ms N (between claims, default 1000)  --no-build  --chrome <path>  --profile <dir>
//
// Venice and TinyFish are called from Node with the keys given (each key only
// to its own service, never printed or written down). Chrome is started only
// for --verdicts. Writes the run to eval/results/search-<time>.json. Exit
// code 0, or 2 if it can't run.
// See docs/quality-gate.md.

import type { BrowserContext, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { cpus, homedir, totalmem } from 'node:os';
import { join } from 'node:path';
import { build } from 'wxt';
import type { SearchProvider } from '../../src/session/checks/provider';
import { createTinyFishSearch } from '../../src/session/checks/tinyfish';
import { createVenice } from '../../src/session/checks/venice';
import type { SearchId } from '../../src/session/types';
import { CantRun, ensureNano, launchGateBrowser, openGatePage, remoteNanoModel } from './browser';
import { flag, option, progress, ROOT, runsOption, writeResults } from './cli';
import { bundledRatingsFromDisk, loadSearchCases, loadVerdictCases } from './eval-set';
import { runGate } from './gate';
import { formatReport, scoreGate } from './score';
import { compareSearch, formatComparison, summarize, withEvidence, type ClaimRun, type SearchSummary } from './search-compare';

const ALL: SearchId[] = ['venice', 'tinyfish'];

function readKey(envName: string, fileOption: string): string {
  const file = option(fileOption) ?? process.env[`${envName}_FILE`];
  const raw = file ? readFileSync(file.replace(/^~(?=\/)/, homedir()), 'utf8') : process.env[envName];
  return (raw ?? '').trim().replace(/^Bearer\s+/i, '').replace(/^["']|["']$/g, '');
}

async function main(): Promise<number> {
  const only = option('only')?.split(',').map((s) => s.trim()) as SearchId[] | undefined;
  const wanted = ALL.filter((s) => !only || only.includes(s));
  const verdicts = flag('verdicts');
  const runs = verdicts ? runsOption() : 0;
  const pauseMs = Number(option('pause-ms') ?? 1000);
  const ratings = bundledRatingsFromDisk();
  const cases = loadSearchCases(ratings);
  const keys = { venice: readKey('VENICE_API_KEY', 'venice-key-file'), tinyfish: readKey('TINYFISH_API_KEY', 'tinyfish-key-file') };
  const skipped: Partial<Record<SearchId, string>> = {};
  if (wanted.includes('venice') && !keys.venice) skipped.venice = 'no Venice key (VENICE_API_KEY or --venice-key-file)';
  if (wanted.includes('tinyfish') && !keys.tinyfish) skipped.tinyfish = 'no TinyFish key (TINYFISH_API_KEY or --tinyfish-key-file)';
  const searches = wanted.filter((s) => !skipped[s]);
  for (const [search, why] of Object.entries(skipped)) console.log(`Skipping ${search}: ${why}.`);
  if (searches.length === 0) throw new CantRun('no search can run');

  let context: BrowserContext | undefined;
  let page: Page | undefined;
  if (verdicts) {
    if (!flag('no-build')) {
      console.log('Building the extension with the gate page (wxt build --mode eval)…');
      await build({ mode: 'eval' });
    }
    const profile = option('profile') ?? process.env.CLAIMCATCHER_EVAL_PROFILE ?? join(homedir(), '.cache', 'claimcatcher', 'eval-chrome-profile');
    context = await launchGateBrowser(profile, { chromePath: option('chrome') ?? process.env.CHROME_PATH });
    page = await openGatePage(context);
  }
  const started = new Date().toISOString();
  try {
    const providers: Record<SearchId, () => SearchProvider> = {
      venice: () => createVenice((i, init) => fetch(i, init), keys.venice).search,
      tinyfish: () => createTinyFishSearch((i, init) => fetch(i, init), keys.tinyfish),
    };
    const results: Partial<Record<SearchId, { summary: SearchSummary; runs: ClaimRun[] }>> = {};
    for (const search of searches) {
      console.log(`\n${search}: ${cases.length} claims…`);
      const claimRuns = await compareSearch(cases, providers[search](), {
        ratings,
        pauseMs,
        onClaim: (i, run) => {
          const failed = run.requests.filter((r) => r.error).length;
          console.log(
            `  ${String(i + 1).padStart(2)}/${cases.length}  ${run.returned} results, top ${run.evidence.length}${run.balanced ? ', balanced' : ''}${failed ? `, ${failed} failed` : ''}  [${run.id}]`,
          );
        },
      });
      results[search] = { summary: summarize(search, claimRuns), runs: claimRuns };
    }
    const summaries = Object.values(results).map((r) => r.summary);
    console.log(`\n${formatComparison(summaries)}\n`);

    const gate: Record<string, unknown> = {};
    if (verdicts && page) {
      await ensureNano(page, flag('download'));
      const gateCases = loadVerdictCases(ratings);
      const evidenceSets: Array<[string, typeof gateCases]> = [
        ['frozen', gateCases],
        ...Object.entries(results).map(([search, r]): [string, typeof gateCases] => [search, withEvidence(gateCases, r.runs)]),
      ];
      for (const [name, withSearch] of evidenceSets) {
        console.log(`\nVerdict gate on ${name} evidence (Gemini Nano, ${runs} runs)…`);
        const judged = await runGate(withSearch, () => remoteNanoModel(page!), { runs, onVerdict: progress(withSearch, runs, `${name} `) });
        const score = scoreGate(withSearch, judged);
        console.log(`\n${formatReport(`Gemini Nano on ${name} evidence`, withSearch, score)}`);
        gate[name] = { score, runs: judged };
      }
    }

    const path = writeResults('search', started, {
      gate: 'search',
      started,
      environment: {
        platform: `${process.platform} ${process.arch}`,
        cpu: cpus()[0]?.model ?? 'unknown',
        memoryGb: String(Math.round(totalmem() / 2 ** 30)),
        node: process.version,
        chrome: context?.browser()?.version() ?? 'not used',
        pauseMsBetweenClaims: String(pauseMs),
      },
      skipped,
      searches: Object.fromEntries(
        Object.entries(results).map(([search, r]) => [
          search,
          {
            summary: r.summary,
            claims: r.runs.map((run) => ({ ...run, evidence: run.evidence.map(({ domain, url, rating, weight, published }) => ({ domain, url, rating: rating.kind === 'mbfc' ? rating.bias : rating.kind, weight, published })) })),
          },
        ]),
      ),
      ...(verdicts ? { verdicts: gate } : {}),
    });
    console.log(`Recorded in ${path.slice(ROOT.length)}`);
    return 0;
  } finally {
    await context?.close();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`\n${error instanceof CantRun ? "The comparison can't run: " : ''}${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  },
);
