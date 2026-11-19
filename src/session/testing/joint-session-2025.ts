// A reproducing fixture for #46, from a real run the entrant made: "President
// Trump Addresses Joint Session of Congress, March 4, 2025" on The White
// House's YouTube channel (https://www.youtube.com/watch?v=XkFKNkAEzQ8; a
// U.S. government work). Two stretches of the uploader's own en-US caption
// track (the opening minutes, and the inflation passage the entrant's cards
// came from), as [start s, end s, text] cues, fetched 2026-10-26.
//
// PAGE_AS_READ is what the extension read from the live watch page that day
// (readPageFacts in Chrome for Testing 151): the description then included
// YouTube's "Transcript / Follow along using the transcript" box, and the
// recording date was the stream's UTC start date (2025-03-05; it was 9 p.m.
// ET on March 4).
//
// ON_DEVICE is the same inflation passage as the entrant's on-device
// transcript gave it (Moonshine, from the entrant's screenshots): a piece
// boundary drops "As you know" and cuts a sentence short, and numbers come
// out as words.

import type { PageContext } from '../types';

export const PAGE_AS_READ: PageContext = {
  title: 'President Trump Addresses Joint Session of Congress, March 4, 2025',
  url: 'https://www.youtube.com/watch?v=XkFKNkAEzQ8',
  channel: 'The White House',
  description:
    'President Donald J. Trump will address a Joint Session of Congress on March 4, 2025, at 9 p.m. ET. 📱Text President Trump at (202) 933-9934 …...more ...more Transcript Follow along using the transcript. Show transcript The White House 3.35M subscribers VideosAbout Show less',
  recordedOn: '2025-03-05',
};

/** The date it was said: 9 p.m. ET on March 4, 2025. */
export const SAID_ON = '2025-03-04';

export const CAPTIONS: ReadonlyArray<readonly [number, number, string]> = [
  [1025.42, 1026.65, "The President: Thank you."],
  [1026.65, 1027.88, "Thank you very much, thank you very much."],
  [1027.88, 1104.01, "It's great honor, thank you very much."],
  [1107.96, 1111.68, "Speaker Johnson, Vice President Vance,"],
  [1112.69, 1115.63, "the First Lady of the United States,"],
  [1140.81, 1146.08, "members of the United States Congress, thank you very much."],
  [1146.9, 1152.19, "And to my fellow citizens, America is Back."],
  [1176.96, 1181.49, "Six weeks ago, I stood beneath the dome of this Capitol"],
  [1182.12, 1187.1, "and proclaimed the dawn of the golden age of America."],
  [1188.08, 1190.12, "From that moment on, it has been nothing"],
  [1190.12, 1194.91, "but swift and unrelenting action to usher in the greatest"],
  [1194.91, 1198.8, "and most successful era in the history of our country."],
  [1200.23, 1202.91, "We have accomplished more in 43 days"],
  [1202.91, 1206.83, "than most administrations accomplished in four years"],
  [1206.83, 1211.07, "or eight years, and we are just getting started."],
  [1229.49, 1231.61, "I return to this chamber tonight"],
  [1231.61, 1235.95, "to report that America's momentum is back,"],
  [1235.95, 1238.82, "our spirit is back, our pride is back,"],
  [1238.82, 1240.81, "our confidence is back,"],
  [1240.81, 1243.16, "and the American dream is surging bigger"],
  [1243.16, 1246.25, "and better than ever before."],
  [1252.0, 1254.97, "The American dream is unstoppable and our country"],
  [1254.97, 1257.37, "is on the verge of a comeback,"],
  [1257.37, 1260.26, "the likes of which the world has never witnessed"],
  [1260.26, 1263.29, "and perhaps will never witness again,"],
  [1264.39, 1266.19, "there's never been anything like it."],
  [2237.11, 2240.12, "What I have just described is only a small fraction"],
  [2240.12, 2242.33, "of the common sense revolution that is now,"],
  [2242.33, 2244.96, "because of us, sweeping the entire world."],
  [2245.64, 2248.01, "Common sense has become a common theme"],
  [2248.67, 2251.35, "and we will never go back,"],
  [2251.35, 2253.48, "never, never going to let that happen."],
  [2257.21, 2261.69, "Among my very highest priorities is to rescue our economy"],
  [2261.69, 2266.03, "and get dramatic and immediate relief to working families."],
  [2266.03, 2269.7, "As you know, we inherited from the last administration"],
  [2269.7, 2273.96, "an economic catastrophe and an inflation nightmare."],
  [2276.12, 2278.81, "Their policies drove up energy prices,"],
  [2278.81, 2281.22, "pushed up grocery costs,"],
  [2281.22, 2283.82, "and drove the necessities of life out of reach"],
  [2283.82, 2286.39, "for millions and millions of Americans,"],
  [2286.39, 2288.35, "they've never had anything like it."],
  [2289.03, 2292.06, "We suffered the worst inflation in 48 years,"],
  [2292.06, 2295.3, "but perhaps even in the history of our country,"],
  [2295.3, 2296.68, "they're not sure."],
  [2296.68, 2300.14, "As president, I'm fighting every day to reverse this damage"],
  [2300.14, 2303.34, "and make America affordable again."],
  [2317.14, 2320.29, "Joe Biden especially let the price of eggs"],
  [2320.29, 2325.89, "get out of control, the egg prices out of control,"],
  [2326.9, 2329.76, "and we're working hard to get it back down."],
  [2329.76, 2331.82, "Secretary, do a good job on that,"],
  [2331.82, 2333.44, "you inherited a total mess"],
  [2333.44, 2336.73, "from the previous administration, do a good job."],
];

/** The inflation passage as the on-device transcript heard it: [start s, end s, text]. */
export const ON_DEVICE: ReadonlyArray<readonly [number, number, string]> = [
  [2257.2, 2264.1, 'Among my very highest priorities is to rescue our economy and get dramatic and immediate relief.'],
  [2264.1, 2274.0, 'To working families, we inherited from the last administration an economic catastrophe and an inflation nightmare.'],
  [2274.0, 2281.2, 'Their policies drove up energy prices, pushed up grocery costs.'],
  [2281.2, 2288.0, 'And drove the necessities of life out of reach for millions and millions of Americans.'],
  [2288.0, 2295.0, 'We suffered the worst inflation in forty eight years, but perhaps even.'],
  [2295.0, 2302.0, "In the history of our country, they're not sure. As president, I'm fighting every day to reverse this damage and make America affordable again."],
];

/**
 * Claim breakdown's replies for the on-device sentences, as Gemini Nano gave
 * them with the breakdown prompt the entrant ran (Chrome 151, recorded on
 * 2026-10-26 with this fixture), keyed by sentence. Nano repeats a claim,
 * quotes a skip reason ("no checkable fact") as the premise and as the
 * speaker's words, and keeps "Their" unresolved. The "we inherited" reply is
 * set to depend on the speaker, as the entrant's card shows it did.
 */
export const NANO_BREAKDOWNS: Record<string, unknown> = {
  'To working families, we inherited from the last administration an economic catastrophe and an inflation nightmare.': {
    people_named: [],
    claims: [1, 2].map(() => ({
      literal: 'To working families, we inherited from the last administration an economic catastrophe and an inflation nightmare.',
      implied: "The current economic situation is poor due to the previous administration's policies.",
      premise_of: 'no checkable fact',
      depends_on_speaker: true,
      speaker_words: 'we',
      speaker: 'the speaker',
      queries: { fact: 'economic catastrophe last administration', claim: 'inflation nightmare last administration' },
    })),
    skipped: [
      { text: 'To working families', reason: 'opinion' },
      { text: 'an economic catastrophe', reason: 'opinion' },
    ],
  },
  'Their policies drove up energy prices, pushed up grocery costs.': {
    people_named: [],
    claims: [1, 2].map(() => ({
      literal: 'Their policies drove up energy prices, pushed up grocery costs.',
      implied: 'The speaker is criticizing the policies of a previous administration.',
      premise_of: 'no checkable fact',
      depends_on_speaker: false,
      speaker_words: 'Their policies',
      speaker: null,
      queries: { fact: 'energy prices grocery costs', claim: 'energy prices grocery costs' },
    })),
    skipped: [{ text: 'Their policies', reason: 'no checkable fact' }],
  },
  // Nano gave the previous sentence's claim again here.
  'And drove the necessities of life out of reach for millions and millions of Americans.': {
    people_named: [],
    claims: [
      {
        literal: 'The necessities of life were driven out of reach for millions and millions of Americans.',
        implied: 'Basic necessities became unaffordable for many people.',
        premise_of: 'no checkable fact',
        depends_on_speaker: false,
        speaker_words: 'millions and millions of Americans',
        speaker: 'the speaker',
        queries: { fact: 'necessities of life affordability statistics US', claim: 'necessities of life affordability statistics US' },
      },
      {
        literal: 'Their policies drove up energy prices, pushed up grocery costs.',
        implied: "The previous administration's policies negatively impacted the cost of essential goods.",
        premise_of: 'no checkable fact',
        depends_on_speaker: false,
        speaker_words: 'Their policies',
        speaker: 'the speaker',
        queries: { fact: 'energy prices grocery costs previous administration', claim: 'energy prices grocery costs previous administration' },
      },
    ],
    skipped: [{ text: 'millions and millions of Americans', reason: 'hyperbole' }],
  },
  'We suffered the worst inflation in forty eight years, but perhaps even.': {
    people_named: [],
    claims: [1, 2].map(() => ({
      literal: 'We suffered the worst inflation in forty eight years, but perhaps even.',
      implied: 'The inflation was exceptionally high.',
      premise_of: 'no checkable fact',
      depends_on_speaker: false,
      speaker_words: null,
      speaker: 'the speaker',
      queries: { fact: 'worst inflation in forty eight years', claim: 'recent worst inflation in forty eight years' },
    })),
    skipped: [{ text: 'but perhaps even', reason: 'opinion' }],
  },
};

/**
 * The claim review's answers, as Gemini Nano gave them for these claims
 * (recorded 2026-10-26): "Their" can't be told; the rest are checkable facts.
 */
export function nanoReview(claim: string): unknown {
  return /^their\b/i.test(claim)
    ? { reason: 'The claim asserts a causal link between policies and prices.', kind: 'checkable fact', unclear: 'Their' }
    : { reason: 'The claim asserts a figure or event that sources can settle.', kind: 'checkable fact', unclear: null };
}
