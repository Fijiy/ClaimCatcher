// `pnpm eval:review`: what the claim review (#46) does to the evaluation set.
//
// Takes the evaluation set's 281 reference sentences (eval/filter/sentences.json),
// keeps those the shipped claim filter passed in a recorded `pnpm eval:on-device`
// run (its per-sentence scores, at PASS_THRESHOLD), and runs the shipped claim
// breakdown, its code checks and the claim review on each (`findClaims`, the
// same function every sentence runs) on Gemini Nano in Google Chrome. Reports
// how many sentences end as cards, and how many rated claims reach a card,
// before and after the review (see review-score.ts), and writes the run to
// eval/results/.
//
//   pnpm eval:review                 on Gemini Nano (the profile pnpm eval:local uses)
//   pnpm eval:review --fake          prove the harness without Nano (scores mean nothing)
//   --filter-run <eval/results/on-device-….json>   which filter run to take (default: the newest)
//   --limit N   only the first N sentences the filter passed (a quick look)
//   --no-build  --chrome <path>  --profile <dir>
//
// Each sentence's page is its clip's title and channel as the site shows them
// (eval/review/pages.json), said on the clip's date; ~30 s of context is the
// clip's earlier sentences, up to 80 words. Exit code: 0 if rated claims reaching a
// card stay at or above the filter gate's 90%, 1 if not, 2 if it can't run.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'wxt';
import { PASS_THRESHOLD } from '../../src/models/claim-filter';
import { findClaims } from '../../src/session/checks/pipeline';
import type { JsonModel, JsonRequest } from '../../src/session/checks/provider';
import { skippedText } from '../../src/ui/card-text';
import type { PageContext } from '../../src/session/types';
import { CantRun, ensureNano, launchGateBrowser, openGatePage, remoteNanoModel } from './browser';
import { flag, option, ROOT, writeResults } from './cli';
import { loadFilterSentences, type FilterSentence } from './filter';
import { formatReviewReport, scoreReview, type SentenceResult } from './review-score';
import { homedir } from 'node:os';

const fake = flag('fake');

interface Clip {
  id: string;
  event: string;
  date: string;
  video: { uploader?: string };
}

/** The per-sentence filter scores of a recorded `pnpm eval:on-device` run. */
function filterScores(sentences: FilterSentence[]): { file: string; scores: number[] } {
  const dir = join(ROOT, 'eval', 'results');
  const chosen = option('filter-run');
  const files = chosen ? [chosen] : readdirSync(dir).filter((f) => f.startsWith('on-device-')).sort().reverse().map((f) => join(dir, f));
  for (const file of files) {
    const run = JSON.parse(readFileSync(file, 'utf8')) as { claimFilter?: { scores?: number[] } };
    const scores = run.claimFilter?.scores;
    if (scores?.length === sentences.length) return { file: file.replace(ROOT, ''), scores };
  }
  throw new CantRun('No recorded claim filter run with a score for every sentence: run pnpm eval:on-device --only filter first.');
}

/** A stand-in model for --fake: every sentence is one claim, and the review keeps every other one. */
let reviews = 0;
function fakeModel(): JsonModel {
  return {
    onDevice: true,
    async generate(request: JsonRequest) {
      if (request.name === 'claim_review') {
        return reviews++ % 2 === 0 ? { reason: 'A figure.', kind: 'checkable fact', unclear: null } : { reason: 'A view.', kind: 'opinion', unclear: null };
      }
      const sentence = /Sentence to check:\n"(.*)"/.exec(request.user)?.[1] ?? '';
      return {
        people_named: [],
        claims: [{ literal: sentence, unresolved: null, implied: '', premise_of: null, depends_on_speaker: false, speaker_words: null, speaker: null, queries: { fact: sentence, claim: sentence } }],
        skipped: [],
      };
    },
  };
}

/** About 30 s of what was said before sentence i: the clip's earlier sentences, up to 80 words (speech runs ~2.5 words a second). */
function contextOf(sentences: FilterSentence[], i: number): string {
  const before: string[] = [];
  let words = 0;
  for (let j = i - 1; j >= 0 && sentences[j]!.clip === sentences[i]!.clip; j--) {
    words += sentences[j]!.text.split(/\s+/).length;
    if (words > 80 && before.length > 0) break;
    before.unshift(sentences[j]!.text);
  }
  return before.join(' ');
}

async function main(): Promise<number> {
  const pages = (JSON.parse(readFileSync(join(ROOT, 'eval', 'review', 'pages.json'), 'utf8')) as { pages: Record<string, { title: string; channel?: string }> }).pages;
  const sentences = loadFilterSentences();
  const clips = new Map(
    (JSON.parse(readFileSync(join(ROOT, 'eval', 'clips.json'), 'utf8')) as Clip[]).map((c) => [c.id, c] as const),
  );
  const { file: filterRun, scores } = filterScores(sentences);
  const limit = Number(option('limit') ?? Infinity);
  let passedSoFar = 0;
  const todo = sentences.map((_, i) => scores[i]! >= PASS_THRESHOLD && passedSoFar++ < limit);

  let close = async () => {};
  let relaunch: (() => Promise<void>) | null = null;
  let model: () => Promise<JsonModel>;
  let environment: Record<string, string> = { platform: `${process.platform} ${process.arch}` };
  if (fake) {
    model = async () => fakeModel();
  } else {
    if (!flag('no-build')) {
      console.log('Building the extension with the gate page (wxt build --mode eval)…');
      await build({ mode: 'eval' });
    }
    const profile = option('profile') ?? process.env.CLAIMCATCHER_EVAL_PROFILE ?? join(homedir(), '.cache', 'claimcatcher', 'eval-chrome-profile');
    // Chrome sometimes goes away in a long run: open it again and carry on (`relaunch`).
    let page: Awaited<ReturnType<typeof openGatePage>>;
    const open = async () => {
      const context = await launchGateBrowser(profile, { chromePath: option('chrome') ?? process.env.CHROME_PATH });
      close = () => context.close().catch(() => {});
      page = await openGatePage(context);
      await ensureNano(page);
      environment = { ...environment, chrome: context.browser()?.version() ?? 'unknown', model: 'gemini-nano' };
    };
    await open();
    model = () => remoteNanoModel(page);
    relaunch = async () => {
      await close();
      await open();
    };
  }

  const started = new Date().toISOString();
  const results: Array<SentenceResult | null> = [];
  const detail: unknown[] = [];
  try {
    for (const [i, s] of sentences.entries()) {
      if (!todo[i]) {
        results.push(null);
        continue;
      }
      const clip = clips.get(s.clip);
      const shown = pages[s.clip];
      const page: PageContext = {
        title: shown?.title ?? clip?.event ?? s.clip,
        url: '',
        channel: shown?.channel ?? clip?.video.uploader?.replace(/\s*\(.*$/, '').trim(),
      };
      const context = contextOf(sentences, i);
      const t0 = Date.now();
      const find = async () =>
        findClaims(await model(), {
          sentence: { text: s.text, context },
          page,
          judgedAsOf: { date: clip?.date ?? started.slice(0, 10), basis: 'recording' },
        });
      try {
        let found: Awaited<ReturnType<typeof find>>;
        try {
          found = await find();
        } catch (error) {
          // The browser went away: open it again once and redo this sentence.
          if (!relaunch || !/has been closed|Target closed/i.test(error instanceof Error ? error.message : String(error))) throw error;
          console.log('  (Chrome closed; opening it again)');
          await relaunch();
          found = await find();
        }
        const result: SentenceResult = { before: found.found.length, after: found.claims.length, dropped: found.dropped.map((d) => skippedText(d).replace(/: .*/, '')) };
        results.push(result);
        detail.push({ i, clip: s.clip, text: s.text, claims: s.claims, ms: Date.now() - t0, found: found.found.map((c) => c.literal), kept: found.claims.map((c) => c.literal), dropped: found.dropped });
        console.log(`  ${String(i).padStart(3)}  ${((Date.now() - t0) / 1000).toFixed(1).padStart(5)} s  ${result.before} → ${result.after}${s.claims.some((c) => c.rated) ? '  (rated)' : ''}  ${s.text.slice(0, 70)}`);
      } catch (error) {
        if (error instanceof CantRun) throw error;
        const message = error instanceof Error ? error.message : String(error);
        // The browser went away: every later sentence would "fail" the same way.
        if (/has been closed|Target closed/i.test(message)) throw new CantRun(`The browser closed mid-run: ${message}`);
        results.push({ before: 0, after: 0, dropped: [], error: message });
        detail.push({ i, clip: s.clip, text: s.text, error: message });
        console.log(`  ${String(i).padStart(3)}  failed: ${message}`);
      }
    }
  } finally {
    await close();
  }

  const score = scoreReview(sentences, results);
  console.log(`\n${formatReviewReport(fake ? 'FAKE model: proves the harness only, the scores mean nothing' : `Gemini Nano, Chrome ${environment.chrome}`, score)}\n`);
  if (fake) return 0;
  const path = writeResults('review', started, { gate: 'review', started, environment, filterRun, threshold: PASS_THRESHOLD, limit: Number.isFinite(limit) ? limit : null, score, sentences: detail });
  console.log(`Recorded in ${path.slice(ROOT.length)}`);
  return score.pass ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`\n${error instanceof CantRun ? "The measurement can't run: " : ''}${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  },
);
