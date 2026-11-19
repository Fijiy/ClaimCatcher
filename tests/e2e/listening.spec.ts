import type { Worker } from '@playwright/test';
import { expect, test } from './extension';
import { setApiKey, stubVenice } from './venice-stub';

// Listening needs a key; the provider is stubbed and finds no claims, since
// these tests are about the transcript.
test.beforeEach(async ({ context, serviceWorker }) => {
  await setApiKey(serviceWorker, 'stub-venice-key');
  await stubVenice(context);
});

test('clicking the icon on a captioned video streams its caption lines into the panel while LIVE', async ({
  context,
  fixtures,
  serviceWorker,
  clickAction,
  sidePanel,
}) => {
  const other = await context.newPage();
  await other.goto(`${fixtures}/video-track.html?other`);
  const page = await context.newPage();
  await page.goto(`${fixtures}/video-track.html`);

  await clickAction(page);
  const panel = await sidePanel();
  await expect(panel.getByRole('status')).toHaveText('Listening');
  await expect(panel.getByRole('button', { name: 'Stop' })).toBeVisible();

  await page.locator('video').evaluate((video: HTMLVideoElement) => video.play());

  await panel.getByRole('button', { name: 'Full transcript' }).click();
  const lines = panel.getByRole('list', { name: 'Transcript' }).getByRole('listitem');
  await expect(lines).toHaveText([
    /^0:00\s*The unemployment rate fell to four point one percent last month\.\s*Captions$/,
    /^0:02\s*Inflation has come down for six straight months\.\s*Captions$/,
    /^0:03\s*Congress passed the infrastructure bill with votes from both parties\.\s*Captions$/,
  ]);

  // The LIVE badge is on the listened tab (the active one) and no other.
  const { active, others } = await badges(serviceWorker);
  expect(active).toBe('LIVE');
  expect(others.length).toBeGreaterThan(0);
  expect(new Set(others)).toEqual(new Set(['']));
});

/** Badge text on the active tab and on every other tab (no `tabs` permission needed). */
function badges(serviceWorker: Worker) {
  return serviceWorker.evaluate(async () => {
    const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const all = await chrome.tabs.query({ windowType: 'normal' });
    const text = (tabId: number) => chrome.action.getBadgeText({ tabId });
    return {
      active: await text(active!.id!),
      others: await Promise.all(all.filter((t) => t.id !== active!.id).map((t) => text(t.id!))),
    };
  });
}

test('Stop ends capture, clears the dot and badge, and keeps the transcript', async ({
  context,
  fixtures,
  serviceWorker,
  clickAction,
  sidePanel,
}) => {
  const page = await context.newPage();
  await page.goto(`${fixtures}/video-track.html`);
  await clickAction(page);
  const panel = await sidePanel();
  const video = page.locator('video');
  await video.evaluate((v: HTMLVideoElement) => v.play());
  await panel.getByRole('button', { name: 'Full transcript' }).click();
  const lines = panel.getByRole('list', { name: 'Transcript' }).getByRole('listitem');
  await expect(lines.first()).toContainText('The unemployment rate fell');

  await video.evaluate((v: HTMLVideoElement) => v.pause());
  await panel.getByRole('button', { name: 'Stop' }).click();

  await expect(panel.getByRole('status')).toHaveText('Stopped');
  await expect(panel.getByRole('button', { name: 'Stop' })).toHaveCount(0);
  await expect.poll(async () => (await badges(serviceWorker)).active).toBe('');

  // Capture has ended: playing on adds nothing to the transcript.
  const count = await lines.count();
  await video.evaluate((v: HTMLVideoElement) => v.play());
  await page.waitForFunction(() => document.querySelector('video')!.currentTime > 5);
  await expect(lines).toHaveCount(count);
});
