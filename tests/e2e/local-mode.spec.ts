// Local mode on the first-run page / Privacy & data and in the panel: where
// it can be picked, its preselection, the Gemini Nano download, listening
// blocked until Nano is on the device, and consent again on a mode switch.
// Chrome for Testing has no Nano; see fake-chrome-nano.ts for how the
// first-run page is made to look like Google Chrome with one.

import type { Page, Worker } from '@playwright/test';
import { expect, test } from './extension';
import { fakeChromeNano, finishDownload, nanoCreates } from './fake-chrome-nano';
import { setApiKey, stubVenice } from './venice-stub';

const KEY = 'stub-venice-key-3f9a';
const LOCAL_SENDS = 'Audio and transcript stay on this device; the claims ClaimCatcher checks are sent to Venice to find sources.';
/** Local mode's preselected search (search.spec.ts covers the choice). */
const TINYFISH_SENDS =
  "Audio and transcript stay on this device; the claims ClaimCatcher checks are sent to TinyFish's search to find sources, " +
  "under TinyFish's privacy policy. TinyFish keeps a record of each search on your TinyFish account and makes no promise about how long it keeps search queries.";
const CLOUD_SENDS =
  "Audio and transcript stay on this device; the claims ClaimCatcher checks are sent to Venice's search to find sources, " +
  "and each claim, with about 30 seconds of what was said before it and the page's title and channel, is sent to Venice to be judged.";

const storedConsent = (serviceWorker: Worker) =>
  serviceWorker.evaluate(async () => ((await chrome.storage.local.get('consent')).consent as { mode: string } | undefined)?.mode ?? null);

const offscreenDocuments = (serviceWorker: Worker) =>
  serviceWorker.evaluate(
    async () => (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType] })).length,
  );

async function openVideo(page: Page, fixtures: string) {
  await page.goto(`${fixtures}/video-track.html`);
}

test("outside Google Chrome, local mode can't be picked, cloud mode is preselected, and the page says why", async ({
  firstRunPage,
  serviceWorker,
}) => {
  const local = firstRunPage.getByRole('radio', { name: 'Local mode' });
  const cloud = firstRunPage.getByRole('radio', { name: 'Cloud mode' });
  await expect(cloud).toBeChecked();
  await expect(local).toBeDisabled();
  await expect(local).not.toBeChecked();
  await expect(firstRunPage.getByText("Local mode needs Google Chrome's built-in model.")).toBeVisible();
  await expect(firstRunPage.getByText(CLOUD_SENDS)).toBeVisible();
  await expect(firstRunPage.getByRole('button', { name: 'Download Gemini Nano' })).toHaveCount(0);

  await firstRunPage.getByRole('button', { name: 'I agree' }).click();
  await expect(firstRunPage.getByRole('heading', { level: 1 })).toHaveText('Privacy & data');
  expect(await storedConsent(serviceWorker)).toBe('cloud');
  // Privacy & data shows the mode, and still won't switch to local mode here.
  const mode = firstRunPage.getByRole('region', { name: 'Mode' });
  await expect(mode).toContainText('Cloud mode.');
  await expect(mode.getByRole('button', { name: 'Switch to local mode' })).toBeDisabled();
  await expect(mode.getByText("Local mode needs Google Chrome's built-in model.")).toBeVisible();
});

test.describe('in Google Chrome on a device that can’t run Gemini Nano', () => {
  test('local mode is unavailable, with the reason', async ({ context, firstRunPage }) => {
    await fakeChromeNano(context, 'unavailable');
    await firstRunPage.reload();

    await expect(firstRunPage.getByRole('radio', { name: 'Cloud mode' })).toBeChecked();
    await expect(firstRunPage.getByRole('radio', { name: 'Local mode' })).toBeDisabled();
    await expect(firstRunPage.getByText("Local mode isn't available on this device", { exact: false })).toBeVisible();
    await expect(firstRunPage.getByText('at least 22 GB of free disk space', { exact: false })).toBeVisible();
  });
});

test.describe('in Google Chrome that can download Gemini Nano', () => {
  test('the first-run page preselects local mode, and the download starts from a click and shows progress', async ({
    context,
    firstRunPage,
    serviceWorker,
  }) => {
    await fakeChromeNano(context, 'downloadable');
    await firstRunPage.reload();

    await expect(firstRunPage.getByRole('radio', { name: 'Local mode' })).toBeChecked();
    await expect(firstRunPage.getByText(TINYFISH_SENDS)).toBeVisible();
    await expect(firstRunPage.getByText('judged on this device by Gemini Nano, the model built into Google Chrome', { exact: false })).toBeVisible();
    await expect(firstRunPage.getByText('It comes from Chrome itself, not from ClaimCatcher.', { exact: false })).toBeVisible();
    // Nothing downloads until the viewer clicks.
    expect(await nanoCreates(firstRunPage)).toEqual([]);

    await firstRunPage.getByRole('button', { name: 'Download Gemini Nano' }).click();
    await expect(firstRunPage.getByText('Downloading Gemini Nano: 50%')).toBeVisible();
    await expect(firstRunPage.getByRole('progressbar')).toHaveAttribute('value', '0.5');
    expect(await nanoCreates(firstRunPage)).toEqual([{ activated: true, temperature: 0.1, topK: 1 }]);

    await finishDownload(firstRunPage);
    await expect(firstRunPage.getByRole('status').filter({ hasText: 'Gemini Nano is ready on this device.' })).toBeVisible();

    await firstRunPage.getByRole('button', { name: 'I agree' }).click();
    await expect(firstRunPage.getByRole('heading', { level: 1 })).toHaveText('Privacy & data');
    expect(await storedConsent(serviceWorker)).toBe('local');
    await expect(firstRunPage.getByRole('region', { name: 'Mode' })).toContainText('Local mode.');
    // Local mode searching at TinyFish needs TinyFish's free key, not Venice's.
    await expect(firstRunPage.getByRole('textbox', { name: 'TinyFish API key' })).toBeVisible();
    await expect(firstRunPage.getByRole('textbox', { name: 'Venice API key' })).toHaveCount(0);
  });
});

test('in local mode, listening is blocked while Gemini Nano is not on the device, and nothing is sent', async ({
  context,
  fixtures,
  serviceWorker,
  clickAction,
  sidePanel,
}) => {
  await serviceWorker.evaluate(
    (k) => chrome.storage.local.set({ apiKey: k, consent: { mode: 'local', provider: 'venice', givenAt: Date.now() } }),
    KEY,
  );
  const venice = await stubVenice(context);
  const video = await context.newPage();
  await openVideo(video, fixtures);
  await clickAction(video);
  const panel = await sidePanel();

  // Chrome for Testing has no Gemini Nano: the panel says so, and never falls back to cloud mode.
  await expect(panel.getByText("Local mode needs Google Chrome's built-in model.")).toBeVisible();
  await expect(panel.getByText('To listen here, switch to cloud mode in Privacy & data.')).toBeVisible();
  await expect(panel.getByRole('status')).toHaveText('Not listening');
  await expect.poll(() => offscreenDocuments(serviceWorker)).toBe(0);
  await expect(video.locator('video')).toBeVisible();
  expect(venice.requests).toEqual([]);
});

test('switching mode shows the consent page again before anything goes to the new destination', async ({
  context,
  fixtures,
  extensionId,
  serviceWorker,
  clickAction,
  sidePanel,
}) => {
  await setApiKey(serviceWorker, KEY); // cloud mode
  const venice = await stubVenice(context);
  await fakeChromeNano(context, 'available');
  const video = await context.newPage();
  await openVideo(video, fixtures);
  await clickAction(video);
  const panel = await sidePanel();
  await expect(panel.getByRole('status')).toHaveText('Listening');

  // Cloud → local: the consent page for local mode, and nothing changes until the viewer agrees.
  const privacy = await context.newPage();
  await privacy.goto(`chrome-extension://${extensionId}/welcome.html`);
  await privacy.getByRole('region', { name: 'Mode' }).getByRole('button', { name: 'Switch to local mode' }).click();
  await expect(privacy.getByRole('heading', { level: 1 })).toHaveText('Before ClaimCatcher switches to local mode');
  for (const heading of ['What it hears', 'What it sends, and to whom', 'What it keeps', 'What it never does']) {
    await expect(privacy.getByRole('heading', { name: heading })).toBeVisible();
  }
  // Local mode searching at Venice, with the key already set.
  await privacy.getByRole('radio', { name: 'Venice' }).check();
  await expect(privacy.getByText(LOCAL_SENDS)).toBeVisible();
  await expect(privacy.getByText(CLOUD_SENDS)).toHaveCount(0);
  expect(await storedConsent(serviceWorker)).toBe('cloud');
  await expect(panel.getByRole('status')).toHaveText('Listening');

  // "Keep cloud mode" backs out; agreeing switches, and the cloud session stops.
  await privacy.getByRole('button', { name: 'Keep cloud mode' }).click();
  await expect(privacy.getByRole('heading', { level: 1 })).toHaveText('Privacy & data');
  expect(await storedConsent(serviceWorker)).toBe('cloud');
  await privacy.getByRole('button', { name: 'Switch to local mode' }).click();
  await privacy.getByRole('radio', { name: 'Venice' }).check();
  await privacy.getByRole('button', { name: 'I agree' }).click();
  await expect(privacy.getByRole('heading', { level: 1 })).toHaveText('Privacy & data');
  await expect(privacy.getByRole('region', { name: 'Mode' })).toContainText('Local mode.');
  expect(await storedConsent(serviceWorker)).toBe('local');
  await expect(panel.getByRole('status')).toHaveText('Stopped');
  await expect(panel.getByRole('alert')).toContainText('you switched mode');

  // Local → cloud: the consent page again. Until the viewer agrees, the icon starts nothing and nothing goes to Venice's model.
  await privacy.getByRole('button', { name: 'Switch to cloud mode' }).click();
  await expect(privacy.getByRole('heading', { level: 1 })).toHaveText('Before ClaimCatcher switches to cloud mode');
  await expect(privacy.getByText(CLOUD_SENDS)).toBeVisible();
  const sentBefore = venice.requests.length;
  await video.bringToFront();
  await clickAction(video);
  await expect(panel.getByText('To listen here, switch to cloud mode in Privacy & data.')).toBeVisible();
  await expect(panel.getByRole('status')).toHaveText('Stopped');
  expect(venice.requests.slice(sentBefore)).toEqual([]);

  await privacy.bringToFront();
  await privacy.getByRole('button', { name: 'I agree' }).click();
  expect(await storedConsent(serviceWorker)).toBe('cloud');
  await video.bringToFront();
  await clickAction(video);
  await expect(panel.getByRole('status')).toHaveText('Listening');
});
