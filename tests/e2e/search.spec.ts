// Local mode's search on the first-run page / Privacy & data and in the panel
// (ticket #45): the choice of TinyFish or Venice, each saying where the
// claims go and under whose policy; TinyFish's key handled like Venice's; no
// permission asked for either; consent again before a new search (and for a
// search ClaimCatcher no longer offers: DuckDuckGo). Chrome for Testing
// has no Gemini Nano, so the first-run page is made to look like Google
// Chrome with it (fake-chrome-nano.ts); local mode's checks themselves are
// covered by the session tests (src/session/search.test.ts).

import type { Page, Worker } from '@playwright/test';
import { expect, test } from './extension';
import { fakeChromeNano } from './fake-chrome-nano';
import { stubSearch } from './search-stub';
import { stubVenice } from './venice-stub';

const TINYFISH_KEY = 'stub-tinyfish-key-7c2e';
const TINYFISH_SENDS =
  "Audio and transcript stay on this device; the claims ClaimCatcher checks are sent to TinyFish's search to find sources, " +
  "under TinyFish's privacy policy. TinyFish keeps a record of each search on your TinyFish account and makes no promise about how long it keeps search queries.";
const VENICE_SENDS = 'the claims ClaimCatcher checks are sent to Venice to find sources.';

const stored = (serviceWorker: Worker) =>
  serviceWorker.evaluate(async () => {
    const { consent, tinyfishKey, apiKey } = await chrome.storage.local.get(['consent', 'tinyfishKey', 'apiKey']);
    const c = consent as { mode: string; search?: string } | undefined;
    return { mode: c?.mode ?? null, search: c?.search ?? null, tinyfishKey: tinyfishKey ?? null, apiKey: apiKey ?? null };
  });

const consentTo = (serviceWorker: Worker, search: string) =>
  serviceWorker.evaluate(
    (s) => chrome.storage.local.set({ consent: { mode: 'local', provider: 'venice', search: s, givenAt: Date.now() } }),
    search,
  );

/** Records the page's permission requests and answers `grant`, as the viewer's answer to Chrome's dialog would. */
async function recordPermissionRequests(page: Page, grant: boolean) {
  await page.evaluate((answer) => {
    const requests: unknown[] = [];
    (window as unknown as { permissionRequests: unknown[] }).permissionRequests = requests;
    for (const ns of [globalThis.chrome, (globalThis as unknown as { browser?: typeof chrome }).browser]) {
      if (!ns?.permissions) continue;
      ns.permissions.request = (async (permissions: chrome.permissions.Permissions) => {
        requests.push(permissions);
        return answer;
      }) as typeof chrome.permissions.request;
    }
  }, grant);
  return () => page.evaluate(() => (window as unknown as { permissionRequests: unknown[] }).permissionRequests);
}

test('local mode offers TinyFish (preselected) and Venice, each saying where the claims go and under whose policy', async ({
  context,
  firstRunPage,
}) => {
  await fakeChromeNano(context, 'available');
  await firstRunPage.reload();

  await expect(firstRunPage.getByRole('radio', { name: 'Local mode' })).toBeChecked();
  const searches = firstRunPage.getByRole('group', { name: 'Where local mode searches' });
  await expect(searches.getByRole('radio')).toHaveCount(2);
  await expect(searches.getByRole('radio', { name: 'TinyFish' })).toBeChecked();
  await expect(firstRunPage.getByText(TINYFISH_SENDS)).toBeVisible();
  await expect(firstRunPage.getByRole('link', { name: "TinyFish's privacy policy" })).toHaveAttribute('href', 'https://www.tinyfish.ai/privacy-policy');
  await expect(searches.getByText('Free, with a free TinyFish API key', { exact: false })).toBeVisible();
  await expect(firstRunPage.getByText('Nothing. Gemini Nano runs on this device', { exact: false })).toBeVisible();

  await searches.getByRole('radio', { name: 'Venice' }).check();
  await expect(firstRunPage.getByText(VENICE_SENDS, { exact: false })).toBeVisible();
  await expect(firstRunPage.getByText(TINYFISH_SENDS)).toHaveCount(0);
  await expect(firstRunPage.getByText('about $1–2 per hour of video', { exact: false })).toBeVisible();
});

test('local mode with TinyFish needs no Venice key: the TinyFish key is checked with TinyFish only, masked, and can be forgotten', async ({
  context,
  firstRunPage,
  serviceWorker,
}) => {
  await fakeChromeNano(context, 'available');
  const venice = await stubVenice(context);
  const search = await stubSearch(context, { tinyfishKeyCheck: (key) => (key === TINYFISH_KEY ? 200 : 401) });
  await firstRunPage.reload();

  await firstRunPage.getByRole('button', { name: 'I agree' }).click();
  await expect(firstRunPage.getByRole('heading', { level: 1 })).toHaveText('Privacy & data');
  expect(await stored(serviceWorker)).toMatchObject({ mode: 'local', search: 'tinyfish' });
  await expect(firstRunPage.getByRole('region', { name: 'Search' })).toContainText('TinyFish.');
  await expect(firstRunPage.getByRole('textbox', { name: 'Venice API key' })).toHaveCount(0);

  // A key TinyFish refuses isn't saved.
  const keyBox = firstRunPage.getByRole('textbox', { name: 'TinyFish API key' });
  await keyBox.fill('not-a-tinyfish-key');
  await firstRunPage.getByRole('button', { name: 'Check and save key' }).click();
  await expect(firstRunPage.getByRole('status').filter({ hasText: "TinyFish didn't accept this key." })).toBeVisible();
  expect((await stored(serviceWorker)).tinyfishKey).toBeNull();

  await keyBox.fill(` "${TINYFISH_KEY}" `);
  await firstRunPage.getByRole('button', { name: 'Check and save key' }).click();
  await expect(firstRunPage.getByRole('status').filter({ hasText: 'The key works.' })).toHaveText(
    "The key works. TinyFish's search is free, up to 500 searches an hour.",
  );
  await expect(firstRunPage.getByTestId('masked-tinyfish-key')).toHaveText('••••7c2e');
  await expect(firstRunPage.getByText(TINYFISH_KEY)).toHaveCount(0);
  expect(await stored(serviceWorker)).toMatchObject({ tinyfishKey: TINYFISH_KEY, apiKey: null });
  // The checks went to TinyFish's free usage list with the key in its header, and nothing went to Venice.
  const checks = search.requests.filter((r) => r.method === 'GET');
  expect(checks.map((r) => r.url)).toEqual(['https://api.search.tinyfish.ai/usage?limit=1', 'https://api.search.tinyfish.ai/usage?limit=1']);
  expect(checks[1]!.headers['x-api-key']).toBe(TINYFISH_KEY);
  expect(venice.requests).toEqual([]);

  await expect(firstRunPage.getByText('ClaimCatcher is ready.', { exact: false })).toBeVisible();
  await firstRunPage.getByRole('button', { name: 'Forget key' }).click();
  await expect(firstRunPage.getByTestId('masked-tinyfish-key')).toHaveCount(0);
  await expect(firstRunPage.getByRole('status').filter({ hasText: 'The key is forgotten.' })).toContainText("Local mode can't search at TinyFish");
  expect((await stored(serviceWorker)).tinyfishKey).toBeNull();
});

test('the panel asks for the TinyFish key in local mode with TinyFish, never for a Venice key', async ({ context, fixtures, serviceWorker, clickAction, sidePanel }) => {
  await consentTo(serviceWorker, 'tinyfish');
  const venice = await stubVenice(context);
  const video = await context.newPage();
  await video.goto(`${fixtures}/video-track.html`);
  await clickAction(video);
  const panel = await sidePanel();

  await expect(panel.getByText('Local mode searches at TinyFish, which needs your free TinyFish API key.', { exact: false })).toBeVisible();
  await expect(panel.getByText('Venice API key', { exact: false })).toHaveCount(0);
  await expect(panel.getByRole('status')).toHaveText('Not listening');
  expect(venice.requests).toEqual([]);
});

test('agreeing to either search asks Chrome for no permission, and Privacy & data lists none for search', async ({ context, firstRunPage }) => {
  await fakeChromeNano(context, 'available');
  await firstRunPage.reload();
  const requests = await recordPermissionRequests(firstRunPage, true);

  await firstRunPage.getByRole('group', { name: 'Where local mode searches' }).getByRole('radio', { name: 'Venice' }).check();
  await firstRunPage.getByRole('button', { name: 'I agree' }).click();
  await expect(firstRunPage.getByRole('heading', { level: 1 })).toHaveText('Privacy & data');
  await firstRunPage.getByRole('region', { name: 'Search' }).getByRole('button', { name: 'Search at TinyFish instead' }).click();
  await firstRunPage.getByRole('button', { name: 'I agree' }).click();
  await expect(firstRunPage.getByRole('heading', { level: 1 })).toHaveText('Privacy & data');

  expect(await requests()).toEqual([]);
  await expect(firstRunPage.getByRole('region', { name: "Permissions you've granted" })).not.toContainText(/search/i);
});

test('a stored consent to DuckDuckGo, which ClaimCatcher no longer offers, is asked for again, never read as another search', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await fakeChromeNano(context, 'available');
  await consentTo(serviceWorker, 'duckduckgo');
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/welcome.html`);

  await expect(page.getByRole('button', { name: 'I agree' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('Privacy & data');
  await expect(page.getByRole('group', { name: 'Where local mode searches' }).getByRole('radio', { name: 'TinyFish' })).toBeChecked();
});

test('choosing another search shows the consent page again before anything goes there', async ({ context, extensionId, serviceWorker }) => {
  await consentTo(serviceWorker, 'tinyfish');
  const privacy = await context.newPage();
  await privacy.goto(`chrome-extension://${extensionId}/welcome.html`);

  const searchSection = privacy.getByRole('region', { name: 'Search' });
  await expect(searchSection.getByRole('button', { name: /instead$/ })).toHaveCount(1);
  await searchSection.getByRole('button', { name: 'Search at Venice instead' }).click();
  await expect(privacy.getByRole('heading', { level: 1 })).toHaveText('Before ClaimCatcher searches at Venice');
  await expect(privacy.getByText(VENICE_SENDS, { exact: false })).toBeVisible();
  await expect(privacy.getByText(TINYFISH_SENDS)).toHaveCount(0);
  expect((await stored(serviceWorker)).search).toBe('tinyfish');

  await privacy.getByRole('button', { name: 'Keep TinyFish' }).click();
  await expect(privacy.getByRole('heading', { level: 1 })).toHaveText('Privacy & data');
  expect((await stored(serviceWorker)).search).toBe('tinyfish');

  await privacy.getByRole('button', { name: 'Search at Venice instead' }).click();
  await privacy.getByRole('button', { name: 'I agree' }).click();
  await expect(privacy.getByRole('heading', { level: 1 })).toHaveText('Privacy & data');
  expect(await stored(serviceWorker)).toMatchObject({ mode: 'local', search: 'venice' });
  await expect(privacy.getByRole('region', { name: 'Search' })).toContainText('Venice.');
  await expect(privacy.getByRole('textbox', { name: 'Venice API key' })).toBeVisible();
});
