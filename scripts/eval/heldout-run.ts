// `pnpm eval:heldout`: the held-out accuracy run on Gemini Nano. Like
// `pnpm eval:local` (same build, Chrome profile, shipped Nano adapter and
// shipped `judgeClaim`), but over eval/heldout/claims.json with the evidence
// frozen by `pnpm eval:heldout-evidence`. Not a gate: it prints and records
// the accuracy report (scripts/eval/heldout-score.ts) for
// docs/quality-gate.md, "Held-out accuracy".
//
//   pnpm eval:heldout [--runs N] [--download] [--no-build] [--chrome <path>] [--profile <dir>]
//
// Writes eval/results/heldout-<time>.json. Exit code 0, or 2 if it can't run.

import { readFileSync } from 'node:fs';
import { cpus, homedir, release, totalmem } from 'node:os';
import { join } from 'node:path';
import { build } from 'wxt';
import { CantRun, ensureNano, launchGateBrowser, openGatePage, remoteNanoModel } from './browser';
import { flag, option, progress, ROOT, runsOption, writeResults } from './cli';
import { runGate } from './gate';
import { HELDOUT_DIR, heldoutCases, loadEvidencePacks, loadHeldoutClaims } from './heldout';
import { formatHeldout, scoreHeldout } from './heldout-score';

async function main(): Promise<number> {
  const runs = runsOption();
  const claims = loadHeldoutClaims();
  const cases = heldoutCases(claims, loadEvidencePacks());
  if (!flag('no-build')) {
    console.log('Building the extension with the gate page (wxt build --mode eval)…');
    await build({ mode: 'eval' });
  }
  const profile = option('profile') ?? process.env.CLAIMCATCHER_EVAL_PROFILE ?? join(homedir(), '.cache', 'claimcatcher', 'eval-chrome-profile');
  const context = await launchGateBrowser(profile, { chromePath: option('chrome') ?? process.env.CHROME_PATH });
  try {
    const page = await openGatePage(context);
    const chrome = context.browser()?.version() ?? 'unknown';
    await ensureNano(page, flag('download'));
    const started = new Date().toISOString();
    console.log(`\nRunning ${cases.length} held-out claims × ${runs} runs on Gemini Nano (Chrome ${chrome})…`);
    const results = await runGate(cases, () => remoteNanoModel(page), {
      runs,
      onVerdict: (run, index, judged) => {
        progress(cases, runs)(run, index, judged);
        void page.evaluate((text) => window.claimcatcherEval!.status(text), `Held-out run ${run + 1}/${runs}, claim ${index + 1}/${cases.length}`).catch(() => {});
      },
    });
    const score = scoreHeldout(cases, results);
    console.log(`\n${formatHeldout(`Gemini Nano, Chrome ${chrome}`, score)}`);
    const path = writeResults('heldout', started, {
      gate: 'heldout',
      started,
      environment: {
        chrome,
        userAgent: await page.evaluate(() => navigator.userAgent),
        platform: `${process.platform} ${process.arch}`,
        os: release(),
        cpu: cpus()[0]?.model ?? 'unknown',
        cores: String(cpus().length),
        memoryGb: String(Math.round(totalmem() / 2 ** 30)),
        node: process.version,
        note: 'Gemini Nano model version: see chrome://on-device-internals in this profile',
      },
      evidence: JSON.parse(readFileSync(join(HELDOUT_DIR, 'evidence-summary.json'), 'utf8')) as unknown,
      score,
      runs: results,
    });
    console.log(`Recorded in ${path.slice(ROOT.length)}`);
    return 0;
  } finally {
    await context.close();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`\n${error instanceof CantRun ? "The run can't go ahead: " : ''}${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  },
);
