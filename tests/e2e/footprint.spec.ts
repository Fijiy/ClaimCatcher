// The cost and footprint footer (#42), on the built extension with the
// provider stubbed: the three ranges with their emoji, and the breakdown a
// click opens, with the streaming comparison and the counts. The fixture's
// three caption cues each become one claim here.

import type { Page } from '@playwright/test';
import { expect, test } from './extension';
import { setApiKey, stubVenice } from './venice-stub';

test.beforeEach(async ({ serviceWorker }) => {
  await setApiKey(serviceWorker, 'stub-venice-key');
});

const footer = (panel: Page) => panel.getByRole('button', { name: /^Energy .* Wh .*Carbon .* g .*Cost / });

test('the footer shows energy, carbon and cost as ranges, and opens the breakdown with the streaming comparison and the counts', async ({
  context,
  fixtures,
  clickAction,
  sidePanel,
}) => {
  const venice = await stubVenice(context, {
    breakdown: (user) => {
      const sentence = /Sentence to check:\n"(.*)"/.exec(user)?.[1] ?? '';
      return { claims: [{ literal: sentence, implied: sentence, premise_of: null, queries: { fact: `${sentence} figures`, claim: sentence } }], skipped: [] };
    },
    verdict: () => ({
      literal: '',
      implied: '',
      evidence: '',
      conclusion: 'The record matches what was said.',
      label: 'True',
      missing: null,
      sources: [{ source: 1, stance: 'supports' }],
    }),
    // A whole cent per chat reply, so the cost is easy to count.
    chatCost: 0.01,
  });
  const page = await context.newPage();
  await page.goto(`${fixtures}/video-recorded.html`);
  await clickAction(page);
  const panel = await sidePanel();
  await expect(panel.getByRole('status')).toHaveText('Listening');
  await page.locator('video').evaluate((v: HTMLVideoElement) => v.play());

  const claims = panel.getByRole('list', { name: 'Claims' }).getByRole('article');
  await expect(claims).toHaveCount(3);
  await expect(claims.filter({ hasText: 'True' })).toHaveCount(3);

  // The footer: "⚡ a–b Wh · 🌍 a–b g · 🪙 n¢", emoji included.
  const bar = footer(panel);
  await expect(bar).toBeVisible();
  await expect(bar).toHaveText(/⚡\s*Energy\s*[\d.]+–[\d.]+ Wh\s*·\s*🌍\s*Carbon\s*[\d.]+–[\d.]+ g\s*·\s*🪙\s*Cost\s*[\d.–]+¢/);
  await expect(bar).toHaveAttribute('aria-expanded', 'false');

  // Cost: what the replies billed (three breakdowns, three claim reviews, three verdicts, 1¢ each), plus 1¢ a search.
  const chats = venice.requests.filter((r) => r.path === '/api/v1/chat/completions').length;
  const searches = venice.requests.filter((r) => r.path === '/api/v1/augment/search').length;
  expect(chats).toBe(9);
  expect(searches).toBeGreaterThanOrEqual(6);
  await expect(bar).toContainText(`Cost ${chats + searches}¢`);

  await bar.click();
  await expect(bar).toHaveAttribute('aria-expanded', 'true');
  const sheet = panel.getByRole('region', { name: 'Cost and footprint of this session' });
  await expect(sheet).toContainText(/Energy\s*≈ [\d.]+–[\d.]+ Wh/);
  await expect(sheet).toContainText(/Carbon\s*≈ [\d.]+–[\d.]+ g CO₂e/);
  await expect(sheet).toContainText(new RegExp(`Cost on your API key\\s*≈ ${chats + searches}¢`));
  // Under a minute of this fixture: 77 Wh an hour comes to a fraction of a watt-hour.
  await expect(sheet).toContainText(/📺\s*Streaming the same length of video \(under a minute\) uses about 0\.\d+ Wh\./);
  await expect(sheet).toContainText(`3 claims checked, ${searches} searches. Estimates, shown as ranges.`);
  // Sourced: the method's sources are listed, and open in a new tab.
  await sheet.getByText('How this is estimated').click();
  const grid = sheet.getByRole('link', { name: /EIA/ });
  await expect(grid).toHaveAttribute('href', 'https://www.eia.gov/tools/faqs/faq.php?id=74&t=11');
  await expect(grid).toHaveAttribute('target', '_blank');

  // Only in the footer and its breakdown: nowhere else in the panel says Wh, CO₂e or ¢.
  const elsewhere = await panel.evaluate(() => {
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone.querySelector('.footprint')?.remove();
    return clone.innerText;
  });
  expect(elsewhere).not.toMatch(/\bWh\b|CO₂e|¢|⚡|🌍|🪙/);

  await bar.click();
  await expect(sheet).toBeHidden();
});
