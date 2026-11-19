// Chrome for Testing reports itself as "Chromium" and has no Gemini Nano
// (`LanguageModel.availability()` answers "unavailable"), so local mode is
// never offered there. To test the first-run page's local-mode choice and its
// download, this makes the first-run page / Privacy & data look like Google
// Chrome with a fake `LanguageModel`, through an init script (Playwright runs
// those in extension pages opened in tabs). Only that page is faked: the
// side panel and the offscreen document still see the real browser, so
// listening in local mode stays blocked, as in any browser without Nano.
//
// The fake download reports 0%, 25% and 50%, then waits for
// `finishDownload(page)`. Each `create()` records whether the page had user
// activation (Chrome refuses to start a download without it).

import type { BrowserContext, Page } from '@playwright/test';

export type FakeAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

export async function fakeChromeNano(context: BrowserContext, availability: FakeAvailability) {
  await context.addInitScript((initial: FakeAvailability) => {
    if (location.pathname !== '/welcome.html') return;
    Object.defineProperty(Navigator.prototype, 'userAgentData', {
      configurable: true,
      get: () => ({ brands: [{ brand: 'Google Chrome', version: '151' }, { brand: 'Chromium', version: '151' }], mobile: false }),
    });
    let state = initial;
    let finish: () => void = () => {};
    const fake = {
      creates: [] as Array<{ activated: boolean; temperature: unknown; topK: unknown }>,
      finishDownload: () => finish(),
    };
    Object.assign(globalThis, { __fakeNano: fake });
    Object.assign(globalThis, {
      LanguageModel: {
        availability: async () => state,
        async create(options: { temperature?: number; topK?: number; monitor?: (m: EventTarget) => void }) {
          fake.creates.push({ activated: navigator.userActivation.hasBeenActive, temperature: options.temperature, topK: options.topK });
          if (state === 'unavailable') throw new DOMException('The device is unable to create a session.', 'NotSupportedError');
          if (state !== 'available') {
            if (!navigator.userActivation.hasBeenActive) {
              throw new DOMException('Requires a user gesture when availability is "downloading" or "downloadable".', 'NotAllowedError');
            }
            state = 'downloading';
            const monitor = new EventTarget();
            options.monitor?.(monitor);
            for (const loaded of [0, 0.25, 0.5]) monitor.dispatchEvent(new ProgressEvent('downloadprogress', { loaded, total: 1 }));
            await new Promise<void>((resolve) => (finish = resolve));
            monitor.dispatchEvent(new ProgressEvent('downloadprogress', { loaded: 1, total: 1 }));
            state = 'available';
          }
          return { destroy() {}, async prompt() { return '{}'; }, async clone() { return this; } };
        },
      },
    });
  }, availability);
}

type FakeNano = { creates: Array<{ activated: boolean; temperature: unknown; topK: unknown }>; finishDownload(): void };

export const finishDownload = (page: Page) => page.evaluate(() => (globalThis as unknown as { __fakeNano: FakeNano }).__fakeNano.finishDownload());
export const nanoCreates = (page: Page) => page.evaluate(() => (globalThis as unknown as { __fakeNano: FakeNano }).__fakeNano.creates);
