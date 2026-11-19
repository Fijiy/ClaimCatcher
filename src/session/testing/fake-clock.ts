import type { Clock, TimerHandle } from '../types';

export interface FakeClock extends Clock {
  /** Moves time forward, firing every timer that falls due, in order. */
  advance(ms: number): void;
}

/** A clock for tests: time moves only when the test calls `advance`. */
export function createFakeClock(startMs = Date.UTC(2026, 9, 26, 15, 0, 0)): FakeClock {
  let now = startMs;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();

  return {
    now: () => now,
    setTimeout(fn, ms) {
      const id = nextId++;
      timers.set(id, { at: now + Math.max(0, ms), fn });
      return id;
    },
    clearTimeout(handle: TimerHandle) {
      if (typeof handle === 'number') timers.delete(handle);
    },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let due: [number, { at: number; fn: () => void }] | undefined;
        for (const entry of timers) {
          if (entry[1].at <= end && (!due || entry[1].at < due[1].at)) due = entry;
        }
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = end;
    },
  };
}
