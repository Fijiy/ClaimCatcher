import { describe, expect, it } from 'vitest';
import { createTabClock } from './tab-clock';

const QUARTER = 0.25; // seconds of audio per tabCapture frame in these tests

describe('tab clock: media times for tabCapture audio', () => {
  it('times frames from 0 when the page shows no player time (a video embedded from another site)', () => {
    const clock = createTabClock();
    expect([clock.frame(QUARTER), clock.frame(QUARTER), clock.frame(QUARTER)]).toEqual([0, 0.25, 0.5]);
  });

  it("starts at the player's time, then counts the audio", () => {
    const clock = createTabClock();
    clock.playerAt(42);
    expect([clock.frame(QUARTER), clock.frame(QUARTER)]).toEqual([42, 42.25]);
  });

  it('keeps counting while the player agrees with it, so small message delays make no jumps', () => {
    const clock = createTabClock();
    clock.playerAt(10);
    clock.frame(QUARTER); // 10
    clock.frame(QUARTER); // 10.25
    clock.playerAt(10.4); // the count says 10.5
    expect(clock.frame(QUARTER)).toBe(10.5);
  });

  it('follows a seek', () => {
    const clock = createTabClock();
    clock.playerAt(10);
    clock.frame(QUARTER);
    clock.playerAt(95);
    expect([clock.frame(QUARTER), clock.frame(QUARTER)]).toEqual([95, 95.25]);
  });

  it('goes back to the player time when the video is paused and the tab audio keeps coming', () => {
    const clock = createTabClock();
    clock.playerAt(30);
    for (let i = 0; i < 4; i++) clock.frame(QUARTER); // 30 .. 31
    clock.playerAt(30.2); // paused at 30.2 a while ago
    expect(clock.frame(QUARTER)).toBe(30.2);
  });
});
