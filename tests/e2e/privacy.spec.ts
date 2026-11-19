// The first-run page (consent and key setup), which stays available as
// Privacy & data from the panel's ⋯ menu.

import type { Page, Worker } from '@playwright/test';
import { expect, test } from './extension';
import { setApiKey, stubVenice } from './venice-stub';

const KEY = 'stub-venice-key-3f9a';

const offscreenDocuments = (serviceWorker: Worker) =>
  serviceWorker.evaluate(
    async () => (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType] })).length,
  );

async function openVideo(page: Page, fixtures: string) {
  await page.goto(`${fixtures}/video-track.html`);
}

test('the first-run page opens on install, and listening waits for consent and a working key', async ({
  context,
  fixtures,
  firstRunPage,
  serviceWorker,
  clickAction,
  sidePanel,
}) => {
  const venice = await stubVenice(context);
  const welcome = firstRunPage;
  await welcome.reload(); // the stub covers only pages loaded after it

  // What it hears, sends and to whom, keeps, and never does, in plain words.
  await expect(welcome.getByRole('heading', { level: 1 })).toHaveText('Before ClaimCatcher listens');
  for (const heading of ['What it hears', 'What it sends, and to whom', 'What it keeps', 'What it never does']) {
    await expect(welcome.getByRole('heading', { name: heading })).toBeVisible();
  }
  await expect(welcome.getByText("This tab's audio, only while it's listening.")).toBeVisible();
  await expect(
    welcome.getByText(
      "Audio and transcript stay on this device; the claims ClaimCatcher checks are sent to Venice's search to find sources, " +
        "and each claim, with about 30 seconds of what was said before it and the page's title and channel, is sent to Venice to be judged.",
    ),
  ).toBeVisible();
  await expect(welcome.getByText('Nothing after the session, unless you save it.', { exact: false })).toBeVisible();
  await expect(welcome.getByText('No account and no tracking.', { exact: false })).toBeVisible();
  await expect(welcome.getByText('a small pill on the video', { exact: false })).toBeVisible();
  await expect(welcome.getByText('stored in this browser, unencrypted', { exact: false })).toBeVisible();
  await expect(welcome.getByText('about $1–2 per hour of video', { exact: false })).toBeVisible();
  // Product copy says "viewer", never "user"; Take9 waits for Privacy & data.
  expect(await welcome.locator('body').innerText()).not.toMatch(/\busers?\b/i);
  await expect(welcome.getByText('Take9', { exact: false })).toHaveCount(0);

  // Before consent: the icon opens the panel, which says what to do, and nothing listens.
  const video = await context.newPage();
  await openVideo(video, fixtures);
  await clickAction(video);
  const panel = await sidePanel();
  await expect(panel.getByText('Before ClaimCatcher can listen', { exact: false })).toBeVisible();
  await expect(panel.getByRole('status')).toHaveText('Not listening');
  expect(await offscreenDocuments(serviceWorker)).toBe(0);

  // Agreeing leads to key setup; still no listening without a key.
  await welcome.bringToFront();
  await welcome.getByRole('button', { name: 'I agree' }).click();
  await expect(welcome.getByRole('heading', { level: 1 })).toHaveText('Privacy & data');
  await expect(welcome.getByText('Inference Only', { exact: false })).toBeVisible();
  await expect(welcome.getByText('consumptionLimit')).toBeVisible();
  await expect(welcome.getByText('expiresAt')).toBeVisible();
  await expect(panel.getByText('ClaimCatcher needs your Venice API key before it can listen.', { exact: false })).toBeVisible();
  await video.bringToFront();
  await clickAction(video);
  await expect(panel.getByRole('status')).toHaveText('Not listening');
  expect(await offscreenDocuments(serviceWorker)).toBe(0);

  // The pasted key is cleaned, checked for free, and the result shown.
  await welcome.bringToFront();
  await welcome.getByRole('textbox', { name: 'Venice API key' }).fill(` Bearer ${KEY} `);
  await welcome.getByRole('button', { name: 'Check and save key' }).click();
  await expect(welcome.getByRole('status').filter({ hasText: 'The key works.' })).toHaveText(
    'The key works. Your Venice balance is $10.00. It has no expiry date.',
  );
  await expect(welcome.getByTestId('masked-key')).toHaveText('••••3f9a');
  await expect(welcome.getByText(KEY)).toHaveCount(0);
  const check = venice.requests.find((r) => r.path === '/api/v1/api_keys/rate_limits');
  expect(check).toMatchObject({ method: 'GET', headers: { authorization: `Bearer ${KEY}` } });
  expect(venice.requests.filter((r) => r.path !== '/api/v1/api_keys/rate_limits')).toEqual([]); // nothing that costs

  // Now the icon starts listening.
  await expect(panel.getByText('needs your Venice API key', { exact: false })).toHaveCount(0);
  await video.bringToFront();
  await clickAction(video);
  await expect(panel.getByRole('status')).toHaveText('Listening');
});

test('a key alone is not enough: listening also waits for consent', async ({ context, fixtures, serviceWorker, clickAction, sidePanel }) => {
  await serviceWorker.evaluate((k) => chrome.storage.local.set({ apiKey: k }), KEY); // a key, but no consent
  await stubVenice(context);
  const video = await context.newPage();
  await openVideo(video, fixtures);
  await clickAction(video);
  const panel = await sidePanel();

  await expect(panel.getByText('Before ClaimCatcher can listen', { exact: false })).toBeVisible();
  await expect(panel.getByRole('status')).toHaveText('Not listening');
  expect(await offscreenDocuments(serviceWorker)).toBe(0);
});

test("a key the provider refuses isn't saved, and the page says why", async ({ context, firstRunPage, serviceWorker }) => {
  const venice = await stubVenice(context, { keyCheck: () => ({ status: 401, error: 'Authentication failed' }) });
  await firstRunPage.reload(); // the stub covers only pages loaded after it
  await firstRunPage.getByRole('button', { name: 'I agree' }).click();
  await firstRunPage.getByRole('textbox', { name: 'Venice API key' }).fill(KEY);
  await firstRunPage.getByRole('button', { name: 'Check and save key' }).click();

  await expect(firstRunPage.getByRole('status')).toHaveText(/^Venice didn't accept this key\./);
  await expect(firstRunPage.getByTestId('masked-key')).toHaveCount(0);
  expect(await serviceWorker.evaluate(() => chrome.storage.local.get('apiKey'))).toEqual({});
  expect(venice.requests.map((r) => r.path)).toEqual(['/api/v1/api_keys/rate_limits']);
});

test('Privacy & data opens from the ⋯ menu; Forget key removes the key, and listening then stops and can’t start', async ({
  context,
  fixtures,
  serviceWorker,
  clickAction,
  sidePanel,
}) => {
  await setApiKey(serviceWorker, KEY);
  const venice = await stubVenice(context);
  const video = await context.newPage();
  await openVideo(video, fixtures);
  await clickAction(video);
  const panel = await sidePanel();
  await expect(panel.getByRole('status')).toHaveText('Listening');

  await panel.getByRole('button', { name: 'More' }).click();
  const opened = context.waitForEvent('page');
  await panel.getByRole('menuitem', { name: 'Privacy & data' }).click();
  const privacy = await opened;
  await expect(privacy.getByRole('heading', { level: 1 })).toHaveText('Privacy & data');
  // The same information as the first-run page, plus the extras.
  await expect(privacy.getByRole('heading', { name: 'What it sends, and to whom' })).toBeVisible();
  await expect(privacy.getByRole('heading', { name: 'Credits' })).toBeVisible();
  await expect(privacy.getByText('Media Bias/Fact Check (MBFC)')).toBeVisible();
  await expect(privacy.getByText('ClaimBuster dataset')).toBeVisible();
  await expect(privacy.getByText('Moonshine base')).toBeVisible();
  await expect(privacy.getByText('Take9', { exact: false })).toHaveCount(1);
  expect(await privacy.locator('body').innerText()).not.toMatch(/\busers?\b/i);

  await expect(privacy.getByTestId('masked-key')).toHaveText('••••3f9a');
  await expect(privacy.getByText(KEY)).toHaveCount(0);
  await privacy.getByRole('button', { name: 'Forget key' }).click();
  await expect(privacy.getByTestId('masked-key')).toHaveCount(0);
  await expect(privacy.getByRole('status')).toHaveText(/The key is forgotten/);
  expect(await serviceWorker.evaluate(() => chrome.storage.local.get('apiKey'))).toEqual({});

  // The session that was using the key stops, with a way back to Privacy & data…
  await expect(panel.getByRole('status')).toHaveText('Stopped');
  await expect(panel.getByRole('alert')).toContainText('there is no Venice API key');
  await expect(panel.getByRole('alert').getByRole('button', { name: 'Privacy & data' })).toBeVisible();
  // …and the icon can't start a new one.
  const sent = venice.requests.length;
  await clickAction(video);
  await expect(panel.getByRole('status')).toHaveText('Stopped');
  await expect(panel.getByRole('alert')).toContainText('there is no Venice API key');
  expect(venice.requests.length).toBe(sent);
});

test.describe('with tab audio capture granted', () => {
  test.use({ grantedPermissions: ['tabCapture'] });

  test('Privacy & data lists the granted permission, and Revoke removes it', async ({ context, extensionId, serviceWorker }) => {
    await setApiKey(serviceWorker, KEY);
    const held = () => serviceWorker.evaluate(async () => (await chrome.permissions.getAll()).permissions ?? []);
    expect(await held()).toContain('tabCapture');

    const privacy = await context.newPage();
    await privacy.goto(`chrome-extension://${extensionId}/welcome.html`);
    const granted = privacy.getByRole('region', { name: "Permissions you've granted" });
    await expect(granted.getByText('Tab audio capture')).toBeVisible();
    await granted.getByRole('button', { name: 'Revoke Tab audio capture' }).click();

    await expect(granted.getByText('Tab audio capture')).toHaveCount(0);
    await expect(granted.getByText('None beyond what ClaimCatcher was installed with.', { exact: false })).toBeVisible();
    expect(await held()).not.toContain('tabCapture');
  });
});

test('Credits name every entry of the shipped notices file with its licence, and link to the file', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await setApiKey(serviceWorker, KEY);
  const privacy = await context.newPage();
  await privacy.goto(`chrome-extension://${extensionId}/welcome.html`);
  const credits = privacy.getByRole('region', { name: 'Credits' });
  await expect(credits).toBeVisible();

  const opened = context.waitForEvent('page');
  await credits.getByRole('link', { name: 'Third-party notices' }).click();
  const file = await opened;
  await expect(file).toHaveURL(`chrome-extension://${extensionId}/THIRD-PARTY-NOTICES.txt`);
  const notices = await file.locator('body').innerText();
  expect(notices).toMatch(/^# Third-party notices/);

  const entries = [...notices.matchAll(/^### (.+)\n\n- Licence: (.+)$/gm)].map(([, name, licence]) => ({ name: name!, licence: licence! }));
  expect(entries.length).toBeGreaterThanOrEqual(10);
  for (const { name, licence } of entries) {
    const credit = credits.getByRole('listitem').filter({ has: privacy.getByRole('link', { name, exact: true }) });
    await expect(credit, name).toHaveCount(1);
    const shown = await credit.getByTestId(`licence:${name}`).innerText();
    expect(licence, name).toContain(shown);
  }
});
