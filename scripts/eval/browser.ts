// Opening the quality gate's page (src/entrypoints/eval/, the eval build in
// .output/chrome-mv3-eval/) in a browser Playwright drives. Shared by the
// verdict gate (local.ts) and the on-device model gates (on-device.ts).

import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { join } from 'node:path';
// The bridge's types, and `window.claimcatcherEval` inside `page.evaluate` (which runs in the page).
import type { GenerateReply } from '../../src/entrypoints/eval/bridge';
import { LOCAL_MODEL_TEXT } from '../../src/local-model';
import { ProviderError, type JsonModel, type JsonRequest } from '../../src/session/checks/provider';
import { ROOT } from './cli';

/** The gate can't run here (no Gemini Nano, Chrome missing…): exit code 2. */
export class CantRun extends Error {}


export const EVAL_BUILD = join(ROOT, '.output', 'chrome-mv3-eval');

/**
 * Loads the eval build through the DevTools protocol (Google Chrome ignores
 * --load-extension; the browser needs --enable-unsafe-extension-debugging)
 * and opens the gate page, with `query` (such as `?fake`).
 */
export async function openGatePage(context: BrowserContext, query = ''): Promise<Page> {
  const cdp = await context.browser()!.newBrowserCDPSession();
  const { id } = (await cdp.send('Extensions.loadUnpacked' as never, { path: EVAL_BUILD } as never)) as { id: string };
  await cdp.detach();
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/eval.html${query}`);
  await page.waitForFunction(() => window.claimcatcherEval !== undefined);
  // Installing opened the first-run page; the gate doesn't need it.
  for (const other of context.pages()) if (other !== page && other.url().includes('/welcome.html')) await other.close();
  return page;
}

// Playwright's default Chrome switches that could keep Gemini Nano from
// loading or downloading (it comes as a Chrome component, fetched in the
// background), the sandbox switch, and the one that turns extensions off.
const KEEP_NANO_WORKING = [
  '--disable-extensions',
  '--disable-component-update',
  '--disable-background-networking',
  '--disable-field-trial-config',
  '--disable-default-apps',
  '--disable-sync',
  '--no-sandbox',
];
// Playwright also passes `--disable-features=…,OptimizationHints,…`; Chrome
// reads only the last `--disable-features`, so this one replaces it.
const NANO_ARGS = ['--disable-features=Translate'];

/** On a fresh profile Chrome takes a while to decide whether Gemini Nano can run here, and says `unavailable` meanwhile. */
const SETTLE_MS = 60_000;


/**
 * Opens the browser a gate drives, on `profile`: Google Chrome (or the one at
 * `chromePath`) with the switches Gemini Nano needs, or with `fake`, Chrome
 * for Testing (headless unless HEADED=1).
 */
export function launchGateBrowser(profile: string, { fake = false, chromePath, headless }: { fake?: boolean; chromePath?: string; headless?: boolean } = {}) {
  return chromium.launchPersistentContext(profile, {
    ...(fake ? { channel: 'chromium' } : chromePath ? { executablePath: chromePath } : { channel: 'chrome' }),
    headless: headless ?? (fake && process.env.HEADED !== '1'),
    // Lets the DevTools protocol load the unpacked build: Google Chrome ignores --load-extension.
    args: ['--enable-unsafe-extension-debugging', ...(fake ? [] : NANO_ARGS)],
    ignoreDefaultArgs: fake ? ['--disable-extensions'] : KEEP_NANO_WORKING,
    viewport: null,
  });
}

/** A fresh Gemini Nano model in the gate page (the shipped `createNanoModel`), driven from here. */
export async function remoteNanoModel(page: Page): Promise<JsonModel> {
  const handle = await page.evaluate(() => window.claimcatcherEval!.newModel());
  return {
    onDevice: true,
    async generate(request: JsonRequest) {
      const reply: GenerateReply = await page.evaluate(([h, r]) => window.claimcatcherEval!.generate(h, r), [handle, request] as const);
      if (reply.ok) return reply.value;
      // Chrome turns Gemini Nano off after it crashes 3 times: no point going on.
      const state = await page.evaluate(() => window.claimcatcherEval!.localModel());
      if (state.state !== 'available') throw new CantRun(`Gemini Nano stopped being available mid-run (${state.state}): ${reply.message}`);
      throw new ProviderError(reply.kind, reply.message, reply.source);
    },
  };
}

/** Waits until Gemini Nano is ready, downloading it if asked to; throws CantRun if it can't be. */
export async function ensureNano(page: Page, download = false): Promise<void> {
  const state = async () => (await page.evaluate(() => window.claimcatcherEval!.localModel())).state;
  let now = await state();
  for (const until = Date.now() + SETTLE_MS; now === 'unavailable' && Date.now() < until; ) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    now = await state();
  }
  if (now === 'not-chrome') throw new CantRun(`${LOCAL_MODEL_TEXT.notChrome} Run the gate in Google Chrome (--chrome <path> if it isn't where Playwright looks).`);
  if (now === 'unavailable') throw new CantRun(LOCAL_MODEL_TEXT.unavailable);
  if (now === 'downloadable' || now === 'downloading') {
    if (!download && now === 'downloadable') {
      throw new CantRun('Gemini Nano isn\'t on this Chrome profile yet. Rerun with --download to download it (several GB, once per profile).');
    }
    if (now === 'downloadable') await page.click('#download');
    console.log('Waiting for the Gemini Nano download…');
    for (;;) {
      const download = await page.evaluate(() => window.claimcatcherEval!.download());
      if (download === 'done') break;
      if (typeof download === 'object' && download !== null) throw new CantRun(`The Gemini Nano download failed: ${download.error}`);
      now = await state();
      if (now === 'available') break;
      if (typeof download === 'number') process.stdout.write(`\r  ${Math.round(download * 100)}%   `);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    console.log('\nGemini Nano is ready.');
  }
}
