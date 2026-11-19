import { describe, expect, it } from 'vitest';
import { pickCaptionReader } from './pick-reader';

describe('which caption reader a page gets', () => {
  it.each([
    ['https://www.youtube.com/watch?v=VAGZGQg31hs', 'youtube'],
    ['https://m.youtube.com/watch?v=VAGZGQg31hs', 'youtube'],
    ['https://youtube.com/live/d-s6VAEAkls', 'youtube'],
    ['https://live.house.gov/?date=2026-09-15', 'house'],
    ['https://www.cbsnews.com/live/', 'track'],
    ['https://www.c-span.org/program/senate/floor/123', 'track'],
    // Lookalikes get the generic reader, not a site's.
    ['https://notyoutube.com/watch?v=x', 'track'],
    ['https://www.youtube.com.example.test/watch', 'track'],
    ['https://house.gov/live', 'track'],
    ['http://127.0.0.1:8765/video-track.html', 'track'],
  ] as const)('%s → %s', (url, reader) => {
    expect(pickCaptionReader(url)).toBe(reader);
  });

  it('gives the generic reader when the URL is unknown', () => {
    expect(pickCaptionReader(undefined)).toBe('track');
    expect(pickCaptionReader('not a url')).toBe('track');
  });
});
