// Voice separation, in the built extension: on a page without captions the
// bundled pyannote and WeSpeaker models run in the model worker on the tab's
// audio, and each on-device transcript line carries its voice. The fixture
// is two real voices taking turns (fixture-server.ts, /media/debate.wav).
// Every request but the (stubbed) provider's is refused and recorded, so the
// models provably come from the extension and audio goes nowhere.

import { expect, test } from './extension';
import { setApiKey, stubVenice } from './venice-stub';

const sourceOf = (panel: import('@playwright/test').Page) => panel.getByTitle('Where the transcript comes from');
const sentenceIn = (user: string) => /"([^"]*)"\s*$/.exec(user)![1]!;

test('voices are told apart on the device, "Who is this?" names one, and its claims carry the name', async ({
  context,
  fixtures,
  serviceWorker,
  clickAction,
  sidePanel,
}) => {
  test.setTimeout(180_000);
  await setApiKey(serviceWorker, 'stub-venice-key');
  const venice = await stubVenice(context, {
    offline: true,
    // Every sentence is one claim about the speaker ("I"), so it needs a name.
    breakdown: (user) => {
      const sentence = sentenceIn(user);
      const named = /Speaker \(named by the viewer\): "(.*?)"/.exec(user)?.[1] ?? null;
      return {
        people_named: ['Lopez', 'Hart'],
        claims: [
          {
            literal: named ? `${named} said: ${sentence}` : sentence,
            implied: sentence,
            premise_of: null,
            depends_on_speaker: true,
            speaker_words: 'I',
            speaker: named,
            queries: { fact: sentence, claim: sentence },
          },
        ],
        skipped: [],
      };
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
  await page.goto(`${fixtures}/debate.html`);
  await clickAction(page);
  const panel = await sidePanel();
  await expect(panel.getByRole('status')).toHaveText('Listening');
  await page.locator('video').evaluate((v: HTMLVideoElement) => v.play());
  await expect(sourceOf(panel)).toHaveText('On-device transcript', { timeout: 30_000 });

  await panel.getByRole('button', { name: 'Full transcript' }).click();
  const lines = panel.getByRole('list', { name: 'Transcript' }).locator(':scope > li');
  const kennedy = lines.filter({ hasText: /ask not what your country/i }).first();
  const reader = lines.filter({ hasText: /apostle of the middle class/i }).first();
  await expect(reader).toBeVisible({ timeout: 60_000 });
  const voiceOf = async (line: typeof kennedy) => /(Voice [A-Z]+) · On-device transcript/.exec(await line.innerText())?.[1];
  await expect.poll(() => voiceOf(kennedy), { timeout: 30_000 }).toMatch(/^Voice [A-Z]$/);
  await expect.poll(() => voiceOf(reader), { timeout: 30_000 }).toMatch(/^Voice [A-Z]$/);
  expect(await voiceOf(reader)).not.toBe(await voiceOf(kennedy));
  const readerVoice = (await voiceOf(reader))!;

  // The reader's first claim asks "Who is this?" (checked by hand if the claim filter skipped it).
  const check = reader.getByRole('button', { name: /^Check this/ });
  if (await check.count()) await check.click();
  const card = reader.getByRole('article').first();
  const ask = card.getByRole('group', { name: 'Who is this?' });
  await expect(ask).toBeVisible({ timeout: 30_000 });
  await expect(ask.getByRole('button', { name: 'Skip' })).toBeVisible();
  await ask.getByRole('button', { name: 'Hart', exact: true }).click();

  await expect(card).toContainText('Said by Hart', { timeout: 30_000 });
  await expect(reader).toContainText('Hart · On-device transcript');
  expect(readerVoice).toMatch(/Voice/);
  // The re-check told breakdown the speaker's name, and nothing else about voices.
  expect(venice.requests.some((r) => JSON.stringify(r.body).includes('Speaker (named by the viewer): \\"Hart\\"'))).toBe(true);
  for (const request of venice.requests) {
    expect(request.path).toMatch(/^\/api\/v1\/(chat\/completions|augment\/search)$/);
    expect(JSON.stringify(request.body)).not.toMatch(/Voice [A-Z]\b|voice-\d/);
  }
  // Nothing was fetched from anywhere else: the models are the extension's own.
  expect(venice.blocked).toEqual([]);
});

test.describe('through tabCapture (a blocked player)', () => {
  test.use({ grantedPermissions: ['tabCapture'], tabAudio: true });

  test('voices are told apart in the tab\'s audio as well', async ({ context, fixtures, serviceWorker, clickAction, sidePanel }) => {
    test.setTimeout(180_000);
    await setApiKey(serviceWorker, 'stub-venice-key');
    const venice = await stubVenice(context, { offline: true, breakdown: () => ({ claims: [], skipped: [] }) });

    const page = await context.newPage();
    await page.goto(`${fixtures}/cross-origin.html?media=debate`);
    await page.locator('video').evaluate((v: HTMLVideoElement) => v.play());
    await clickAction(page);
    const panel = await sidePanel();
    await expect(panel.getByRole('status')).toHaveText('Listening');
    await expect.poll(() => serviceWorker.evaluate(async () => (await chrome.tabCapture.getCapturedTabs()).map((t) => t.status))).toEqual(['active']);

    await panel.getByRole('button', { name: 'Full transcript' }).click();
    const lines = panel.getByRole('list', { name: 'Transcript' }).locator(':scope > li');
    const kennedy = lines.filter({ hasText: /what your country can do for you/i }).first();
    const reader = lines.filter({ hasText: /apostle of the middle class/i }).first();
    await expect(reader).toBeVisible({ timeout: 90_000 });
    const voiceOf = async (line: typeof kennedy) => /(Voice [A-Z]+) · On-device transcript/.exec(await line.innerText())?.[1];
    await expect.poll(() => voiceOf(kennedy), { timeout: 30_000 }).toMatch(/^Voice [A-Z]$/);
    await expect.poll(() => voiceOf(reader), { timeout: 30_000 }).toMatch(/^Voice [A-Z]$/);
    expect(await voiceOf(reader)).not.toBe(await voiceOf(kennedy));
    expect(venice.blocked).toEqual([]);
  });
});
