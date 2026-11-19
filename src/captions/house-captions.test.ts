import { describe, expect, it } from 'vitest';
import { createHouseCaptions } from './house-captions';

// The House Bitmovin player's `cueenter` events as task/site-capture-test
// recorded them (results/chrome/house-floor-0915-cc1.json): a 2-line roll-up,
// so every roll re-enters the line above with the new one, at the same start.
const CC1 = [
  { subtitleId: 'CC1', start: 14220.633333333333, text: 'CALIFORNIA MARKET AND OTHERS' },
  { subtitleId: 'CC1', start: 14220.633333333333, text: 'FOR THE WYOMING MARKET. THIS.' },
  { subtitleId: 'CC1', start: 14222.333333333334, text: 'FOR THE WYOMING MARKET. THIS.' },
  { subtitleId: 'CC1', start: 14222.333333333334, text: 'SUBJECTS WYOMING TO CALIFORNIA' },
  { subtitleId: 'CC1', start: 14223.933333333332, text: 'SUBJECTS WYOMING TO CALIFORNIA' },
  { subtitleId: 'CC1', start: 14223.933333333332, text: 'LAW, UNDERMINING OUR STATE' },
  { subtitleId: 'CC1', start: 14225.5, text: 'LAW, UNDERMINING OUR STATE' },
  { subtitleId: 'CC1', start: 14225.5, text: 'AUTHORITIES AND FEDERAL LAW TO' },
];

describe('House floor reader', () => {
  it('yields each roll-up line once, 4 s earlier than it was shown', () => {
    const captions = createHouseCaptions();

    const segments = CC1.flatMap((cue) => captions.cue(cue));

    expect(segments).toEqual([
      { reader: 'house', start: 14216.633, end: 14216.633, text: 'CALIFORNIA MARKET AND OTHERS' },
      { reader: 'house', start: 14216.633, end: 14216.633, text: 'FOR THE WYOMING MARKET. THIS.' },
      { reader: 'house', start: 14218.333, end: 14218.333, text: 'SUBJECTS WYOMING TO CALIFORNIA' },
      { reader: 'house', start: 14219.933, end: 14219.933, text: 'LAW, UNDERMINING OUR STATE' },
      { reader: 'house', start: 14221.5, end: 14221.5, text: 'AUTHORITIES AND FEDERAL LAW TO' },
    ]);
  });

  it('reads CC1 only, so CC3 Spanish never interleaves', () => {
    const captions = createHouseCaptions();

    const segments = [
      { subtitleId: 'CC1', start: 100, text: 'THE GENTLEMAN FROM TEXAS' },
      { subtitleId: 'CC3', start: 100.2, text: 'EL CABALLERO DE TEXAS' },
      { subtitleId: 'CC1', start: 101.6, text: 'THE GENTLEMAN FROM TEXAS' },
      { subtitleId: 'CC1', start: 101.6, text: 'IS RECOGNIZED.' },
      { subtitleId: 'CC3', start: 101.8, text: 'EL CABALLERO DE TEXAS' },
      { subtitleId: 'CC3', start: 101.8, text: 'TIENE LA PALABRA.' },
    ].flatMap((cue) => captions.cue(cue));

    expect(segments.map((s) => s.text)).toEqual(['THE GENTLEMAN FROM TEXAS', 'IS RECOGNIZED.']);
  });

  it("drops the captioner's anonymous speaker tags but keeps the words", () => {
    const captions = createHouseCaptions();

    const segments = [
      { subtitleId: 'CC1', start: 200, text: 'SPEAKER 2: THE GENTLEMAN YIELDS' },
      { subtitleId: 'CC1', start: 201.5, text: 'SPEAKER 2: THE GENTLEMAN YIELDS' },
      { subtitleId: 'CC1', start: 201.5, text: 'BACK. SPEAKER 1: MADAM SPEAKER,' },
      { subtitleId: 'CC1', start: 203, text: 'BACK. SPEAKER 1: MADAM SPEAKER,' },
      { subtitleId: 'CC1', start: 203, text: '>> SPEAKER, IF WE DEFEAT THE' },
    ].flatMap((cue) => captions.cue(cue));

    expect(segments.map((s) => s.text)).toEqual(['THE GENTLEMAN YIELDS', 'BACK. MADAM SPEAKER,', 'SPEAKER, IF WE DEFEAT THE']);
  });

  it('keeps a line said again later, once the roll-up has moved on', () => {
    const captions = createHouseCaptions();

    const segments = [
      { subtitleId: 'CC1', start: 10, text: 'THE CLERK WILL REPORT.' },
      { subtitleId: 'CC1', start: 11.5, text: 'THE CLERK WILL REPORT.' },
      { subtitleId: 'CC1', start: 11.5, text: 'WITHOUT OBJECTION.' },
      { subtitleId: 'CC1', start: 13, text: 'WITHOUT OBJECTION.' },
      { subtitleId: 'CC1', start: 13, text: 'SO ORDERED.' },
      { subtitleId: 'CC1', start: 14.5, text: 'SO ORDERED.' },
      { subtitleId: 'CC1', start: 14.5, text: 'THE CLERK WILL REPORT.' },
    ].flatMap((cue) => captions.cue(cue));

    expect(segments.map((s) => s.text)).toEqual([
      'THE CLERK WILL REPORT.',
      'WITHOUT OBJECTION.',
      'SO ORDERED.',
      'THE CLERK WILL REPORT.',
    ]);
  });
});
