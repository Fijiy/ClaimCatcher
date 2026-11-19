import { expect, test } from './extension';
import { setApiKey, stubVenice } from './venice-stub';

// The card's sources, rated from the MBFC snapshot bundled in the build.
test('a card shows each source with its bias or Primary pill, the count across the spectrum, and partisan sources as context only', async ({
  context,
  fixtures,
  serviceWorker,
  clickAction,
  sidePanel,
}) => {
  await setApiKey(serviceWorker, 'stub-key');
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
    search: (query) =>
      query === 'unemployment rate last month'
        ? [
            { title: 'Employment Situation Summary', url: 'https://www.bls.gov/news.release/empsit.nr0.htm', content: 'The rate was 4.1 percent.' },
            { title: 'Jobs report: unemployment ticks down', url: 'https://www.foxnews.com/politics/jobs-report', content: 'Unemployment fell.' },
            { title: 'A post about jobs', url: 'https://x.com/someone/status/1', content: 'Jobs!' },
          ]
        : [
            { title: 'Unemployment fell to 4.1%', url: 'https://www.npr.org/2026/10/jobs', content: 'The rate fell to 4.1%.' },
            { title: 'Statement on the jobs report', url: 'https://www.whitehouse.gov/briefing-room/jobs', content: 'Great news.' },
          ],
    verdict: () => ({
      literal: '',
      implied: '',
      evidence: '',
      conclusion: 'The official jobs report gives the same 4.1% rate.',
      label: 'True',
      missing: null,
      sources: [
        { source: 1, stance: 'supports' },
        { source: 2, stance: 'supports' },
        { source: 3, stance: 'contradicts' },
      ],
    }),
  });

  const page = await context.newPage();
  await page.goto(`${fixtures}/video-track.html`);
  await clickAction(page);
  const panel = await sidePanel();
  await page.locator('video').evaluate((video: HTMLVideoElement) => video.play());

  const card = panel.getByRole('list', { name: 'Claims' }).getByRole('article');
  await expect(card).toContainText('True');
  await card.getByRole('button', { name: '3 sources' }).click(); // sources show on the opened card
  const sources = card.getByRole('region', { name: 'Sources' });

  // Full weight first: BLS (primary), NPR (LC, HIGH); then Fox News (R, MIXED).
  const evidence = sources.getByRole('list', { name: 'Evidence' }).getByRole('listitem');
  await expect(evidence).toHaveCount(3);
  await expect(evidence.nth(0)).toContainText('Primary');
  await expect(evidence.nth(0)).toContainText('bls.gov');
  await expect(evidence.nth(0)).toContainText('supports');
  await expect(evidence.nth(0).getByRole('link', { name: 'Employment Situation Summary' })).toHaveAttribute(
    'href',
    'https://www.bls.gov/news.release/empsit.nr0.htm',
  );
  await expect(evidence.nth(1).getByRole('link', { name: /MBFC: .*Left-center bias/ })).toHaveAttribute('href', 'https://mediabiasfactcheck.com/npr/');
  await expect(evidence.nth(1)).toContainText('npr.org');
  await expect(evidence.nth(1)).not.toContainText('counts less');
  await expect(evidence.nth(2).getByRole('link', { name: /MBFC: .*Right bias/ })).toHaveAttribute('href', 'https://mediabiasfactcheck.com/fox-news/');
  await expect(evidence.nth(2)).toContainText('foxnews.com');
  await expect(evidence.nth(2)).toContainText('contradicts');
  await expect(evidence.nth(2)).toContainText('mixed reliability · counts less');

  await expect(sources.getByRole('img', { name: /^Sources by MBFC bias rating/ })).toHaveAttribute(
    'aria-label',
    'Sources by MBFC bias rating: 0 Left, 1 Left-center, 0 Least biased (center), 0 Right-center, 1 Right; 1 Primary',
  );

  // Partisan: shown, marked context only. User-generated: nowhere.
  const contextOnly = sources.getByRole('list', { name: 'Context only' }).getByRole('listitem');
  await expect(contextOnly).toHaveCount(1);
  await expect(contextOnly).toContainText('whitehouse.gov');
  await expect(contextOnly).toContainText('context only');
  await expect(card).not.toContainText('x.com');

  // And the verdict step saw neither.
  const verdictRequest = venice.requests.find(
    (r) => (r.body as { response_format?: { json_schema?: { name?: string } } })?.response_format?.json_schema?.name === 'verdict',
  );
  const sent = JSON.stringify(verdictRequest?.body);
  expect(sent).toContain('bls.gov');
  expect(sent).not.toContain('whitehouse.gov');
  expect(sent).not.toContain('x.com');
});

// Links: cleaned, opened safely in a new tab, marked "opened"; a professional
// fact-check highlighted; the verdict visible throughout.
test('source links are cleaned, open in a new tab without opener or referrer, and get an opened mark; a fact-check is highlighted', async ({
  context,
  fixtures,
  serviceWorker,
  clickAction,
  sidePanel,
}) => {
  await setApiKey(serviceWorker, 'stub-key');
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
    search: (query) =>
      query === 'unemployment rate last month'
        ? [
            {
              title: 'Fact-check: Did unemployment fall to 4.1%?',
              url: 'https://www.google.com/url?sa=t&url=https%3A%2F%2Fwww.politifact.com%2Ffactchecks%2F2026%2Foct%2F20%2Fjobs%2F%3Futm_source%3Dfacebook%26fbclid%3Dx&usg=y',
              content: 'We rate this claim True.',
            },
            { title: 'Employment Situation Summary', url: 'https://www.bls.gov/news.release/empsit.nr0.htm?utm_campaign=jobs', content: 'The rate was 4.1 percent.' },
          ]
        : [{ title: 'Unemployment fell to 4.1%', url: 'https://www.npr.org/2026/10/jobs', content: 'The rate fell to 4.1%.' }],
    verdict: () => ({
      literal: '',
      implied: '',
      evidence: '',
      conclusion: 'The official jobs report gives the same 4.1% rate.',
      label: 'True',
      missing: null,
      sources: [
        { source: 1, stance: 'supports' },
        { source: 2, stance: 'supports' },
        { source: 3, stance: 'supports' },
      ],
    }),
  });
  // The fact-check's page, as the new tab will load it.
  await context.route('https://www.politifact.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>PolitiFact</title><p>Fact-check</p>' }),
  );

  const page = await context.newPage();
  await page.goto(`${fixtures}/video-track.html`);
  await clickAction(page);
  const panel = await sidePanel();
  await page.locator('video').evaluate((video: HTMLVideoElement) => video.play());

  const card = panel.getByRole('list', { name: 'Claims' }).getByRole('article');
  await expect(card).toContainText('True');
  await expect(card).toContainText('The official jobs report gives the same 4.1% rate.');
  await card.getByRole('button', { name: '3 sources' }).click(); // sources show on the opened card
  const evidence = card.getByRole('list', { name: 'Evidence' }).getByRole('listitem');
  await expect(evidence).toHaveCount(3);

  // The fact-check: unwrapped, cleaned, its real domain shown, and highlighted.
  const factCheck = evidence.filter({ hasText: 'politifact.com' });
  await expect(factCheck).toContainText('PolitiFact rated this…');
  const link = factCheck.getByRole('link', { name: 'Fact-check: Did unemployment fall to 4.1%?' });
  await expect(link).toHaveAttribute('href', 'https://www.politifact.com/factchecks/2026/oct/20/jobs/');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(evidence.filter({ hasText: 'bls.gov' }).getByRole('link', { name: 'Employment Situation Summary' })).toHaveAttribute(
    'href',
    'https://www.bls.gov/news.release/empsit.nr0.htm',
  );
  await expect(evidence.filter({ hasText: 'npr.org' })).not.toContainText('rated this');
  await expect(card).not.toContainText('opened');

  // Opening it: a new tab with no opener and no referrer.
  const [opened] = await Promise.all([context.waitForEvent('page'), link.click()]);
  await opened.waitForLoadState();
  expect(opened.url()).toBe('https://www.politifact.com/factchecks/2026/oct/20/jobs/');
  expect(await opened.evaluate(() => [window.opener === null, document.referrer])).toEqual([true, '']);

  // The source is marked opened, and the verdict is still there, beside the new tab.
  expect(await panel.evaluate(() => document.visibilityState)).toBe('visible');
  await expect(factCheck).toContainText('opened');
  await expect(evidence.filter({ hasText: 'bls.gov' })).not.toContainText('opened');
  await expect(card).toContainText('True');
  await expect(card).toContainText('The official jobs report gives the same 4.1% rate.');

  // The mark lives in the session: a fresh copy of the panel's state keeps it.
  await panel.reload();
  const reloaded = panel.getByRole('list', { name: 'Claims' }).getByRole('article');
  await reloaded.getByRole('button', { name: '3 sources' }).click();
  await expect(reloaded.getByRole('list', { name: 'Evidence' }).getByRole('listitem').filter({ hasText: 'politifact.com' })).toContainText('opened');

  // Nothing went anywhere to follow the wrapper.
  expect(venice.requests.every((r) => r.path.startsWith('/api/v1/'))).toBe(true);
});
