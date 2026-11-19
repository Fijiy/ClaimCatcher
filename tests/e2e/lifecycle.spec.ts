// The session's lifecycle in the built extension: one tab at a time, the
// on-video pill while the panel is hidden, navigation, Stop letting checks
// finish, Listen again, and the ⋯ menu's Save session and Clear now.

import type { Page, Worker } from '@playwright/test';
import { expect, test } from './extension';
import { setApiKey, stubVenice } from './venice-stub';

test.beforeEach(async ({ serviceWorker }) => {
  await setApiKey(serviceWorker, 'stub-venice-key');
});

/** The transcript's lines, after switching the panel to Full transcript. */
async function transcript(panel: Page) {
  await panel.getByRole('button', { name: 'Full transcript' }).click();
  return panel.getByRole('list', { name: 'Transcript' }).getByRole('listitem');
}
const play = (page: Page) => page.locator('video').evaluate((v: HTMLVideoElement) => v.play());
const pause = (page: Page) => page.locator('video').evaluate((v: HTMLVideoElement) => v.pause());
const pill = (page: Page) => page.locator('claimcatcher-pill');

test('starting on a second tab asks first; confirming stops the first tab and listens on the second', async ({
  context,
  fixtures,
  serviceWorker,
  clickAction,
  sidePanel,
}) => {
  await stubVenice(context);
  const first = await context.newPage();
  await first.goto(`${fixtures}/player.html`);
  await clickAction(first);
  const panel = await sidePanel();
  await expect(panel.getByRole('status')).toHaveText('Listening');

  const second = await context.newPage();
  await second.goto(`${fixtures}/video-track.html`);
  await clickAction(second);

  const question = panel.getByRole('alertdialog');
  await expect(question).toContainText('Stop listening on “Fixture: player with a full-screen button” and listen here?');
  // Nothing has changed yet: the first tab is still the one being heard.
  expect(await badgeOn(serviceWorker, first)).toBe('LIVE');
  expect(await badgeOn(serviceWorker, second)).toBe('');

  await question.getByRole('button', { name: 'Stop and listen here' }).click();

  await expect(question).toHaveCount(0);
  await expect(panel.getByRole('status')).toHaveText('Listening');
  await expect.poll(() => badgeOn(serviceWorker, second)).toBe('LIVE');
  expect(await badgeOn(serviceWorker, first)).toBe('');
  // The new session is the second tab's, and its captions arrive.
  await play(second);
  await expect((await transcript(panel)).first()).toContainText('The unemployment rate fell');
  await expect(await transcript(panel)).toHaveCount(3);
});

test('declining the second-tab question keeps listening on the first tab', async ({ context, fixtures, serviceWorker, clickAction, sidePanel }) => {
  await stubVenice(context);
  const first = await context.newPage();
  await first.goto(`${fixtures}/player.html`);
  await clickAction(first);
  const panel = await sidePanel();
  const second = await context.newPage();
  await second.goto(`${fixtures}/video-track.html`);
  await clickAction(second);

  await panel.getByRole('button', { name: 'Keep listening there' }).click();

  await expect(panel.getByRole('alertdialog')).toHaveCount(0);
  expect(await badgeOn(serviceWorker, first)).toBe('LIVE');
  expect(await badgeOn(serviceWorker, second)).toBe('');
});

test('closing the panel keeps listening and shows the pill; Show panel brings the panel back and hides it', async ({
  context,
  fixtures,
  serviceWorker,
  clickAction,
  sidePanel,
}) => {
  await stubVenice(context);
  const page = await context.newPage();
  await page.goto(`${fixtures}/player.html`);
  await clickAction(page);
  const panel = await sidePanel();
  await expect(panel.getByRole('status')).toHaveText('Listening');
  // No pill while the panel is showing.
  await expect(pill(page)).toHaveCount(0);

  await closePanel(serviceWorker);

  const onVideo = pill(page).getByRole('region', { name: 'ClaimCatcher' });
  await expect(onVideo).toBeVisible();
  await expect(onVideo).toContainText('Listening');
  await expect(onVideo).toBeInViewport();
  await expectOnTheVideo(page);
  // Set in the bundled Atkinson Hyperlegible Next only, from the extension's own bytes (no font request).
  expect(await onVideo.evaluate((el) => getComputedStyle(el).fontFamily)).toBe('"ClaimCatcher Atkinson Hyperlegible Next"');
  await expect
    .poll(() => page.evaluate(() => [...document.fonts].some((f) => f.family === 'ClaimCatcher Atkinson Hyperlegible Next' && f.status === 'loaded')))
    .toBe(true);
  // Still listening with the panel closed.
  expect(await badgeOn(serviceWorker, page)).toBe('LIVE');
  expect(await offscreenDocuments(serviceWorker)).toBe(1);
  await play(page);
  await page.waitForFunction(() => document.querySelector('video')!.currentTime > 4);

  await onVideo.getByRole('button', { name: 'Show panel' }).click();

  const reopened = await sidePanel();
  await expect(pill(page)).toHaveCount(0);
  // The panel caught up on what was said while it was closed.
  await expect(await transcript(reopened)).toHaveCount(3);
  await expect(reopened.getByRole('status')).toHaveText('Listening');
});

test("the pill's Stop stops listening, and the panel opened again still has the stopped session", async ({
  context,
  fixtures,
  extensionId,
  serviceWorker,
  clickAction,
  sidePanel,
}) => {
  await stubVenice(context, { breakdown: unemploymentOnly, verdict: () => TRUE_VERDICT });
  const page = await context.newPage();
  await page.goto(`${fixtures}/video-track.html`);
  await clickAction(page);
  const panel = await sidePanel();
  await play(page);
  await expect(claimCard(panel)).toContainText('True');
  await closePanel(serviceWorker);

  await pill(page).getByRole('button', { name: 'Stop' }).click();

  await expect(pill(page)).toHaveCount(0);
  await expect.poll(() => badgeOn(serviceWorker, page)).toBe('');
  // Long after the last check settled, the panel is opened again: the session is still there.
  // (The panel page in a tab: sidePanel.open needs a gesture the test can't give.)
  await page.waitForTimeout(1_000);
  const reopened = await context.newPage();
  await reopened.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(reopened.getByRole('status')).toHaveText('Stopped');
  await expect(claimCard(reopened)).toContainText('True');
  await reopened.getByRole('button', { name: 'More' }).click();
  await expect(reopened.getByRole('menuitem', { name: 'Save session…' })).toBeEnabled();
  await expect((await transcript(reopened)).first()).toContainText('The unemployment rate fell');
});

test('in fullscreen the pill shows inside the fullscreen player, even with the panel open, and its buttons work there', async ({
  context,
  fixtures,
  serviceWorker,
  clickAction,
  sidePanel,
}) => {
  await stubVenice(context);
  const page = await context.newPage();
  await page.goto(`${fixtures}/player.html`);
  await clickAction(page);
  const panel = await sidePanel();
  await expect(panel.getByRole('status')).toHaveText('Listening');
  await expect(pill(page)).toHaveCount(0);

  await page.getByRole('button', { name: 'Full screen' }).click();
  await page.waitForFunction(() => document.fullscreenElement?.id === 'player');

  await expect(pill(page).getByRole('region', { name: 'ClaimCatcher' })).toBeVisible();
  expect(await page.evaluate(() => document.fullscreenElement!.contains(document.querySelector('claimcatcher-pill')))).toBe(true);

  // Show panel leaves fullscreen, where the panel can be seen.
  await pill(page).getByRole('button', { name: 'Show panel' }).click();
  await page.waitForFunction(() => document.fullscreenElement === null);
  await expect(pill(page)).toHaveCount(0);

  await page.getByRole('button', { name: 'Full screen' }).click();
  await page.waitForFunction(() => document.fullscreenElement?.id === 'player');
  await pill(page).getByRole('button', { name: 'Stop' }).click();
  await expect(panel.getByRole('status')).toHaveText('Stopped');
  await expect(pill(page)).toHaveCount(0);
});

test('a new page on the same site keeps the session and re-attaches the reader and the pill', async ({
  context,
  fixtures,
  serviceWorker,
  clickAction,
  sidePanel,
}) => {
  await stubVenice(context);
  const page = await context.newPage();
  await page.goto(`${fixtures}/video-track.html`);
  await clickAction(page);
  const panel = await sidePanel();
  await play(page);
  await expect(await transcript(panel)).toHaveCount(3);

  await page.goto(`${fixtures}/player.html`);

  await expect(panel.getByRole('status')).toHaveText('Listening');
  await expect.poll(() => badgeOn(serviceWorker, page)).toBe('LIVE');
  // The new page's captions join the same transcript.
  await play(page);
  await expect(await transcript(panel)).toHaveCount(6);
  await closePanel(serviceWorker);
  await expect(pill(page).getByRole('region', { name: 'ClaimCatcher' })).toBeVisible();
});

test('moving the tab to another site stops listening and the panel says why', async ({ context, fixtures, serviceWorker, clickAction, sidePanel }) => {
  await stubVenice(context);
  const page = await context.newPage();
  await page.goto(`${fixtures}/video-track.html`);
  await clickAction(page);
  const panel = await sidePanel();
  await play(page);
  await expect(await transcript(panel)).toHaveCount(3);

  // Same server, another origin: 127.0.0.1 -> localhost.
  await page.goto(`${fixtures.replace('127.0.0.1', 'localhost')}/video-track.html`);

  await expect(panel.getByRole('status')).toHaveText('Stopped');
  await expect(panel.getByRole('alert')).toContainText('this tab moved to another site');
  await expect(panel.getByRole('button', { name: 'Listen again' })).toHaveCount(0);
  await expect.poll(() => badgeOn(serviceWorker, page)).toBe('');
  // The transcript stays, and nothing from the other site joins it.
  await play(page);
  await page.waitForFunction(() => document.querySelector('video')!.currentTime > 5);
  await expect(await transcript(panel)).toHaveCount(3);
  await expect(pill(page)).toHaveCount(0);
});

test('after Stop, checks in flight still reach a label, and the stopped session stays', async ({
  context,
  fixtures,
  serviceWorker,
  clickAction,
  sidePanel,
}) => {
  const venice = await stubVenice(context, {
    breakdown: (user) =>
      user.includes('"The unemployment rate fell')
        ? { claims: [{ literal: 'The unemployment rate fell to 4.1% last month', implied: 'Jobs are improving', premise_of: null, queries: { fact: 'unemployment rate', claim: 'unemployment 4.1' } }], skipped: [] }
        : { claims: [], skipped: [] },
    verdict: () => ({ literal: 'x', implied: 'y', evidence: 'z', conclusion: 'The jobs report gives the same rate.', label: 'True', missing: null, sources: [{ source: 1, stance: 'supports' }] }),
  });
  venice.holdVerdicts();
  const page = await context.newPage();
  await page.goto(`${fixtures}/video-track.html`);
  await clickAction(page);
  const panel = await sidePanel();
  await play(page);
  const card = panel.getByRole('list', { name: 'Claims' }).getByRole('article').filter({ hasText: 'The unemployment rate fell' });
  await expect(card).toContainText(/weighing sources/i);

  await pause(page);
  await panel.getByRole('button', { name: 'Stop' }).click();

  await expect(panel.getByRole('status')).toHaveText('Stopped');
  await expect.poll(() => badgeOn(serviceWorker, page)).toBe('');
  await expect(card).toContainText('Checking…');
  expect(await offscreenDocuments(serviceWorker)).toBe(1);

  venice.releaseVerdicts();

  await expect(card).toContainText('True');
  await expect(card).not.toContainText('Checking…');
  await expect(card).toContainText('The jobs report gives the same rate.');
  await expect(await transcript(panel)).not.toHaveCount(0);
});

test('Listen again restarts on the same tab without the icon', async ({ context, fixtures, serviceWorker, clickAction, sidePanel }) => {
  await stubVenice(context);
  const page = await context.newPage();
  await page.goto(`${fixtures}/video-track.html`);
  await clickAction(page);
  const panel = await sidePanel();
  await panel.getByRole('button', { name: 'Stop' }).click();
  await expect(panel.getByRole('status')).toHaveText('Stopped');

  await panel.getByRole('button', { name: 'Listen again' }).click();

  await expect(panel.getByRole('status')).toHaveText('Listening');
  await expect.poll(() => badgeOn(serviceWorker, page)).toBe('LIVE');
  await play(page);
  await expect(await transcript(panel)).toHaveCount(3);
});

test('Clear now empties the panel; Save session saves one local file with the session in it', async ({
  context,
  fixtures,
  serviceWorker,
  clickAction,
  sidePanel,
}) => {
  const venice = await stubVenice(context);
  const page = await context.newPage();
  await page.goto(`${fixtures}/video-track.html`);
  await clickAction(page);
  const panel = await sidePanel();
  await play(page);
  await expect(await transcript(panel)).toHaveCount(3);
  await panel.getByRole('button', { name: 'Stop' }).click();
  await expect(panel.getByRole('status')).toHaveText('Stopped');
  const requestsBefore = venice.requests.length;

  const saved = captureSaves(panel);
  await panel.getByRole('button', { name: 'More' }).click();
  await panel.getByRole('menuitem', { name: 'Save session…' }).click();

  const [file] = await saved();
  expect(file!.name).toMatch(/^claimcatcher-session-\d{4}-\d\d-\d\d-\d{4}\.json$/);
  expect(file!.href).toMatch(/^blob:chrome-extension:/);
  const contents = JSON.parse(file!.text);
  expect(contents).toMatchObject({ format: 'ClaimCatcher session', stopReason: 'viewer' });
  expect(contents.transcript.map((line: { text: string }) => line.text)).toEqual([
    'The unemployment rate fell to four point one percent last month.',
    'Inflation has come down for six straight months.',
    'Congress passed the infrastructure bill with votes from both parties.',
  ]);
  expect(venice.requests.length).toBe(requestsBefore); // nothing was uploaded

  await panel.getByRole('button', { name: 'More' }).click();
  await panel.getByRole('menuitem', { name: 'Clear now' }).click();

  await expect(await transcript(panel)).toHaveCount(0);
  await expect(panel.getByRole('menuitem')).toHaveCount(0);
  await panel.getByRole('button', { name: 'More' }).click();
  await expect(panel.getByRole('menuitem', { name: 'Clear now' })).toBeDisabled();
  await expect(panel.getByRole('menuitem', { name: 'Save session…' })).toBeDisabled();
  // Cleared, the stopped session's offscreen document has nothing left to keep.
  await expect.poll(() => offscreenDocuments(serviceWorker)).toBe(0);

  // Nothing about the session was ever written to storage: only settings,
  // and tab and window ids in memory.
  const stored = await serviceWorker.evaluate(async () => ({
    local: await chrome.storage.local.get(null),
    session: await chrome.storage.session.get(null),
  }));
  expect(Object.keys(stored.local).sort()).toEqual(['apiKey', 'consent']);
  expect(JSON.stringify(stored.session)).not.toMatch(/unemployment|video-track|Fixture/i);
});

/** Records every download link the panel clicks: its name, URL and contents. */
function captureSaves(panel: Page) {
  void panel.evaluate(() => {
    const saves: Array<{ name: string; href: string; text: Promise<string> }> = [];
    (window as unknown as { saves: typeof saves }).saves = saves;
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      if (this.download) saves.push({ name: this.download, href: this.href, text: fetch(this.href).then((r) => r.text()) });
      else click.call(this);
    };
  });
  return () =>
    panel.evaluate(async () => {
      const saves = (window as unknown as { saves: Array<{ name: string; href: string; text: Promise<string> }> }).saves;
      return Promise.all(saves.map(async (s) => ({ name: s.name, href: s.href, text: await s.text })));
    });
}

/** Claim breakdown finding one claim, in the unemployment line only. */
function unemploymentOnly(user: string) {
  return user.includes('Sentence to check:\n"The unemployment rate fell')
    ? { claims: [{ literal: 'The unemployment rate fell to 4.1% last month', implied: 'Jobs are improving', premise_of: null, queries: { fact: 'unemployment rate', claim: 'unemployment 4.1' } }], skipped: [] }
    : { claims: [], skipped: [] };
}

const TRUE_VERDICT = { literal: 'x', implied: 'y', evidence: 'z', conclusion: 'The jobs report gives the same rate.', label: 'True', missing: null, sources: [{ source: 1, stance: 'supports' }] };

const claimCard = (panel: Page) =>
  panel.getByRole('list', { name: 'Claims' }).getByRole('article').filter({ hasText: 'The unemployment rate fell' });

/** Closes the side panel the way the viewer's ✕ does. */
async function closePanel(serviceWorker: Worker) {
  await serviceWorker.evaluate(async () => {
    const window = await chrome.windows.getLastFocused();
    await chrome.sidePanel.close({ windowId: window.id! });
  });
}

/** The pill's top-right corner sits inside the video's box. */
async function expectOnTheVideo(page: Page) {
  const video = (await page.locator('video').boundingBox())!;
  const onVideo = (await pill(page).getByRole('region', { name: 'ClaimCatcher' }).boundingBox())!;
  expect(onVideo.y).toBeGreaterThanOrEqual(video.y);
  expect(onVideo.y + onVideo.height).toBeLessThanOrEqual(video.y + video.height);
  expect(onVideo.x + onVideo.width).toBeLessThanOrEqual(video.x + video.width);
  expect(onVideo.x).toBeGreaterThanOrEqual(video.x);
}

/** Badge text on the tab showing `page` (found by URL; tab URLs are readable here only under the activeTab grant). */
async function badgeOn(serviceWorker: Worker, page: Page): Promise<string> {
  await page.bringToFront();
  return serviceWorker.evaluate(async () => {
    const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return chrome.action.getBadgeText({ tabId: active!.id! });
  });
}

function offscreenDocuments(serviceWorker: Worker) {
  return serviceWorker.evaluate(
    async () => (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType] })).length,
  );
}
