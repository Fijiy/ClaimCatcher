// The bundled on-device claim filter, the Full transcript view and forced
// checks, in the built extension. These run the real model worker: the
// DistilBERT filter on ONNX Runtime's bundled WASM, with every request that
// isn't the (stubbed) provider's refused.

import { expect, test } from './extension';
import { setApiKey, stubVenice } from './venice-stub';

const VERDICT = {
  literal: 'The literal claim.',
  implied: 'The takeaway.',
  evidence: 'The source gives the figure.',
  conclusion: 'The source gives the same figure.',
  label: 'True',
  missing: null,
  sources: [{ source: 1, stance: 'supports' }],
};

/** The sentence breakdown was given, which ends its prompt in quotes. */
const sentenceIn = (user: string) => /"([^"]*)"\s*$/.exec(user)![1]!;

test('the bundled claim filter runs on the device with no network: it skips a greeting and a slogan, and passes a figure', async ({
  context,
  fixtures,
  serviceWorker,
  clickAction,
  sidePanel,
}) => {
  await setApiKey(serviceWorker, 'stub-venice-key');
  const venice = await stubVenice(context, {
    offline: true,
    breakdown: (user) => {
      const sentence = sentenceIn(user);
      return { claims: [{ literal: sentence, implied: sentence, premise_of: null, queries: { fact: sentence, claim: sentence } }], skipped: [] };
    },
    verdict: () => VERDICT,
  });

  const page = await context.newPage();
  await page.goto(`${fixtures}/claim-filter.html`);
  await clickAction(page);
  const panel = await sidePanel();
  await expect(panel.getByRole('status')).toHaveText('Listening');
  await page.locator('video').evaluate((video: HTMLVideoElement) => video.play());

  // Only the sentence the filter passed reached claim breakdown and became a card.
  const cards = panel.getByRole('list', { name: 'Claims' }).getByRole('article');
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText('The World Bank reported 70% youth unemployment.');
  await expect(cards).toContainText('True');
  await expect(panel.getByText('1 checked', { exact: true })).toBeVisible();

  await panel.getByRole('button', { name: 'Full transcript' }).click();
  const lines = panel.getByRole('list', { name: 'Transcript' }).locator(':scope > li');
  await expect(lines).toHaveCount(3);
  await expect(lines.nth(0)).toContainText(/0:00\s*Thank you all for coming today\.\s*Captions\s*Skipped: not flagged as a claim/);
  await expect(lines.nth(1)).toContainText('The World Bank reported 70% youth unemployment.');
  await expect(lines.nth(1)).not.toContainText('Skipped');
  await expect(lines.nth(2)).toContainText(/We will make America great again\.\s*Captions\s*Skipped: not flagged as a claim/);

  const breakdowns = venice.requests.filter((r) => JSON.stringify(r.body).includes('claim_breakdown'));
  expect(breakdowns.map((r) => sentenceIn(lastUserMessage(r.body)))).toEqual(['The World Bank reported 70% youth unemployment.']);

  // The worker ran threaded (the extension is cross-origin isolated), and nothing was fetched from anywhere else.
  const runtime = await serviceWorker.evaluate(() => chrome.runtime.sendMessage({ to: 'offscreen', type: 'get-model-runtime' }));
  expect(runtime).toMatchObject({ crossOriginIsolated: true });
  expect(runtime.threads).toBeGreaterThan(1);
  expect(venice.blocked).toEqual([]);
});

test('"Check this" on a skipped line appears on hover and keyboard focus, and its forced check ends in a label tagged "You asked to check this"', async ({
  context,
  fixtures,
  serviceWorker,
  clickAction,
  sidePanel,
}) => {
  await setApiKey(serviceWorker, 'stub-venice-key');
  // Even when forced, breakdown finds no claim in a slogan; the check still ends in a label.
  const venice = await stubVenice(context, {
    breakdown: (user) =>
      sentenceIn(user).startsWith('The World Bank')
        ? { claims: [], skipped: [] }
        : { claims: [], skipped: [{ text: sentenceIn(user), reason: 'promise' }] },
    verdict: () => ({ ...VERDICT, label: 'Unverified', conclusion: 'The sources give nothing to check this against.' }),
  });
  venice.holdVerdicts();

  const page = await context.newPage();
  await page.goto(`${fixtures}/claim-filter.html`);
  await clickAction(page);
  const panel = await sidePanel();
  await page.locator('video').evaluate((video: HTMLVideoElement) => video.play());
  await panel.getByRole('button', { name: 'Full transcript' }).click();

  const lines = panel.getByRole('list', { name: 'Transcript' }).locator(':scope > li');
  const slogan = lines.filter({ hasText: 'We will make America great again.' });
  await expect(slogan).toContainText('Skipped: not flagged as a claim');
  const checkThis = slogan.getByRole('button', { name: /^Check this/ });

  // Hidden at rest, shown on hover and on keyboard focus.
  await expect(checkThis).toHaveCSS('opacity', '0');
  await slogan.hover();
  await expect(checkThis).toHaveCSS('opacity', '1');
  await panel.mouse.move(0, 0);
  await expect(checkThis).toHaveCSS('opacity', '0');
  await checkThis.focus();
  await panel.keyboard.press('Tab');
  await panel.keyboard.press('Shift+Tab');
  await expect(checkThis).toBeFocused();
  await expect(checkThis).toHaveCSS('opacity', '1');

  await panel.keyboard.press('Enter');
  const card = slogan.getByRole('article');
  await expect(card).toContainText('Checking…');
  await expect(card).toContainText('You asked to check this');
  await expect(panel.getByText('0 checked · 1 checking', { exact: true })).toBeVisible();
  await expect(checkThis).toHaveCount(0);

  venice.releaseVerdicts();
  await expect(card).toContainText('Unverified');
  await expect(card).toContainText('You asked to check this');
  await expect(panel.getByText('1 checked', { exact: true })).toBeVisible();

  // The Claims view shows it too.
  await panel.getByRole('button', { name: 'Claims' }).click();
  await expect(panel.getByRole('list', { name: 'Claims' }).getByRole('article')).toContainText('You asked to check this');
});

function lastUserMessage(body: unknown): string {
  const messages = (body as { messages?: Array<{ role: string; content: string }> }).messages ?? [];
  return messages.filter((m) => m.role === 'user').at(-1)?.content ?? '';
}
