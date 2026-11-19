import { expect, test } from './extension';
import { setApiKey, stubVenice } from './venice-stub';

const KEY = 'stub-venice-key-3f9a';

test('with a key, a spoken claim becomes a card that goes from Checking… to a label', async ({
  context,
  fixtures,
  serviceWorker,
  clickAction,
  sidePanel,
}) => {
  await setApiKey(serviceWorker, KEY); // key setup itself: privacy.spec
  const venice = await stubVenice(context, {
    breakdown: (user) =>
      user.includes('"The unemployment rate fell')
        ? {
            claims: [
              {
                literal: 'The unemployment rate fell to 4.1% last month',
                implied: 'The job market is improving',
                premise_of: null,
                queries: { fact: 'unemployment rate last month', claim: 'unemployment fell 4.1 percent' },
              },
            ],
            skipped: [],
          }
        : { claims: [], skipped: [] },
    verdict: () => ({
      literal: 'The rate fell to 4.1%.',
      implied: 'Jobs are improving.',
      evidence: 'BLS gives 4.1%.',
      conclusion: 'The official jobs report gives the same 4.1% rate.',
      label: 'True',
      missing: null,
      sources: [{ source: 1, stance: 'supports' }],
    }),
  });
  venice.holdVerdicts();

  const page = await context.newPage();
  await page.goto(`${fixtures}/video-track.html`);
  await clickAction(page);
  const panel = await sidePanel();
  await expect(panel.getByRole('status')).toHaveText('Listening');
  await page.locator('video').evaluate((video: HTMLVideoElement) => video.play());

  const card = panel.getByRole('list', { name: 'Claims' }).getByRole('article');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('Checking…');
  await expect(card).toContainText('Weighing sources…');
  await expect(card).toContainText('The unemployment rate fell to 4.1% last month');

  venice.releaseVerdicts();
  await expect(card).toContainText('True');
  await expect(card).not.toContainText('Checking…');
  await expect(card).toContainText('The official jobs report gives the same 4.1% rate.');
  await card.getByRole('button', { name: '1 source' }).click(); // sources show on the opened card
  await expect(card.getByRole('link', { name: /BLS/ })).toHaveAttribute('href', 'https://www.bls.gov/news.release/empsit.nr0.htm');

  // The key went to the provider.
  expect(venice.requests.length).toBeGreaterThan(0);
  for (const request of venice.requests) expect(request.headers.authorization).toBe(`Bearer ${KEY}`);
});

test('a key the provider rejects stops listening, says why, and ends capture', async ({
  context,
  fixtures,
  serviceWorker,
  clickAction,
  sidePanel,
}) => {
  await setApiKey(serviceWorker, KEY);
  await stubVenice(context, {
    breakdown: () => ({
      claims: [{ literal: 'Congress passed the bill', implied: '', premise_of: null, queries: { fact: 'bill vote', claim: 'Congress passed bill' } }],
      skipped: [],
    }),
    verdict: () => ({ status: 401, error: 'Authentication failed' }),
  });
  const page = await context.newPage();
  await page.goto(`${fixtures}/video-track.html`);
  await clickAction(page);
  const panel = await sidePanel();
  await page.locator('video').evaluate((video: HTMLVideoElement) => video.play());

  await expect(panel.getByRole('status')).toHaveText('Stopped');
  await expect(panel.getByRole('alert')).toContainText('Venice rejected the API key');
  // The message links to Privacy & data, at the key.
  const opened = context.waitForEvent('page');
  await panel.getByRole('alert').getByRole('button', { name: 'Privacy & data' }).click();
  const privacy = await opened;
  await expect(privacy).toHaveURL(/\/welcome\.html#key$/);
  await expect(privacy.getByRole('heading', { name: 'Your Venice API key' })).toBeVisible();
  const badge = await serviceWorker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return chrome.action.getBadgeText({ tabId: tab!.id! });
  });
  expect(badge).toBe('');
});

test('the key is unreadable from a content script', async ({ context, fixtures, serviceWorker, clickAction }) => {
  await setApiKey(serviceWorker, KEY);
  await stubVenice(context);
  const page = await context.newPage();
  await page.goto(`${fixtures}/video-track.html`);
  await clickAction(page); // gives the activeTab grant that lets a script run there

  const fromContentScript = await serviceWorker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab!.id! },
      func: async () => {
        try {
          return { read: await chrome.storage.local.get(null) };
        } catch (error) {
          return { error: String(error) };
        }
      },
    });
    return injection?.result;
  });

  expect(fromContentScript).not.toHaveProperty('read');
  expect(JSON.stringify(fromContentScript)).not.toContain(KEY);
  // The worker itself (a trusted context) still has it.
  expect(await serviceWorker.evaluate(() => chrome.storage.local.get('apiKey'))).toEqual({ apiKey: KEY });
});
