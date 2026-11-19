// The YouTube and House caption readers, against fixture pages that copy each
// player's caption DOM and behaviour (task/site-capture-test FINDINGS.md and
// results/chrome/*.json). The pages are served at the real sites' URLs, so the
// extension picks the reader as it would there. Times in the panel are media
// time after each reader's lag shift (src/captions/lag.ts).

import type { Page } from '@playwright/test';
import { expect, test } from './extension';
import { setApiKey, stubVenice } from './venice-stub';

test.setTimeout(60_000);

// Listening needs a key; the provider is stubbed and finds no claims, since
// these tests are about the transcript.
test.beforeEach(async ({ context, serviceWorker }) => {
  await setApiKey(serviceWorker, 'stub-venice-key');
  await stubVenice(context);
});

const transcript = (panel: Page) => panel.getByRole('list', { name: 'Transcript' }).getByRole('listitem');

/** Switches the panel to Full transcript. Lines the claim filter dropped end in "Skipped: …", which the patterns allow. */
const showTranscript = (panel: Page) => panel.getByRole('button', { name: 'Full transcript' }).click();

function play(page: Page) {
  return page.locator('video').evaluate((video: HTMLVideoElement) => video.play());
}

test('YouTube, recorded: the rolling caption overlay becomes timed lines, each said once and not shifted', async ({
  openSite,
  clickAction,
  sidePanel,
}) => {
  const page = await openSite('https://www.youtube.com/watch?v=recorded', 'youtube.html');
  const ccButton = page.locator('.ytp-subtitles-button');
  // Nothing of ClaimCatcher runs on the page before the click.
  await expect(ccButton).toHaveAttribute('aria-pressed', 'false');

  await clickAction(page);
  const panel = await sidePanel();
  await showTranscript(panel);
  // The reader turns the player's captions on.
  await expect(ccButton).toHaveAttribute('aria-pressed', 'true');
  await play(page);

  await expect(transcript(panel)).toHaveText(
    [
      /^0:01\s*Stack those up and the conversion benefit is often wiped out before the longevity bet is even in play\.\s*Captions(\s*Skipped: .*)?$/,
      /^0:03\s*There's one real exception worth naming\.\s*Captions(\s*Skipped: .*)?$/,
      /^0:05\s*If you have more than \$4 million and your goal is pure inheritance\s*Captions(\s*Skipped: .*)?$/,
    ],
    { timeout: 20_000 },
  );

  // Stop hands the captions setting back as the viewer had it.
  await panel.getByRole('button', { name: 'Stop' }).click();
  await expect(panel.getByRole('status')).toHaveText('Stopped');
  await expect(ccButton).toHaveAttribute('aria-pressed', 'false');
});

test('YouTube, live: phrase-at-a-time captions become lines shifted 6 s earlier', async ({ openSite, clickAction, sidePanel }) => {
  const page = await openSite('https://www.youtube.com/watch?v=live', 'youtube.html');

  await clickAction(page);
  const panel = await sidePanel();
  await showTranscript(panel);
  await play(page);

  // Shown at 0:07, 0:09.6 and 0:12.2 of the stream.
  await expect(transcript(panel)).toHaveText(
    [
      /^0:01\s*powerful He now owns as one man more wealth than the bottom\s*Captions(\s*Skipped: .*)?$/,
      /^0:03\s*53% of American households\s*Captions(\s*Skipped: .*)?$/,
      /^0:06\s*and what we are seeing and again we don't\s*Captions(\s*Skipped: .*)?$/,
    ],
    { timeout: 25_000 },
  );
});

test('House floor: one English line per roll-up, shifted 4 s earlier, even with Spanish CC3 switched on', async ({
  openSite,
  clickAction,
  sidePanel,
}) => {
  // `viewer=spanish`: the viewer switches CC3 on as soon as the player offers it.
  const page = await openSite('https://live.house.gov/?date=2026-09-15&viewer=spanish', 'house.html');
  const overlay = page.locator('.bmpui-ui-subtitle-overlay');
  await page.locator('.bmpui-ui-hugeplaybacktogglebutton').click();
  await expect(overlay).toContainText('CABALLERO');

  await clickAction(page);
  const panel = await sidePanel();
  await showTranscript(panel);
  const lines = transcript(panel);
  await expect(lines.nth(2)).toContainText('1530 AND THE UNDERLYING', { timeout: 15_000 });
  // The reader showed CC1 alone; now the viewer turns Spanish back on, and
  // the player interleaves both tracks on screen.
  await expect(overlay).not.toContainText('CABALLERO');
  await page.evaluate(() => (window as unknown as HouseFixture).floorcast.views.videoView.getPlayerInstance().subtitles.enable('CC3'));
  await expect(overlay).toContainText('CABALLERO');

  await expect(lines).toHaveText(
    [
      /^0:01\s*MEET THE MOMENT\. I URGE ALL MY\s*Captions(\s*Skipped: .*)?$/,
      /^0:01\s*COLLEAGUES TO SUPPORT H\. RES\.\s*Captions(\s*Skipped: .*)?$/,
      /^0:03\s*1530 AND THE UNDERLYING\s*Captions(\s*Skipped: .*)?$/,
      /^0:04\s*LEGISLATION, AND I YIELD BACK\.\s*Captions(\s*Skipped: .*)?$/,
      /^0:06\s*THE GENTLEMAN YIELDS\s*Captions(\s*Skipped: .*)?$/,
      /^0:08\s*BACK\. GENTLEMAN\. THE\s*Captions(\s*Skipped: .*)?$/,
      /^0:10\s*GENTLEWOMAN RESERVES\. THE\s*Captions(\s*Skipped: .*)?$/,
    ],
    { timeout: 15_000 },
  );
});

/** The fixture's stand-in for live.house.gov's player handle. */
interface HouseFixture {
  floorcast: { views: { videoView: { getPlayerInstance(): { subtitles: { enable(id: string, exclusive?: boolean): void } } } } };
}
