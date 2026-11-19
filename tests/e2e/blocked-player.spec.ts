// The blocked-player fallback, in the built extension. A player whose media
// comes from another origin (like Granicus), or a video embedded from another
// site, can't be heard with captureStream(). The panel says so and offers
// Allow, which requests the optional tabCapture permission after explaining
// Chrome's wording; then it offers to reopen the video in a new tab at the
// same moment. With tabCapture already held, the fallback is immediate and
// the tab's audio gets an on-device transcript.
//
// Chrome's own permission dialog can't be clicked from a test (it is browser
// UI), so the Allow test records the request the panel makes and answers it
// as the viewer would. The "already allowed" tests start from a profile that
// holds the grant (`grantedPermissions`).

import type { Page } from '@playwright/test';
import { expect, test } from './extension';
import { setApiKey, stubVenice } from './venice-stub';

const KEY = 'stub-venice-key';
const blockedNotice = (panel: Page) => panel.getByRole('region', { name: 'This player blocks direct listening' });

async function playing(page: Page, selector = 'video') {
  await page.locator(selector).evaluate((v: HTMLVideoElement) => {
    v.loop = true;
    return v.play();
  });
}

/** Records the panel's permission requests and grants them, as the viewer accepting Chrome's dialog would. */
async function acceptPermissionRequests(panel: Page) {
  await panel.evaluate(() => {
    const requests: unknown[] = [];
    (window as unknown as { permissionRequests: unknown[] }).permissionRequests = requests;
    for (const ns of [globalThis.chrome, (globalThis as unknown as { browser?: typeof chrome }).browser]) {
      if (!ns?.permissions) continue;
      ns.permissions.request = (async (permissions: chrome.permissions.Permissions) => {
        requests.push(permissions);
        return true;
      }) as typeof chrome.permissions.request;
    }
  });
  return () => panel.evaluate(() => (window as unknown as { permissionRequests: unknown[] }).permissionRequests);
}

test('a player with media from another origin: the message, Allow with Chrome’s wording explained first, then the offer to reopen at the same moment', async ({
  context,
  fixtures,
  serviceWorker,
  clickAction,
  sidePanel,
}) => {
  test.setTimeout(90_000);
  await setApiKey(serviceWorker, KEY);
  await stubVenice(context, { offline: true });

  const page = await context.newPage();
  await page.goto(`${fixtures}/cross-origin.html`);
  await playing(page);
  await clickAction(page);
  const panel = await sidePanel();
  await expect(panel.getByRole('status')).toHaveText('Listening');

  const notice = blockedNotice(panel);
  await expect(notice).toBeVisible({ timeout: 15_000 });
  await expect(notice).toContainText('comes from another site');
  // Chrome's warning, explained before Chrome shows it.
  await expect(notice).toContainText('Chrome will ask whether ClaimCatcher may “Read and change all your data on all websites”');
  const allow = notice.getByRole('button', { name: 'Allow' });
  await expect(allow).toBeVisible();
  await expect(notice.getByRole('button', { name: /Reopen/ })).toHaveCount(0);

  const requests = await acceptPermissionRequests(panel);
  await allow.click();
  expect(await requests()).toEqual([{ permissions: ['tabCapture'] }]);

  // Chrome can't use the grant on this page: reopen it in a new tab, at the same moment, and click the icon there.
  await expect(notice).toContainText('Then click the ClaimCatcher icon there.');
  const reopen = notice.getByRole('button', { name: 'Reopen in a new tab at the same moment' });
  await expect(reopen).toBeVisible();
  await expect(notice.getByRole('button', { name: 'Allow' })).toHaveCount(0);

  await page.locator('video').evaluate((v: HTMLVideoElement) => (v.currentTime = 6));
  const [reopened] = await Promise.all([context.waitForEvent('page'), reopen.click()]);
  await reopened.waitForLoadState();
  expect(reopened.url()).toBe(page.url());
  // The old tab stops, paused where it was; the panel says to click the icon on the new one.
  await expect(panel.getByText('The video is open again in a new tab. Click the ClaimCatcher icon there to listen.')).toBeVisible();
  const left = await page.locator('video').evaluate((v: HTMLVideoElement) => ({ paused: v.paused, time: v.currentTime }));
  expect(left.paused).toBe(true);
  expect(left.time).toBeGreaterThanOrEqual(6);
  await expect(panel.getByRole('button', { name: 'Listen again' })).toHaveCount(0);

  // The click there starts listening and the video carries on from the same moment.
  await page.close(); // (clickAction finds the tab by its URL, which the new tab shares)
  await expect.poll(() => reopened.locator('video').evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(0);
  await clickAction(reopened);
  await expect(panel.getByRole('status')).toHaveText('Listening');
  await expect
    .poll(() => reopened.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThanOrEqual(left.time);

  // No host permission was asked for or used: only the clicks' activeTab grants.
  const granted = await serviceWorker.evaluate(() => chrome.permissions.getAll());
  expect(granted.origins ?? []).toEqual([]);
});

test('a video embedded from another site shows the blocked-player message and Allow', async ({
  context,
  fixtures,
  serviceWorker,
  clickAction,
  sidePanel,
}) => {
  await setApiKey(serviceWorker, KEY);
  await stubVenice(context, { offline: true });

  const page = await context.newPage();
  await page.goto(`${fixtures}/embed.html`);
  await clickAction(page);
  const panel = await sidePanel();

  const notice = blockedNotice(panel);
  await expect(notice).toBeVisible({ timeout: 15_000 });
  await expect(notice).toContainText('embedded from another site');
  await expect(notice.getByRole('button', { name: 'Allow' })).toBeVisible();

  // The embed's time can't be read, so the offer doesn't promise the same moment.
  const requests = await acceptPermissionRequests(panel);
  await notice.getByRole('button', { name: 'Allow' }).click();
  expect(await requests()).toEqual([{ permissions: ['tabCapture'] }]);
  await expect(notice.getByRole('button', { name: 'Reopen in a new tab', exact: true })).toBeVisible();
});

test.describe('with tab audio capture already allowed', () => {
  test.use({ grantedPermissions: ['tabCapture'], tabAudio: true });

  for (const { name, fixture, start } of [
    { name: 'media from another origin', fixture: 'cross-origin.html', start: (page: Page) => playing(page) },
    {
      name: 'a video embedded from another site',
      fixture: 'embed.html',
      start: async (page: Page) => {
        const frame = page.frameLocator('#embed');
        await frame.locator('video').evaluate((v: HTMLVideoElement) => {
          v.loop = true;
          return v.play();
        });
      },
    },
  ]) {
    test(`${name} falls back to tabCapture straight away and gets an on-device transcript`, async ({
      context,
      fixtures,
      serviceWorker,
      clickAction,
      sidePanel,
    }) => {
      test.setTimeout(120_000);
      await setApiKey(serviceWorker, KEY);
      const venice = await stubVenice(context, { offline: true, breakdown: () => ({ claims: [], skipped: [] }) });

      const page = await context.newPage();
      await page.goto(`${fixtures}/${fixture}`);
      await start(page);
      await clickAction(page);
      const panel = await sidePanel();
      await expect(panel.getByRole('status')).toHaveText('Listening');

      // The tab is captured straight away, with no second Allow.
      await expect.poll(() => serviceWorker.evaluate(async () => (await chrome.tabCapture.getCapturedTabs()).map((t) => t.status))).toEqual([
        'active',
      ]);
      await panel.getByRole('button', { name: 'Full transcript' }).click();
      const lines = panel.getByRole('list', { name: 'Transcript' }).locator(':scope > li');
      // The tab's audio, through tabCapture and the bundled speech-to-text.
      await expect(lines.filter({ hasText: /what your country can do for you/i }).first()).toContainText('On-device transcript', {
        timeout: 60_000,
      });
      await expect(blockedNotice(panel)).toHaveCount(0);

      // Stop ends the capture, which would otherwise outlive the session.
      await panel.getByRole('button', { name: 'Stop' }).click();
      await expect
        .poll(() => serviceWorker.evaluate(async () => (await chrome.tabCapture.getCapturedTabs()).filter((t) => t.status === 'active').length))
        .toBe(0);

      expect(venice.blocked).toEqual([]);
      const granted = await serviceWorker.evaluate(() => chrome.permissions.getAll());
      expect(granted.origins ?? []).toEqual([]);
    });
  }
});
