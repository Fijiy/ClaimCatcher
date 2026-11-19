// `pnpm eval:local`: the local-mode verdict gate on Gemini Nano.
//
// Builds the extension with the gate's page (`wxt build --mode eval`), opens
// Google Chrome on a profile kept for the gate, loads the build, and runs the
// shipped verdict step over the evaluation set's rated claims with frozen
// evidence: the prompt, parsing, retry and consistency rule here, from the
// shipped code, and the shipped Nano adapter in the page. Prints each bar
// with PASS or FAIL and writes the run to eval/results/.
//
//   pnpm eval:local                  run the gate (2 runs over 29 claims)
//   pnpm eval:local --download       also start the Gemini Nano download if Chrome
//                                    offers it (several GB; once per profile)
//   pnpm eval:local --fake           prove the harness without Gemini Nano: Chrome for
//                                    Testing and the fake LanguageModel (scores mean nothing)
//   --runs N  --no-build  --chrome <path to Chrome>  --profile <dir>
//
// Exit code: 0 if the gate passes (or --fake), 1 if it fails, 2 if it can't run.
// See docs/quality-gate.md.

import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'wxt';
import { CantRun, ensureNano, launchGateBrowser, openGatePage, remoteNanoModel } from './browser';
import { flag, option, progress, ROOT, runsOption, writeRecord } from './cli';
import { loadVerdictCases } from './eval-set';
import { runGate } from './gate';
import { formatReport, scoreGate } from './score';

const fake = flag('fake');

async function main(): Promise<number> {
  const runs = runsOption();
  const cases = loadVerdictCases();
  if (!flag('no-build')) {
    console.log('Building the extension with the gate page (wxt build --mode eval)…');
    await build({ mode: 'eval' });
  }

  const profile = fake ? mkdtempSync(join(tmpdir(), 'claimcatcher-eval-')) : (option('profile') ?? process.env.CLAIMCATCHER_EVAL_PROFILE ?? join(homedir(), '.cache', 'claimcatcher', 'eval-chrome-profile'));
  const chromePath = option('chrome') ?? process.env.CHROME_PATH;
  const context = await launchGateBrowser(profile, { fake, chromePath });
  try {
    const page = await openGatePage(context, fake ? '?fake' : '');
    const browserVersion = context.browser()?.version() ?? 'unknown';

    await ensureNano(page, flag('download'));
    const started = new Date().toISOString();
    console.log(`\nRunning ${cases.length} claims × ${runs} runs on Gemini Nano (Chrome ${browserVersion})${fake ? ' [FAKE model]' : ''}…`);

    const remoteModel = () => remoteNanoModel(page);

    const results = await runGate(cases, remoteModel, {
      runs,
      onVerdict: (run, index, judged) => {
        progress(cases, runs)(run, index, judged);
        void page.evaluate((text) => window.claimcatcherEval!.status(text), `Run ${run + 1}/${runs}, claim ${index + 1}/${cases.length}`).catch(() => {});
      },
    });
    const score = scoreGate(cases, results);
    const title = `Gemini Nano, Chrome ${browserVersion}${fake ? ' — FAKE model: proves the harness only, the scores mean nothing' : ''}`;
    console.log(`\n${formatReport(title, cases, score)}\n`);
    if (fake) return 0;
    const path = writeRecord({
      gate: 'verdicts',
      variant: 'local',
      started,
      environment: {
        chrome: browserVersion,
        userAgent: await page.evaluate(() => navigator.userAgent),
        platform: `${process.platform} ${process.arch}`,
        note: 'Gemini Nano model version: see chrome://on-device-internals in this profile',
      },
      models: [{ model: 'gemini-nano', score: { ...score, runs: score.runs }, runs: results }],
    });
    console.log(`Recorded in ${path.slice(ROOT.length)}`);
    return score.pass ? 0 : 1;
  } finally {
    await context.close();
    if (fake) rmSync(profile, { recursive: true, force: true });
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`\n${error instanceof CantRun ? 'The gate can\'t run: ' : ''}${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  },
);
