// Verdict cards and the live claims stream (#31), on the built extension with
// the provider stubbed. The fixture's three caption cues are said at 0:00
// (0.5 s), 0:02 and 0:03; the stub turns them into four claims, one per label.

import type { BrowserContext, Locator, Page } from '@playwright/test';
import { expect, test } from './extension';
import { setApiKey, stubVenice, type VeniceStub } from './venice-stub';

const SOURCES = (query: string) => [
  { title: `BLS jobs report (${query})`, url: 'https://www.bls.gov/news.release/empsit.nr0.htm?utm_source=x', content: 'The rate was 4.1 percent.' },
  { title: 'AP: what the jobs report shows', url: 'https://apnews.com/article/jobs-report-1', content: 'Economists said the rate held.' },
  // Partisan: shown as context only, never evidence.
  { title: 'White House: the economy', url: 'https://www.whitehouse.gov/economy/', content: 'The best economy ever.' },
];

const claim = (literal: string, premise_of: string | null = null) => ({
  literal,
  implied: `${literal} (implied)`,
  premise_of,
  queries: { fact: `${literal} figures`, claim: literal },
});

const verdict = (label: string, conclusion: string, missing: string | null = null) => ({
  literal: '',
  implied: '',
  evidence: '',
  conclusion,
  label,
  missing,
  sources: [
    { source: 1, stance: 'supports' },
    { source: 2, stance: 'contradicts' },
  ],
});

/** Four claims, one per label, from the fixture's three sentences. */
function stubFourLabels(context: BrowserContext): Promise<VeniceStub> {
  return stubVenice(context, {
    breakdown: (user) => {
      // Only the sentence being checked, not the earlier transcript sent with it.
      const sentence = /Sentence to check:\n"(.*)"/.exec(user)?.[1] ?? '';
      if (sentence.startsWith('The unemployment rate fell')) return { claims: [claim('The unemployment rate fell to 4.1% last month')], skipped: [] };
      if (sentence.startsWith('Inflation has come down'))
        return {
          claims: [claim('Inflation has fallen for six straight months', 'so prices will keep falling')],
          skipped: [{ text: 'so prices will keep falling', reason: 'prediction' }],
        };
      if (sentence.startsWith('Congress passed'))
        return { claims: [claim('Congress passed the infrastructure bill'), claim('The bill had votes from both parties')], skipped: [] };
      return { claims: [], skipped: [] };
    },
    verdict: (user) => {
      const claimed = /Claim to check:\n"(.*)"/.exec(user)?.[1] ?? '';
      if (claimed.startsWith('The unemployment rate fell')) return verdict('True', 'The jobs report gives the same 4.1% rate.');
      if (claimed.startsWith('Inflation has fallen'))
        return verdict('Misleading', 'Inflation fell for six months, but from a record high.', 'Prices are still higher than two years ago.');
      if (claimed.startsWith('Congress passed')) return verdict('False', 'The bill passed the Senate but not the House.');
      return verdict('Unverified', 'The sources give no vote count.');
    },
    search: SOURCES,
  });
}

/** Starts listening on a fixture page and returns it with the side panel. */
async function listen(
  { context, fixtures, clickAction, sidePanel }: { context: BrowserContext; fixtures: string; clickAction: (p: Page) => Promise<void>; sidePanel: () => Promise<Page> },
  path: string,
) {
  const page = await context.newPage();
  await page.goto(`${fixtures}/${path}`);
  await clickAction(page);
  const panel = await sidePanel();
  await expect(panel.getByRole('status')).toHaveText('Listening');
  return { page, panel, video: page.locator('video') };
}

const cardSaying = (panel: Page, text: string) => panel.getByRole('list', { name: 'Claims' }).getByRole('article').filter({ hasText: text });

function colours(locator: Locator) {
  return locator.evaluate((el) => {
    const style = getComputedStyle(el);
    return { background: style.backgroundColor, border: style.borderTopColor, color: style.color };
  });
}

const rgb = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

test.beforeEach(async ({ serviceWorker }) => {
  await setApiKey(serviceWorker, 'stub-venice-key');
});

test('cards show the label with its glyph and colours, stay white while checking, and expand and collapse', async ({
  context,
  fixtures,
  clickAction,
  sidePanel,
}) => {
  const venice = await stubFourLabels(context);
  venice.holdVerdicts();
  const { panel, video } = await listen({ context, fixtures, clickAction, sidePanel }, 'video-recorded.html');
  await video.evaluate((v: HTMLVideoElement) => v.play());

  // Still being checked: white, a spinner, "Checking…" and the stage.
  const checking = cardSaying(panel, 'The unemployment rate fell to 4.1% last month');
  await expect(checking).toContainText('Checking…');
  await expect(checking).toContainText('Weighing sources…');
  expect(await colours(checking)).toMatchObject({ background: rgb('#ffffff') });

  venice.releaseVerdicts();
  const palette = [
    ['The unemployment rate fell', '✓', 'True', '#ffffff', '#1f7a4b', '#e6f4eb', '#c4e4cf'],
    ['Inflation has fallen', '◐', 'Misleading', '#3a2900', '#f2c641', '#fff3cf', '#f1dd9a'],
    ['Congress passed the infrastructure bill', '✕', 'False', '#ffffff', '#c8321f', '#fde8e4', '#f4c6be'],
    ['The bill had votes from both parties', '?', 'Unverified', '#ffffff', '#5f6673', '#eceef2', '#d6dae1'],
  ] as const;
  for (const [text, glyph, label, labelInk, labelFill, cardFill, cardBorder] of palette) {
    const card = cardSaying(panel, text);
    const chip = card.getByText(label, { exact: true });
    await expect(chip).toBeVisible();
    // Never colour alone: the glyph and the word sit together on the label.
    await expect(chip.locator('..')).toHaveText(`${glyph} ${label}`);
    expect(await colours(chip.locator('..'))).toMatchObject({ background: rgb(labelFill), color: rgb(labelInk) });
    // Polled: the tint fades in when the label arrives.
    await expect.poll(() => colours(card)).toMatchObject({ background: rgb(cardFill), border: rgb(cardBorder) });
  }
  // Unverified is shown like any other label.
  await expect(panel.getByRole('list', { name: 'Claims' }).getByRole('article')).toHaveCount(4);

  // Each new verdict is announced politely, label first.
  const announced = panel.locator('[aria-live="polite"][aria-relevant="additions"]');
  await expect(announced).toContainText('True: The unemployment rate fell to 4.1% last month. The jobs report gives the same 4.1% rate.');
  await expect(announced).toContainText('Unverified: The bill had votes from both parties. The sources give no vote count.');

  // Collapsed: the claim in bold, the conclusion and the tags; no detail.
  const misleading = cardSaying(panel, 'Inflation has fallen for six straight months');
  await expect(misleading).toContainText('Inflation fell for six months, but from a record high.');
  await expect(misleading).toContainText('Premise of a prediction · “so prices will keep falling”');
  await expect(misleading.getByText('Judged as of', { exact: false })).toHaveCount(0);
  const toggle = misleading.getByRole('button', { name: /What’s missing · 2 sources/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  // Expanded: what's missing, the sources, the judged-as-of date and the actions.
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(misleading).toContainText('Prices are still higher than two years ago.');
  const sources = misleading.getByRole('list', { name: 'Evidence' }).getByRole('listitem');
  await expect(sources).toHaveCount(2);
  await expect(sources.nth(0)).toContainText('bls.gov');
  await expect(sources.nth(0)).toContainText('supports');
  await expect(sources.nth(1)).toContainText('apnews.com');
  await expect(sources.nth(1)).toContainText('contradicts');
  await expect(misleading).toContainText('Judged as of Jun 27, 2024 (when said)');
  await expect(misleading.getByRole('button', { name: 'Copy with sources' })).toBeVisible();
  await expect(misleading.getByRole('button', { name: 'Replay 0:02', exact: true })).toBeVisible();

  // Collapses again, from the keyboard too.
  await toggle.focus();
  await panel.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(misleading.getByText('Judged as of', { exact: false })).toHaveCount(0);

  // Every control on the cards has an accessible name.
  await toggle.click();
  for (const control of await panel.getByRole('list', { name: 'Claims' }).locator('button, a').all()) {
    expect(await control.evaluate((el) => (el.getAttribute('aria-label') ?? el.textContent ?? '').trim())).not.toBe('');
  }
  await toggle.click();

  // A click anywhere on the card opens it as well.
  await misleading.getByText('Inflation fell for six months', { exact: false }).click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  // The recording date went into the verdict prompts.
  const verdictPrompts = venice.requests
    .map((r) => r.body as { messages?: Array<{ role: string; content: string }>; response_format?: { json_schema?: { name?: string } } })
    .filter((b) => b?.response_format?.json_schema?.name === 'verdict');
  expect(verdictPrompts).toHaveLength(4);
  for (const prompt of verdictPrompts) expect(prompt.messages!.find((m) => m.role === 'user')!.content).toContain('2024-06-27');
});

test('the card time and Replay seek the video to when the claim was said, and Copy with sources copies the verdict with its evidence', async ({
  context,
  fixtures,
  clickAction,
  sidePanel,
}) => {
  await stubFourLabels(context);
  // The clipboard is the browser's; the test reads it back from the fixture page.
  await context.grantPermissions(['clipboard-read'], { origin: fixtures });

  const { page, panel, video } = await listen({ context, fixtures, clickAction, sidePanel }, 'video-recorded.html');
  await video.evaluate((v: HTMLVideoElement) => v.play());
  const misleading = cardSaying(panel, 'Inflation has fallen for six straight months');
  await expect(misleading).toContainText('Misleading');
  await expect(cardSaying(panel, 'The bill had votes from both parties')).toContainText('Unverified');

  // Well past the claims; then each one replays its own moment.
  await video.evaluate((v: HTMLVideoElement) => {
    v.pause();
    v.currentTime = 20;
  });
  const playedFrom = () => video.evaluate((v: HTMLVideoElement) => ({ at: v.currentTime, playing: !v.paused }));

  await cardSaying(panel, 'The unemployment rate fell').getByRole('button', { name: 'Replay from 0:00' }).click();
  await expect.poll(playedFrom).toMatchObject({ playing: true });
  expect((await playedFrom()).at).toBeGreaterThanOrEqual(0.5);
  expect((await playedFrom()).at).toBeLessThan(3);

  await video.evaluate((v: HTMLVideoElement) => {
    v.pause();
    v.currentTime = 20;
  });
  await misleading.getByRole('button', { name: /What’s missing/ }).click();
  // The claim stands alone on the card; the speaker's own words are in the opened card.
  await expect(misleading).toContainText('As said “Inflation has come down for six straight months.”');
  await misleading.getByRole('button', { name: 'Replay 0:02', exact: true }).click();
  await expect.poll(playedFrom).toMatchObject({ playing: true });
  expect((await playedFrom()).at).toBeGreaterThanOrEqual(2);
  expect((await playedFrom()).at).toBeLessThan(4.5);

  await misleading.getByRole('button', { name: 'Copy with sources' }).click();
  await expect(misleading).toContainText('Copied with 2 sources.');
  await page.bringToFront();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(
    [
      '“Inflation has fallen for six straight months”',
      // The speaker's own words, since the claim was written to stand alone.
      'As said: “Inflation has come down for six straight months.”',
      'ClaimCatcher: Misleading. Inflation fell for six months, but from a record high.',
      'What’s missing: Prices are still higher than two years ago.',
      'Sources:',
      // Copied links are cleaned links: the tracking parameter the search gave is gone.
      '- BLS jobs report (Inflation has fallen for six straight months figures) (bls.gov): https://www.bls.gov/news.release/empsit.nr0.htm',
      '- AP: what the jobs report shows (apnews.com): https://apnews.com/article/jobs-report-1',
      'Context only, not used for the verdict:',
      '- White House: the economy (whitehouse.gov): https://www.whitehouse.gov/economy/',
      `Said at 0:02: ${fixtures}/video-recorded.html`,
      'Judged as of Jun 27, 2024 (when said)',
    ].join('\n'),
  );
});

test('the stream follows live until the viewer scrolls up or opens a card, then offers “↓ N new · Jump to live”', async ({
  context,
  fixtures,
  clickAction,
  sidePanel,
}) => {
  // Eight claims per sentence, so the stream overflows the panel.
  await stubVenice(context, {
    breakdown: (user) => {
      const sentence = /Sentence to check:\n"(.*)"/.exec(user)?.[1] ?? '';
      const word = sentence.split(' ')[0];
      return { claims: Array.from({ length: 8 }, (_, i) => claim(`${word} claim ${i + 1}`)), skipped: [] };
    },
    verdict: () => verdict('True', 'The sources say the same.'),
    search: SOURCES,
  });
  const { panel, video } = await listen({ context, fixtures, clickAction, sidePanel }, 'video-track.html');
  const cards = panel.getByRole('list', { name: 'Claims' }).getByRole('article');
  const scroller = panel.locator('.scroller');
  const atBottom = () => scroller.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight < 2);
  const labelled = (n: number) => expect(cards.filter({ hasText: 'The sources say the same.' })).toHaveCount(n);
  const jump = panel.getByRole('button', { name: /Jump to live/ });
  // Each seek shows one caption cue: one sentence, eight cards.
  const say = (at: number) => video.evaluate((v: HTMLVideoElement, t) => void (v.currentTime = t), at);

  await say(0.6);
  await labelled(8);
  expect(await scroller.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await expect.poll(atBottom).toBe(true);
  await expect(jump).toHaveCount(0);

  // Opening a card stops following: new cards don't move the stream.
  await cards.last().getByRole('button', { name: /source/ }).click();
  const top = await scroller.evaluate((el) => el.scrollTop);
  await say(2.1);
  await labelled(16);
  await expect(jump).toHaveText('↓ 8 new · Jump to live');
  expect(await scroller.evaluate((el) => el.scrollTop)).toBe(top);
  expect(await atBottom()).toBe(false);

  await jump.click();
  await expect.poll(atBottom).toBe(true);
  await expect(jump).toHaveCount(0);

  // Scrolling up stops following too.
  await scroller.hover();
  await panel.mouse.wheel(0, -400);
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeLessThan(await scroller.evaluate((el) => el.scrollHeight - el.clientHeight - 100));
  await say(3.6);
  await labelled(24);
  await expect(jump).toHaveText('↓ 8 new · Jump to live');
  expect(await atBottom()).toBe(false);

  // Jump to live works from the keyboard.
  await jump.focus();
  await panel.keyboard.press('Enter');
  await expect.poll(atBottom).toBe(true);
  await expect(jump).toHaveCount(0);
});
