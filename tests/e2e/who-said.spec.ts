// Who said it (#36), on the built extension with the provider stubbed. The
// fixture is a debate page: its title names both debaters, so "I" can't be
// settled from the page, and its description names them in full.

import { expect, test } from './extension';
import { setApiKey, stubVenice } from './venice-stub';

const TITLE = 'Lopez vs. Hart: the second governor debate';
const CHANNEL = 'Ohio Public Media';

const claim = (literal: string, speaker: string | null, claimQuery = literal) => ({
  people_named: ['Lopez', 'Hart'],
  claims: [
    {
      literal,
      implied: `${literal} (implied)`,
      premise_of: null,
      depends_on_speaker: true,
      speaker_words: 'I',
      speaker,
      queries: { fact: 'state job growth by governor', claim: claimQuery },
    },
  ],
  skipped: [],
});

test.beforeEach(async ({ serviceWorker }) => {
  await setApiKey(serviceWorker, 'stub-venice-key');
});

test('a claim that needs its speaker asks "Who said this?" with the names on the page, and an answer re-checks it', async ({
  context,
  fixtures,
  clickAction,
  sidePanel,
}) => {
  const venice = await stubVenice(context, {
    breakdown: (user) => {
      const named = /Speaker \(named by the viewer\): "(.*?)"/.exec(user)?.[1];
      return named
        ? claim(`${named} has created more jobs than any of their predecessors`, named, 'Hart jobs predecessors')
        : claim('The speaker has created more jobs than any of their predecessors', null);
    },
    verdict: () => ({
      literal: '',
      implied: '',
      evidence: '',
      conclusion: 'State payroll data back the record.',
      label: 'True',
      missing: null,
      sources: [{ source: 1, stance: 'supports' }],
    }),
  });
  const page = await context.newPage();
  await page.goto(`${fixtures}/who-said.html`);
  await clickAction(page);
  const panel = await sidePanel();
  await expect(panel.getByRole('status')).toHaveText('Listening');
  await page.locator('video').evaluate((v: HTMLVideoElement) => v.play());

  const card = panel.getByRole('list', { name: 'Claims' }).getByRole('article');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('Unverified');
  await expect(card).toContainText('Can’t tell who “I” refers to, so this wasn’t checked.');
  const prompt = card.getByRole('group', { name: 'Who said this?' });
  // A captioned page: voices aren't told apart, and the prompt offers it.
  await expect(prompt.getByRole('button')).toHaveText(['Maria Lopez', 'Daniel Hart', 'Ann Kerr', 'Someone else…', 'Tell voices apart for this video']);

  // Nothing was searched or judged without a speaker.
  expect(venice.requests.filter((r) => r.path.endsWith('/augment/search'))).toEqual([]);
  // Breakdown got the page's own title and channel, read under the click's grant; the description stayed here.
  const breakdowns = () =>
    venice.requests
      .filter((r) => (r.body as { response_format?: { json_schema?: { name?: string } } })?.response_format?.json_schema?.name === 'claim_breakdown')
      .map((r) => (r.body as { messages: Array<{ role: string; content: string }> }).messages.find((m) => m.role === 'user')!.content);
  expect(breakdowns()[0]).toContain(TITLE);
  expect(breakdowns()[0]).toContain(CHANNEL);

  await prompt.getByRole('button', { name: 'Daniel Hart' }).click();

  await expect(card).toContainText('Said by Daniel Hart');
  await expect(card).toContainText('Daniel Hart has created more jobs than any of their predecessors');
  await expect(card).toContainText('True');
  await expect(card.getByRole('group', { name: 'Who said this?' })).toHaveCount(0);
  expect(breakdowns().at(-1)).toContain('Daniel Hart');
  expect(venice.requests.some((r) => (r.body as { query?: string })?.query === 'Hart jobs predecessors')).toBe(true);
  for (const request of venice.requests) {
    const text = JSON.stringify(request.body);
    expect(text).not.toContain('Columbus');
    expect(text).not.toContain('Ann Kerr');
  }
});

test('"Who said this?" stays answerable after Stop: the answer re-checks the card, and listening stays off', async ({
  context,
  fixtures,
  serviceWorker,
  clickAction,
  sidePanel,
}) => {
  await stubVenice(context, {
    breakdown: (user) => {
      const named = /Speaker \(named by the viewer\): "(.*?)"/.exec(user)?.[1];
      return named
        ? claim(`${named} has created more jobs than any of their predecessors`, named)
        : claim('The speaker has created more jobs than any of their predecessors', null);
    },
    verdict: () => ({ literal: '', implied: '', evidence: '', conclusion: 'State payroll data back the record.', label: 'True', missing: null, sources: [{ source: 1, stance: 'supports' }] }),
  });
  const page = await context.newPage();
  await page.goto(`${fixtures}/who-said.html`);
  await clickAction(page);
  const panel = await sidePanel();
  await page.locator('video').evaluate((v: HTMLVideoElement) => v.play());
  const card = panel.getByRole('list', { name: 'Claims' }).getByRole('article');
  await expect(card.getByRole('group', { name: 'Who said this?' })).toBeVisible();
  await page.locator('video').evaluate((v: HTMLVideoElement) => v.pause());
  await panel.getByRole('button', { name: 'Stop' }).click();
  await expect(panel.getByRole('status')).toHaveText('Stopped');

  const prompt = card.getByRole('group', { name: 'Who said this?' });
  // Nothing more is heard, so voices can't be told apart now; the names still answer.
  await expect(prompt.getByRole('button')).toHaveText(['Maria Lopez', 'Daniel Hart', 'Ann Kerr', 'Someone else…']);
  await prompt.getByRole('button', { name: 'Maria Lopez' }).click();

  await expect(card).toHaveCount(1);
  await expect(card).toContainText('Said by Maria Lopez');
  await expect(card).toContainText('True');
  await expect(panel.getByRole('status')).toHaveText('Stopped');
  const badge = await serviceWorker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return chrome.action.getBadgeText({ tabId: tab!.id! });
  });
  expect(badge).toBe('');
});

test('after Stop, saving a different key closes "Who said this?": the stopped session never re-checks with the replaced key', async ({
  context,
  extensionId,
  fixtures,
  clickAction,
  sidePanel,
}) => {
  const venice = await stubVenice(context, {
    breakdown: () => claim('The speaker has created more jobs than any of their predecessors', null),
    verdict: () => ({ literal: '', implied: '', evidence: '', conclusion: 'State payroll data back the record.', label: 'True', missing: null, sources: [{ source: 1, stance: 'supports' }] }),
  });
  const page = await context.newPage();
  await page.goto(`${fixtures}/who-said.html`);
  await clickAction(page);
  const panel = await sidePanel();
  await page.locator('video').evaluate((v: HTMLVideoElement) => v.play());
  const card = panel.getByRole('list', { name: 'Claims' }).getByRole('article');
  await expect(card.getByRole('group', { name: 'Who said this?' })).toBeVisible();
  await page.locator('video').evaluate((v: HTMLVideoElement) => v.pause());
  await panel.getByRole('button', { name: 'Stop' }).click();
  await expect(panel.getByRole('status')).toHaveText('Stopped');

  const privacy = await context.newPage();
  await privacy.goto(`chrome-extension://${extensionId}/welcome.html`);
  await privacy.getByText('Use a different key').click();
  await privacy.getByRole('textbox', { name: 'Venice API key' }).fill('stub-venice-key-new-9d1b');
  await privacy.getByRole('button', { name: 'Check and save key' }).click();
  await expect(privacy.getByTestId('masked-key')).toHaveText('••••9d1b');

  await expect(card.getByRole('group', { name: 'Who said this?' })).toHaveCount(0);
  await expect(panel.getByRole('status')).toHaveText('Stopped');
  expect(venice.requests.filter((r) => r.path.endsWith('/chat/completions') && r.headers.authorization === 'Bearer stub-venice-key-new-9d1b')).toEqual([]);
});

test('"Someone else…" takes a typed name', async ({ context, fixtures, clickAction, sidePanel }) => {
  await stubVenice(context, {
    breakdown: (user) => {
      const named = /Speaker \(named by the viewer\): "(.*?)"/.exec(user)?.[1];
      return named
        ? claim(`${named} has created more jobs than any of their predecessors`, named)
        : claim('The speaker has created more jobs than any of their predecessors', null);
    },
    verdict: () => ({ literal: '', implied: '', evidence: '', conclusion: 'No source gives the figure.', label: 'Unverified', missing: null, sources: [] }),
  });
  const page = await context.newPage();
  await page.goto(`${fixtures}/who-said.html`);
  await clickAction(page);
  const panel = await sidePanel();
  await page.locator('video').evaluate((v: HTMLVideoElement) => v.play());

  const card = panel.getByRole('list', { name: 'Claims' }).getByRole('article');
  await card.getByRole('button', { name: 'Someone else…' }).click();
  await card.getByRole('textbox', { name: 'Who said this? Their name' }).fill('Sam Ortiz');
  await card.getByRole('button', { name: 'Check' }).click();

  await expect(card).toContainText('Said by Sam Ortiz');
  await expect(card).toContainText('No source gives the figure.');
});

test('"Tell voices apart for this video" switches voice separation on for the page', async ({ context, fixtures, clickAction, sidePanel }) => {
  await stubVenice(context, {
    breakdown: () => claim('The speaker has created more jobs than any of their predecessors', null),
    verdict: () => ({ literal: '', implied: '', evidence: '', conclusion: 'No source gives the figure.', label: 'Unverified', missing: null, sources: [] }),
  });
  const page = await context.newPage();
  await page.goto(`${fixtures}/who-said.html`);
  await clickAction(page);
  const panel = await sidePanel();
  await page.locator('video').evaluate((v: HTMLVideoElement) => v.play());

  const prompt = panel.getByRole('list', { name: 'Claims' }).getByRole('article').getByRole('group', { name: 'Who said this?' });
  await prompt.getByRole('button', { name: 'Tell voices apart for this video' }).click();

  // The session turned it on, so the offer is gone; the question stays.
  await expect(prompt.getByRole('button', { name: 'Tell voices apart for this video' })).toHaveCount(0);
  await expect(prompt.getByText('Telling voices apart from now on…')).toHaveCount(0);
  await expect(prompt.getByRole('button', { name: 'Daniel Hart' })).toBeVisible();
});
