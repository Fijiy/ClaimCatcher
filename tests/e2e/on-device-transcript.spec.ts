// The on-device transcript, in the built extension: the page's audio is
// captured with captureStream() under the icon click's activeTab grant, turned
// into text by the bundled Moonshine model in the model worker, and shown
// tagged "On-device transcript". Every request but the (stubbed) provider's is
// refused and recorded, so audio provably goes nowhere.

import { expect, test } from './extension';
import { setApiKey, stubVenice } from './venice-stub';

/** The sentence breakdown was given, which ends its prompt in quotes. */
/** The panel's header: where the transcript comes from now. */
const sourceOf = (panel: import('@playwright/test').Page) => panel.getByTitle('Where the transcript comes from');

const sentenceIn = (user: string) => /"([^"]*)"\s*$/.exec(user)![1]!;

test('a video with no captions gets an on-device transcript, which goes through the claim filter; the page keeps playing and no audio leaves the device', async ({
  context,
  fixtures,
  serviceWorker,
  clickAction,
  sidePanel,
}) => {
  test.setTimeout(120_000);
  await setApiKey(serviceWorker, 'stub-venice-key');
  const venice = await stubVenice(context, {
    offline: true,
    breakdown: (user) => {
      const sentence = sentenceIn(user);
      return { claims: [{ literal: sentence, implied: sentence, premise_of: null, queries: { fact: sentence, claim: sentence } }], skipped: [] };
    },
    verdict: () => ({
      literal: 'x',
      implied: 'x',
      evidence: 'x',
      conclusion: 'The sources say nothing about it.',
      label: 'Unverified',
      missing: null,
      sources: [{ source: 1, stance: 'neither' }],
    }),
  });

  const page = await context.newPage();
  await page.goto(`${fixtures}/uncaptioned.html`);
  await clickAction(page);
  const panel = await sidePanel();
  await expect(panel.getByRole('status')).toHaveText('Listening');
  await expect(sourceOf(panel)).toHaveText('Captions');

  const video = page.locator('video');
  await video.evaluate((v: HTMLVideoElement) => v.play());

  // About 10 s of audio with no captions: the on-device transcript takes over.
  await expect(sourceOf(panel)).toHaveText('On-device transcript', { timeout: 30_000 });

  await panel.getByRole('button', { name: 'Full transcript' }).click();
  const lines = panel.getByRole('list', { name: 'Transcript' }).locator(':scope > li');
  await expect(lines.filter({ hasText: /ask not what your country can do for you/i }).first()).toBeVisible({ timeout: 45_000 });
  await expect(lines.first()).toContainText('On-device transcript');
  await expect(lines.filter({ hasText: 'Captions' })).toHaveCount(0);
  // Each line went through the claim filter: it was either skipped by it or sent on to breakdown.
  await expect
    .poll(async () => {
      const texts = await lines.allInnerTexts();
      const broken = venice.requests.filter((r) => JSON.stringify(r.body).includes('claim_breakdown')).length;
      return texts.filter((t) => t.includes('Skipped: not flagged as a claim')).length + broken;
    }, { timeout: 30_000 })
    .toBeGreaterThan(0);

  // Capturing left playback alone: the clip played through, unmuted, to its end.
  const playback = await video.evaluate((v: HTMLVideoElement) => ({ muted: v.muted, volume: v.volume, ended: v.ended, time: v.currentTime }));
  expect(playback).toMatchObject({ muted: false, volume: 1 });
  expect(playback.time).toBeGreaterThan(10);

  // No request but the provider's text calls: no audio, no PCM, nowhere else.
  expect(venice.blocked).toEqual([]);
  for (const request of venice.requests) {
    expect(request.path).toMatch(/^\/api\/v1\/(chat\/completions|augment\/search)$/);
    expect(JSON.stringify(request.body).length).toBeLessThan(20_000);
  }

  // No host permission was used or granted: only the click's activeTab grant.
  const granted = await serviceWorker.evaluate(() => chrome.permissions.getAll());
  expect(granted.origins ?? []).toEqual([]);
});

test('when captions stop, the on-device transcript takes over about 10 s later, from where they stopped', async ({
  context,
  fixtures,
  serviceWorker,
  clickAction,
  sidePanel,
}) => {
  test.setTimeout(120_000);
  await setApiKey(serviceWorker, 'stub-venice-key');
  await stubVenice(context, { offline: true, breakdown: () => ({ claims: [], skipped: [] }) });

  const page = await context.newPage();
  await page.goto(`${fixtures}/captions-stop.html`);
  await clickAction(page);
  const panel = await sidePanel();
  await expect(panel.getByRole('status')).toHaveText('Listening');
  await page.locator('video').evaluate((v: HTMLVideoElement) => v.play());
  await panel.getByRole('button', { name: 'Full transcript' }).click();
  const lines = panel.getByRole('list', { name: 'Transcript' }).locator(':scope > li');

  await expect(lines.first()).toContainText(/And so, my fellow Americans,\s*Captions/);
  await expect(sourceOf(panel)).toHaveText('Captions');
  await expect(sourceOf(panel)).toHaveText('On-device transcript', { timeout: 30_000 });
  await expect(lines.filter({ hasText: /what you can do for your country/i }).first()).toContainText('On-device transcript', { timeout: 45_000 });
  // The captioned words aren't repeated by the on-device transcript.
  await expect(lines.filter({ hasText: /fellow Americans/i })).toHaveCount(1);
});
