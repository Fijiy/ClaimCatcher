import { describe, expect, it } from 'vitest';
import { createYouTubeCaptions } from './youtube-captions';

// Overlay snapshots as `task/site-capture-test` recorded them on YouTube
// (results/chrome/yt-recorded-cbs-vp-debate.json): media time, then the text of
// every `.ytp-caption-segment` on screen, joined.
const RECORDED: Array<[number, string]> = [
  [135.05, 'Stack those up and the conversion benefit is often wiped out before the'],
  [135.14, 'Stack those up and the conversion benefit is often wiped out before the longevity'],
  [135.58, 'benefit is often wiped out before the longevity'],
  [135.69, 'benefit is often wiped out before the longevity bet'],
  [136.3, 'benefit is often wiped out before the longevity bet is'],
  [136.5, 'benefit is often wiped out before the longevity bet is even'],
  [136.7, 'benefit is often wiped out before the longevity bet is even in'],
  [136.82, 'benefit is often wiped out before the longevity bet is even in play.'],
  [137.15, "benefit is often wiped out before the longevity bet is even in play. There's"],
  [137.43, "benefit is often wiped out before the longevity bet is even in play. There's one"],
  [137.83, "benefit is often wiped out before the longevity bet is even in play. There's one real"],
  [137.89, "longevity bet is even in play. There's one real"],
  [138.06, "longevity bet is even in play. There's one real exception"],
  [138.63, "longevity bet is even in play. There's one real exception worth"],
  [138.87, "longevity bet is even in play. There's one real exception worth naming."],
  [139.26, "longevity bet is even in play. There's one real exception worth naming. If"],
  [139.46, "longevity bet is even in play. There's one real exception worth naming. If you"],
  [139.99, "longevity bet is even in play. There's one real exception worth naming. If you have more than"],
  [140.05, 'one real exception worth naming. If you have more than'],
  [140.18, 'one real exception worth naming. If you have more than $4'],
  [140.75, 'one real exception worth naming. If you have more than $4 million'],
  [142.1, 'one real exception worth naming. If you have more than $4 million and your goal is pure inheritance'],
  [142.16, 'have more than $4 million and your goal is pure inheritance'],
];

function feed(captions: ReturnType<typeof createYouTubeCaptions>, snapshots: Array<[number, string]>) {
  return snapshots.flatMap(([time, text]) => captions.update(text, time));
}

describe('YouTube overlay reader', () => {
  it('turns the rolling two-line window into timed lines, each word once', () => {
    const captions = createYouTubeCaptions({ live: () => false });

    const segments = [...feed(captions, RECORDED), ...captions.flush()];

    expect(segments).toEqual([
      {
        reader: 'youtube',
        start: 135.05,
        end: 136.82,
        text: 'Stack those up and the conversion benefit is often wiped out before the longevity bet is even in play.',
      },
      { reader: 'youtube', start: 137.15, end: 138.87, text: "There's one real exception worth naming." },
      {
        reader: 'youtube',
        start: 139.26,
        end: 142.1,
        text: 'If you have more than $4 million and your goal is pure inheritance',
      },
    ]);
  });

  it('takes a word that grows letter by letter once, at its full length', () => {
    // ALL CAPS broadcast track (results/chrome/yt-recorded-nbc-2024-debate.json).
    const captions = createYouTubeCaptions({ live: () => false });

    const segments = [
      ...feed(captions, [
        [944.72, 'TO DO THIS. BRINGING CIVIL RIGHTS BA'],
        [944.75, 'TO DO THIS. BRINGING CIVIL RIGHTS BACK'],
        [944.93, 'TO DO THIS. BRINGING CIVIL RIGHTS BACK T'],
        [944.96, 'TO DO THIS. BRINGING CIVIL RIGHTS BACK TO'],
        [945.34, 'BRINGING CIVIL RIGHTS BACK TO'],
        [945.4, 'BRINGING CIVIL RIGHTS BACK TO TH'],
        [945.42, 'BRINGING CIVIL RIGHTS BACK TO THE'],
        [945.5, 'BRINGING CIVIL RIGHTS BACK TO THE STAT'],
        [945.52, 'BRINGING CIVIL RIGHTS BACK TO THE STATES'],
        [946.02, 'BRINGING CIVIL RIGHTS BACK TO THE STATES AND EACH STATE'],
        [946.19, 'BRINGING CIVIL RIGHTS BACK TO THE STATES AND EACH STATE HAVE'],
        [946.57, 'THE STATES AND EACH STATE HAVE'],
        [946.72, 'THE STATES AND EACH STATE HAVE A DIFFER'],
        [946.8, 'THE STATES AND EACH STATE HAVE A DIFFERENT LAW.'],
      ]),
      ...captions.flush(),
    ];

    expect(segments.map((s) => s.text)).toEqual([
      'TO DO THIS.',
      'BRINGING CIVIL RIGHTS BACK TO THE STATES AND EACH STATE HAVE A DIFFERENT LAW.',
    ]);
  });

  it('shifts live captions 6 s earlier and closes each phrase at a pause', () => {
    // Live auto captions arrive a phrase at a time (results/chrome/yt-live-livenowfox.json).
    const captions = createYouTubeCaptions({ live: () => true });

    const segments = feed(captions, [
      [46695.01, 'powerful He now owns as one man more wealth than the bottom'],
      [46700.02, 'bottom 53% of American households'],
      [46705.01, "households and what we are seeing and again we don't"],
    ]);
    segments.push(...captions.tick(46706), ...captions.tick(46707.2));

    expect(segments).toEqual([
      { reader: 'youtube', start: 46689.01, end: 46689.01, text: 'powerful He now owns as one man more wealth than the bottom' },
      { reader: 'youtube', start: 46694.02, end: 46694.02, text: '53% of American households' },
      { reader: 'youtube', start: 46699.01, end: 46699.01, text: "and what we are seeing and again we don't" },
    ]);
  });

  it('does not repeat words the overlay shows again after clearing', () => {
    const captions = createYouTubeCaptions({ live: () => false });

    const segments = [
      ...feed(captions, [
        [10, 'Inflation has come down'],
        [10.4, 'Inflation has come down for six straight months.'],
        [11, ''],
        [12, 'for six straight months.'], // re-shown after a seek back or a re-render
        [12.3, 'for six straight months. Wages'],
      ]),
      ...captions.flush(),
    ];

    expect(segments.map((s) => s.text)).toEqual(['Inflation has come down for six straight months.', 'Wages']);
  });

  it('is not shifted before the start of the video', () => {
    const captions = createYouTubeCaptions({ live: () => true });

    const segments = [...captions.update('Good evening', 2.5), ...captions.flush()];

    expect(segments).toEqual([{ reader: 'youtube', start: 0, end: 0, text: 'Good evening' }]);
  });
});
